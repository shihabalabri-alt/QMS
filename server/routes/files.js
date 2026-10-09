// Secure file management: encrypted at rest, magic-byte validated, permission-checked downloads.
const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const db = require('../db');
const config = require('../config');
const box = require('../crypto-box');
const { authRequired } = require('../middleware/auth');
const { audit } = require('../middleware/audit');

const r = express.Router();
r.use(authRequired);

const ALLOWED_EXT = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.md', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.zip', '.msg', '.eml', '.xml', '.json']);

// Magic-byte signatures for binary formats — catches renamed executables/scripts
const SIGNATURES = [
  { ext: ['.pdf'], bytes: [0x25, 0x50, 0x44, 0x46] },                 // %PDF
  { ext: ['.png'], bytes: [0x89, 0x50, 0x4e, 0x47] },                 // PNG
  { ext: ['.jpg', '.jpeg'], bytes: [0xff, 0xd8, 0xff] },              // JPEG
  { ext: ['.gif'], bytes: [0x47, 0x49, 0x46, 0x38] },                 // GIF8
  { ext: ['.zip', '.docx', '.xlsx', '.pptx'], bytes: [0x50, 0x4b, 0x03, 0x04] } // PK..
];

function magicOk(filePath, ext) {
  const sig = SIGNATURES.find(s => s.ext.includes(ext));
  if (!sig) return true; // text-ish formats: no signature to verify
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(sig.bytes.length);
  fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  return buf.equals(Buffer.from(sig.bytes));
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname || '').toLowerCase()}`)
});
const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new Error(`File type "${ext || 'unknown'}" not allowed`));
    cb(null, true);
  }
});

// One-time migration: encrypt any legacy plaintext files on boot
function migratePlaintextFiles() {
  let count = 0;
  for (const name of fs.readdirSync(config.uploadDir)) {
    const full = path.join(config.uploadDir, name);
    try {
      if (!fs.statSync(full).isFile()) continue;
      const raw = fs.readFileSync(full);
      if (box.isEncrypted(raw)) continue;
      fs.writeFileSync(full, box.encrypt(raw));
      count++;
    } catch {}
  }
  if (count) console.log(`[security] Encrypted ${count} existing file(s) at rest.`);
}
migratePlaintextFiles();

function recordGuard(req, entityType, entityId) {
  if (entityType !== 'records') return true;
  const row = db.prepare('SELECT confidentiality FROM records WHERE id = ?').get(String(entityId));
  if (!row) return true;
  if (row.confidentiality === 'restricted' && !['admin', 'quality_manager', 'management', 'manager', 'compliance_manager'].includes(req.user.role)) return false;
  return true;
}

r.post('/upload', (req, res) => {
  upload.single('file')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const { entity_type, entity_id, category } = req.body || {};
    if (!recordGuard(req, entity_type, entity_id)) { fs.unlinkSync(req.file.path); return res.status(403).json({ error: 'Cannot attach files to a restricted record' }); }

    // Content validation: renamed binaries are rejected by their real header
    if (!magicOk(req.file.path, path.extname(req.file.filename))) {
      fs.unlinkSync(req.file.path);
      audit(req, 'file_upload_rejected', entity_type || 'files', entity_id || null, req.file.originalname, { reason: 'content does not match extension' });
      return res.status(400).json({ error: 'File rejected: its contents do not match the declared file type' });
    }

    // Encrypt at rest (AES-256-GCM)
    try {
      const plain = fs.readFileSync(req.file.path);
      fs.writeFileSync(req.file.path, box.encrypt(plain));
    } catch (e) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(500).json({ error: 'Encryption failed — file not stored' });
    }
    const id = db.prepare('INSERT INTO files (stored_name, original_name, mime, size, entity_type, entity_id, category, uploaded_by) VALUES (?,?,?,?,?,?,?,?)')
      .run(req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, entity_type || null, entity_id || null, category || 'general', req.user.id).lastInsertRowid;
    audit(req, 'file_upload', entity_type || 'files', entity_id || id, req.file.originalname, { size: req.file.size, file_id: id });
    res.status(201).json({ id, original_name: req.file.originalname, size: req.file.size });
  });
});

r.get('/', (req, res) => {
  const { entity_type, entity_id } = req.query;
  const rows = db.prepare('SELECT f.id, f.original_name, f.mime, f.size, f.category, f.downloads, f.created_at, u.name AS uploaded_by_name FROM files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.entity_type = ? AND f.entity_id = ? ORDER BY f.id DESC').all(entity_type || '', entity_id || '');
  res.json({ rows });
});

r.get('/:id/download', (req, res) => {
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(Number(req.params.id));
  if (!f) return res.status(404).json({ error: 'File not found' });
  const full = path.join(config.uploadDir, path.basename(f.stored_name));
  if (!full.startsWith(config.uploadDir) || !fs.existsSync(full)) return res.status(404).json({ error: 'File missing from storage' });
  if (!recordGuard(req, f.entity_type, f.entity_id)) return res.status(403).json({ error: 'Restricted record attachment' });

  db.prepare('UPDATE files SET downloads = downloads + 1 WHERE id = ?').run(f.id);
  audit(req, 'file_download', f.entity_type || 'files', f.entity_id, f.original_name, { file_id: f.id });

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename="${f.original_name.replace(/["\\]/g, '')}"`);
  res.setHeader('Content-Type', f.mime || 'application/octet-stream');
  try {
    const plain = box.decrypt(fs.readFileSync(full)); // handles encrypted + legacy plaintext
    res.send(plain);
  } catch {
    res.status(500).json({ error: 'File could not be decrypted' });
  }
});

r.delete('/:id', (req, res) => {
  if (!['admin', 'quality_manager'].includes(req.user.role)) return res.status(403).json({ error: 'Only administrators or the quality manager may delete files' });
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(Number(req.params.id));
  if (!f) return res.status(404).json({ error: 'File not found' });
  const full = path.join(config.uploadDir, path.basename(f.stored_name));
  if (fs.existsSync(full)) fs.unlinkSync(full);
  db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
  audit(req, 'file_delete', f.entity_type || 'files', f.entity_id, f.original_name, { file_id: f.id });
  res.json({ ok: true });
});

module.exports = r;
