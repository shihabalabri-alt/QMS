// Universal record linking: connect ANY record to ANY other record across all modules.
const express = require('express');
const db = require('../db');
const { MODULES } = require('../modules');
const { authRequired } = require('../middleware/auth');
const { audit } = require('../middleware/audit');

const r = express.Router();
r.use(authRequired);

const norm = k => (k || '').includes('-') ? k.replace(/-/g, '_') : k;

function resolveRecord(typeKey, id) {
  const key = norm(typeKey);
  const m = MODULES[key];
  if (!m) return null;
  const row = db.prepare(`SELECT * FROM ${m.table} WHERE id = ?`).get(Number(id));
  if (!row) return null;
  return {
    key, table: m.table, id: row.id, code: row.code || null,
    title: row.title || row.name || row.code || `${m.title} #${row.id}`,
    status: row.status || null, typeLabel: m.title.replace(/s$/, ''),
    row
  };
}

function canSee(user, key) {
  const m = MODULES[norm(key)];
  if (!m) return false;
  return m.perms.read === 'all' || (Array.isArray(m.perms.read) && m.perms.read.includes(user.role));
}

// All links touching a record (both directions), other side resolved
r.get('/:type/:id', (req, res) => {
  const key = norm(req.params.type);
  const m = MODULES[key];
  if (!m) return res.status(404).json({ error: 'Unknown module' });
  const id = Number(req.params.id);
  const rows = db.prepare('SELECT * FROM links WHERE (from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?) ORDER BY id DESC')
    .all(key, String(id), key, String(id));
  const out = [];
  for (const row of rows) {
    const isFrom = row.from_type === key && row.from_id === String(id);
    const other = resolveRecord(isFrom ? row.to_type : row.from_type, isFrom ? row.to_id : row.from_id);
    if (!other) continue; // linked record was deleted
    if (!canSee(req.user, other.key)) continue;
    out.push({
      id: row.id, rel: row.rel, created_at: row.created_at,
      created_by: row.created_by,
      created_by_name: (db.prepare('SELECT name FROM users WHERE id = ?').get(row.created_by) || {}).name || null,
      direction: isFrom ? 'out' : 'in',
      other: { key: other.key, typeLabel: other.typeLabel, code: other.code, title: other.title, status: other.status, link: `/${other.key.replace(/_/g, '-')}/${other.id}` },
      canDelete: row.created_by === req.user.id || ['admin', 'quality_manager'].includes(req.user.role)
    });
  }
  res.json({ rows: out });
});

// Create a link
r.post('/', (req, res) => {
  const { fromType, fromId, toType, toId, rel } = req.body || {};
  const from = resolveRecord(fromType, fromId);
  const to = resolveRecord(toType, toId);
  if (!from) return res.status(400).json({ error: 'Source record not found' });
  if (!to) return res.status(400).json({ error: 'Target record not found' });
  if (!canSee(req.user, from.key) || !canSee(req.user, to.key)) return res.status(403).json({ error: 'No access to one of the records' });
  if (from.key === to.key && String(from.id) === String(to.id)) return res.status(400).json({ error: 'Cannot link a record to itself' });
  const relText = String(rel || 'related to').trim().slice(0, 120) || 'related to';
  const dup = db.prepare('SELECT id FROM links WHERE from_type=? AND from_id=? AND to_type=? AND to_id=? AND rel=?')
    .get(from.key, String(from.id), to.key, String(to.id), relText);
  if (dup) return res.status(400).json({ error: 'This connection already exists' });
  const id = db.prepare('INSERT INTO links (from_type, from_id, to_type, to_id, rel, created_by) VALUES (?,?,?,?,?,?)')
    .run(from.key, String(from.id), to.key, String(to.id), relText, req.user.id).lastInsertRowid;
  audit(req, 'link_created', 'links', id, `${from.code || from.title} ↔ ${to.code || to.title}`, { rel: relText });
  res.status(201).json({ id, ok: true });
});

// Delete a link
r.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM links WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Link not found' });
  if (row.created_by !== req.user.id && !['admin', 'quality_manager'].includes(req.user.role))
    return res.status(403).json({ error: 'Only the creator or a senior quality role can remove connections' });
  db.prepare('DELETE FROM links WHERE id = ?').run(row.id);
  audit(req, 'link_deleted', 'links', row.id, `${row.from_type}/${row.from_id} ↔ ${row.to_type}/${row.to_id}`);
  res.json({ ok: true });
});

// Auto-detect all relationships for a record across every module
function autoRelations(key, id, user) {
  const self = resolveRecord(key, id);
  if (!self) return [];
  const out = [];
  const seen = new Set();
  const add = (relKey, relId, rel) => {
    const r = resolveRecord(relKey, relId);
    if (!r || (r.key === self.key && String(r.id) === String(self.id))) return;
    const k = r.key + ':' + r.id + ':' + rel;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ key: r.key, typeLabel: r.typeLabel, code: r.code, title: r.title, status: r.status, rel, link: `/${r.key.replace(/_/g, '-')}/${r.id}` });
  };

  // Actions raised from this record
  for (const a of db.prepare('SELECT id FROM actions WHERE source_code = ?').all(self.code)) add('actions', a.id, 'raised action');

  // Type-specific structured relations
  if (self.key === 'nonconformances' && self.row.supplier_id) add('suppliers', self.row.supplier_id, 'supplier involved');
  if (self.key === 'suppliers') {
    for (const n of db.prepare('SELECT id FROM nonconformances WHERE supplier_id = ?').all(id)) add('nonconformances', n.id, 'quality event');
    for (const a of db.prepare('SELECT id FROM audits WHERE supplier_id = ?').all(id)) add('audits', a.id, 'audited');
  }
  if (self.key === 'policies') for (const g of db.prepare('SELECT id FROM goals WHERE policy_id = ?').all(id)) add('goals', g.id, 'measured by');
  if (self.key === 'goals' && self.row.policy_id) add('policies', self.row.policy_id, 'linked policy');
  if (self.key === 'employees') {
    for (const a of db.prepare('SELECT competency_id FROM assessments WHERE employee_id = ?').all(id)) add('competencies', a.competency_id, 'assessed competency');
    for (const tp of db.prepare('SELECT training_id FROM training_participants WHERE employee_id = ?').all(id)) add('trainings', tp.training_id, 'attended training');
  }
  if (self.key === 'competencies') for (const a of db.prepare('SELECT employee_id FROM assessments WHERE competency_id = ?').all(id)) add('employees', a.employee_id, 'assessed person');
  if (self.key === 'trainings') for (const tp of db.prepare('SELECT employee_id FROM training_participants WHERE training_id = ?').all(id)) add('employees', tp.employee_id, 'participant');
  if (self.key === 'audits' && self.row.supplier_id) add('suppliers', self.row.supplier_id, 'audited supplier');

  // Manual links
  for (const l of db.prepare('SELECT * FROM links WHERE (from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?)').all(key, String(id), key, String(id))) {
    const outgoing = l.from_type === key && l.from_id === String(id);
    const other = resolveRecord(outgoing ? l.to_type : l.from_type, outgoing ? l.to_id : l.from_id);
    if (other) add(other.key, other.id, (outgoing ? '' : '← ') + (l.rel || 'linked'));
  }

  // Text mentions of this record's code in other modules
  if (self.code && self.code.length >= 4) {
    for (const [mk, m] of Object.entries(MODULES)) {
      if (mk === self.key || !m.search) continue;
      if (!canRead(user, mk)) continue;
      try {
        const cond = m.search.map(f => `${f} LIKE ?`).join(' OR ');
        const mentions = db.prepare(`SELECT id FROM ${m.table} WHERE (${cond}) LIMIT 3`).all(...m.search.map(() => `%${self.code}%`));
        for (const r of mentions) add(mk, r.id, `references ${self.code}`);
      } catch {}
    }
  }
  return out;
}

module.exports = r;
module.exports.autoRelations = autoRelations;
