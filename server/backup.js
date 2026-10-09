// Encrypted database backups with retention.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const config = require('./config');
const box = require('./crypto-box');

const BACKUP_DIR = path.join(config.dataDir, 'backups');
const KEEP = 14;

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.db.enc'))
    .sort()
    .reverse()
    .map(f => {
      const full = path.join(BACKUP_DIR, f);
      const st = fs.statSync(full);
      return { file: f, sizeBytes: st.size, created_at: st.mtime.toISOString() };
    });
}

function now() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

function createBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
  const plain = fs.readFileSync(path.join(config.dataDir, 'qms.db'));
  const file = `backup-${now()}.db.enc`;
  fs.writeFileSync(path.join(BACKUP_DIR, file), box.encrypt(plain));
  // retention
  const all = listBackups();
  for (const old of all.slice(KEEP)) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, old.file)); } catch {}
  }
  return { file, sizeBytes: plain.length };
}

module.exports = { createBackup, listBackups, BACKUP_DIR };
