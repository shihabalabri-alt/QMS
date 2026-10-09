// Centralized Actions hub — actions from every module, with recurrence & verification.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { audit, notify, emit } = require('../middleware/audit');
const { pad, today, addDays } = require('../utils');

const r = express.Router();
r.use(authRequired);

const STAFF = ['admin', 'quality_manager', 'management', 'manager', 'qa', 'investigator', 'risk_manager', 'compliance_manager'];
const VERIFIERS = ['admin', 'quality_manager', 'management', 'manager', 'qa', 'investigator'];

function nameOf(id) { return (db.prepare('SELECT name FROM users WHERE id = ?').get(id) || {}).name || null; }
function decorate(a) {
  return { ...a, owner_name: nameOf(a.owner_id), overdue: a.due_date && a.due_date < today() && !['completed', 'verified', 'cancelled'].includes(a.status) };
}

// Source resolution: maps an action's source_type + source_code to the exact record
const SOURCE_ROUTES = {
  risk: ['risks', 'risks'],
  nonconformance: ['nonconformances', 'nonconformances'],
  audit: ['audits', 'audits'],
  review: ['management_reviews', 'mgmt-reviews'],
  supplier: ['suppliers', 'suppliers'],
  equipment: ['equipment', 'equipment'],
  competency: ['competencies', 'competencies'],
  document: ['documents', 'documents'],
  policy: ['policies', 'policies'],
  goal: ['goals', 'goals'],
  compliance: ['compliance_requirements', 'compliance'],
  design: ['design_reviews', 'design']
};

r.get('/', (req, res) => {
  const { q, status, priority, source, owner, overdue, limit, offset } = req.query;
  let sql = 'SELECT * FROM actions WHERE 1=1';
  const args = [];
  if (q) { sql += ' AND (title LIKE ? OR code LIKE ? OR source_code LIKE ? OR description LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  if (status && status !== 'all') { sql += ' AND status = ?'; args.push(status); }
  if (priority && priority !== 'all') { sql += ' AND priority = ?'; args.push(priority); }
  if (source && source !== 'all') { sql += ' AND source_type = ?'; args.push(source); }
  if (owner === 'me') { sql += ' AND owner_id = ?'; args.push(req.user.id); }
  if (overdue === '1') sql += " AND due_date < date('now') AND status IN ('open','in_progress')";
  const total = db.prepare(`SELECT COUNT(*) AS c FROM (${sql})`).get(...args).c;
  sql += ` ORDER BY CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date LIMIT ? OFFSET ?`;
  args.push(Math.min(Number(limit) || 300, 1000), Number(offset) || 0);
  // Resolve each action's source record id so the UI can deep-link to the exact record
  const rawRows = db.prepare(sql).all(...args);
  const byTable = new Map();
  for (const a of rawRows) {
    const code = String(a.source_code || a.source_id || '').toUpperCase();
    const table = sourceTable(a.source_type);
    if (code && table) {
      if (!byTable.has(table)) byTable.set(table, new Map());
      byTable.get(table).set(code, null);
    }
  }
  const idMaps = new Map();
  for (const [table, codes] of byTable) {
    try {
      const recs = db.prepare(`SELECT id, code FROM ${table} WHERE code IN (${[...codes.keys()].map(() => '?').join(',')})`).all(...codes.keys());
      idMaps.set(table, new Map(recs.map(x => [x.code, x.id])));
    } catch {}
  }
  res.json({ total, rows: rawRows.map(a => {
    const code = String(a.source_code || a.source_id || '').toUpperCase();
    const table = sourceTable(a.source_type);
    const rid = code && table ? (idMaps.get(table) || new Map()).get(code) : null;
    return { ...decorate(a), source_record_id: rid || null, source_route: sourceRoutePath(a.source_type) };
  }) });
});

function sourceRoutePath(t) {
  return ({ risk: 'risks', nonconformance: 'nonconformances', capa: 'nonconformances', incident: 'nonconformances', audit: 'audits', review: 'mgmt-reviews', supplier: 'suppliers', equipment: 'equipment', competency: 'competencies', document: 'documents', policy: 'policies', goal: 'goals', compliance: 'compliance', design: 'design' })[t] || null;
}

r.get('/stats', (req, res) => {
  const g = (sql, ...a) => db.prepare(sql).get(...a);  res.json({
    open: g("SELECT COUNT(*) c FROM actions WHERE status IN ('open','in_progress')").c,
    overdue: g("SELECT COUNT(*) c FROM actions WHERE due_date < date('now') AND status IN ('open','in_progress')").c,
    dueThisWeek: g("SELECT COUNT(*) c FROM actions WHERE due_date BETWEEN date('now') AND date('now','+7 day') AND status IN ('open','in_progress')").c,
    completed: g("SELECT COUNT(*) c FROM actions WHERE status IN ('completed','verified')").c,
    critical: g("SELECT COUNT(*) c FROM actions WHERE priority IN ('critical','high') AND status IN ('open','in_progress')").c,
    mine: g("SELECT COUNT(*) c FROM actions WHERE owner_id = ? AND status IN ('open','in_progress')", req.user.id).c,
    mineOverdue: g("SELECT COUNT(*) c FROM actions WHERE owner_id = ? AND due_date < date('now') AND status IN ('open','in_progress')", req.user.id).c,
    bySource: db.prepare("SELECT source_type, COUNT(*) c FROM actions WHERE status IN ('open','in_progress') GROUP BY source_type ORDER BY c DESC").all()
  });
});

// ---- Source resolution: maps every action to its original QMS record ----
const SOURCE_TABLES = {
  risk: 'risks', nonconformance: 'nonconformances', capa: 'nonconformances', incident: 'nonconformances',
  audit: 'audits', review: 'management_reviews', supplier: 'suppliers', equipment: 'equipment',
  competency: 'competencies', document: 'documents', policy: 'policies', goal: 'goals',
  compliance: 'compliance_requirements', design: 'design_reviews'
};
const SOURCE_TITLE_COL = {
  risks: 'title', nonconformances: 'title', audits: 'title', management_reviews: 'title',
  suppliers: 'name', equipment: 'name', competencies: 'name', documents: 'title',
  policies: 'title', goals: 'title', compliance_requirements: 'title', design_reviews: 'title'
};

function sourceTable(t) { return SOURCE_TABLES[t] || null; }

// Resolves an action's source_code to the exact original record (id, code, title, status)
r.get('/:id(\\d+)', (req, res) => {
  const a = db.prepare('SELECT * FROM actions WHERE id = ?').get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Not found' });
  const comments = db.prepare('SELECT c.*, u.name AS user_name FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE entity_type = ? AND entity_id = ? ORDER BY c.id DESC').all('actions', String(a.id));
  const files = db.prepare('SELECT id, original_name, size, mime, category, created_at FROM files WHERE entity_type = ? AND entity_id = ?').all('actions', String(a.id));
  const history = db.prepare('SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT 25').all('actions', String(a.id));
  const source = resolveSource(a);
  res.json({ row: decorate(a), comments, files, history, source });
});
function sourceRoute(t) {
  return ({ risk: 'risks', nonconformance: 'nonconformances', capa: 'nonconformances', incident: 'nonconformances', audit: 'audits', review: 'mgmt-reviews', supplier: 'suppliers', equipment: 'equipment', competency: 'competencies', document: 'documents', policy: 'policies', goal: 'goals', compliance: 'compliance', design: 'design' })[t] || null;
}
// Resolve the actual source record for an action → { id, code, title, status, link }
function resolveSource(a) {
  if (!a.source_type || !a.source_code) return null;
  const table = sourceTable(a.source_type);
  if (!table) return null;
  try {
    const src = db.prepare(`SELECT * FROM ${table} WHERE code = ?`).get(a.source_code);
    if (!src) return null;
    const route = sourceRoute(a.source_type);
    return {
      id: src.id, code: src.code,
      title: src.title || src.name || src.code,
      status: src.status || null,
      link: route ? `/${route}/${src.id}` : null,
      module: sourceRoute(a.source_type)
    };
  } catch { return null; }
}

r.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: 'Title required' });
  const max = db.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(code,5) AS INTEGER)),0) m FROM actions WHERE code LIKE 'ACT-%'").get().m;
  const code = `ACT-${pad(max + 1, 4)}`;
  const id = db.prepare('INSERT INTO actions (code, title, description, source_type, source_code, owner_id, priority, due_date, recurrence, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(code, b.title, b.description || '', b.source_type || 'manual', b.source_code || null, b.owner_id || req.user.id, b.priority || 'medium', b.due_date || null, b.recurrence || 'none', req.user.id).lastInsertRowid;
  audit(req, 'create', 'actions', id, `${code} ${b.title}`);
  if (b.owner_id && b.owner_id !== req.user.id) notify(b.owner_id, 'New action assigned', `${code}: ${b.title}`, `/actions?focus=${id}`, 'info');
  emit('action.created', { code, id });
  res.status(201).json({ row: decorate(db.prepare('SELECT * FROM actions WHERE id = ?').get(id)) });
});

r.put('/:id(\\d+)', (req, res) => {
  const a = db.prepare('SELECT * FROM actions WHERE id = ?').get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Not found' });
  const isOwner = a.owner_id === req.user.id;
  if (!isOwner && !STAFF.includes(req.user.role)) return res.status(403).json({ error: 'Only the owner or quality staff can edit this action' });
  const b = req.body || {};
  const fields = ['title', 'description', 'owner_id', 'priority', 'due_date', 'recurrence', 'source_type', 'source_code'];
  const sets = [], vals = [], diff = {};
  for (const f of fields) if (b[f] !== undefined) {
    let v = (f === 'owner_id' || f === 'priority') && b[f] === '' ? null : b[f];
    sets.push(`${f} = ?`); vals.push(v);
    if (String(a[f]) !== String(v)) diff[f] = { from: a[f], to: v };
  }
  if (b.status !== undefined && b.status !== a.status && ['open', 'in_progress', 'cancelled'].includes(b.status)) { sets.push('status = ?'); vals.push(b.status); diff.status = { from: a.status, to: b.status }; }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(a.id);
  db.prepare(`UPDATE actions SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  audit(req, 'update', 'actions', a.id, `${a.code} ${a.title}`, diff);
  if (diff.owner_id && diff.owner_id.to) notify(diff.owner_id.to, 'Action reassigned to you', `${a.code}: ${a.title}`, `/actions?focus=${a.id}`, 'info');
  res.json({ row: decorate(db.prepare('SELECT * FROM actions WHERE id = ?').get(a.id)) });
});

r.post('/:id(\\d+)/complete', (req, res) => {
  const a = db.prepare('SELECT * FROM actions WHERE id = ?').get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (a.owner_id !== req.user.id && !STAFF.includes(req.user.role)) return res.status(403).json({ error: 'Only the owner or quality staff can complete this action' });
  if (!['open', 'in_progress'].includes(a.status)) return res.status(400).json({ error: `Action is ${a.status}` });
  const note = (req.body || {}).notes || '';
  db.prepare("UPDATE actions SET status = 'completed', completed_at = ?, verification_notes = ? WHERE id = ?").run(new Date().toISOString(), note, a.id);
  audit(req, 'complete', 'actions', a.id, `${a.code} ${a.title}`, { note });

  let spawned = null;
  if (a.recurrence && a.recurrence !== 'none' && a.status !== 'cancelled') {
    const add = { weekly: 7, monthly: 30, quarterly: 91 }[a.recurrence] || 30;
    const base = a.due_date && a.due_date >= today() ? a.due_date : today();
    const max = db.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(code,5) AS INTEGER)),0) m FROM actions WHERE code LIKE 'ACT-%'").get().m;
    const code = `ACT-${pad(max + 1, 4)}`;
    const id = db.prepare('INSERT INTO actions (code, title, description, source_type, source_code, owner_id, priority, due_date, recurrence, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(code, a.title, a.description, a.source_type, a.source_code, a.owner_id, a.priority, addDays(base, add), a.recurrence, req.user.id).lastInsertRowid;
    db.prepare('UPDATE actions SET next_instance = ? WHERE id = ?').run(id, a.id);
    spawned = { id, code, due_date: addDays(base, add) };
    if (a.owner_id) notify(a.owner_id, 'Recurring action scheduled', `${code}: ${a.title} due ${spawned.due_date}`, `/actions?focus=${id}`, 'info');
  }
  res.json({ row: decorate(db.prepare('SELECT * FROM actions WHERE id = ?').get(a.id)), spawned });
});

r.post('/:id(\\d+)/verify', (req, res) => {
  const a = db.prepare('SELECT * FROM actions WHERE id = ?').get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (!VERIFIERS.includes(req.user.role)) return res.status(403).json({ error: 'Verification requires a quality/management role (human verification step)' });
  if (a.status !== 'completed') return res.status(400).json({ error: 'Action must be completed before verification' });
  const note = (req.body || {}).notes || '';
  db.prepare("UPDATE actions SET status = 'verified', verified_by = ?, verification_notes = ? WHERE id = ?").run(req.user.id, note || a.verification_notes, a.id);
  audit(req, 'verify', 'actions', a.id, `${a.code} ${a.title}`, { note, verified_by: req.user.id });
  if (a.owner_id) notify(a.owner_id, 'Action verified', `${a.code}: ${a.title} was verified by ${req.user.name}.`, `/actions?focus=${a.id}`, 'success');
  res.json({ row: decorate(db.prepare('SELECT * FROM actions WHERE id = ?').get(a.id)) });
});

r.post('/:id(\\d+)/reopen', (req, res) => {
  const a = db.prepare('SELECT * FROM actions WHERE id = ?').get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (!STAFF.includes(req.user.role)) return res.status(403).json({ error: 'Only quality staff can reopen actions' });
  if (!['completed', 'verified', 'cancelled'].includes(a.status)) return res.status(400).json({ error: 'Action is not closed' });
  db.prepare("UPDATE actions SET status = 'open', completed_at = NULL WHERE id = ?").run(a.id);
  audit(req, 'reopen', 'actions', a.id, `${a.code} ${a.title}`, { note: (req.body || {}).note || '' });
  if (a.owner_id) notify(a.owner_id, 'Action reopened', `${a.code}: ${a.title}`, `/actions?focus=${a.id}`, 'warning');
  res.json({ row: decorate(db.prepare('SELECT * FROM actions WHERE id = ?').get(a.id)) });
});

r.get('/:id(\\d+)/comments', (req, res) => {
  res.json({ rows: db.prepare('SELECT c.*, u.name AS user_name FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE entity_type = ? AND entity_id = ? ORDER BY c.id DESC').all('actions', req.params.id) });
});
r.post('/:id(\\d+)/comments', (req, res) => {
  const a = db.prepare('SELECT * FROM actions WHERE id = ?').get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Not found' });
  const body = (req.body || {}).body;
  if (!body) return res.status(400).json({ error: 'Comment required' });
  db.prepare('INSERT INTO comments (entity_type, entity_id, user_id, body) VALUES (?,?,?,?)').run('actions', String(a.id), req.user.id, body);
  audit(req, 'comment', 'actions', a.id, a.code);
  if (a.owner_id && a.owner_id !== req.user.id) notify(a.owner_id, 'Comment on your action', `${a.code}: ${String(body).slice(0, 80)}`, `/actions?focus=${a.id}`, 'info');
  res.status(201).json({ ok: true });
});

module.exports = r;
