// Generic CRUD + workflow engine driven by the module registry.
const express = require('express');
const db = require('../db');
const { MODULES, can } = require('../modules');
const { authRequired } = require('../middleware/auth');
const { audit, notify, emit } = require('../middleware/audit');
const { pad, today, nowIso, daysUntil, riskRating, addDays } = require('../utils');

const r = express.Router();

// Accept URL variants like mgmt-reviews for registry key mgmt_reviews
const norm = k => (k || '').includes('-') ? k.replace(/-/g, '_') : k;
r.use(authRequired);

const NUM_INT = ['id', '_id'];

function decorate(key, m, row) {
  if (!row) return row;
  if (m.table === 'risks') {
    row.inherent_score = (row.inherent_likelihood || 0) * (row.inherent_severity || 0);
    row.residual_score = (row.residual_likelihood || 0) * (row.residual_severity || 0);
    row.inherent_rating = riskRating(row.inherent_score);
    row.residual_rating = riskRating(row.residual_score);
  }
  const dueFields = m.dueFields || (m.dueField ? [m.dueField] : []);
  for (const f of dueFields) if (row[f]) row[f + '_days'] = daysUntil(row[f]);
  return row;
}

function canReadRow(user, m, row) {
  const rc = m.perms && m.perms.readConfidentiality;
  if (rc && row.confidentiality === 'restricted') return (rc.restricted || []).includes(user.role);
  return true;
}

function coerce(field, value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  switch (field.type) {
    case 'number': {
      const n = Number(value);
      if (Number.isNaN(n)) throw new Error(`${field.label} must be a number`);
      return n;
    }
    case 'boolean': return value === true || value === '1' || value === 1 || value === 'true' ? 1 : 0;
    default: return String(value);
  }
}

function nextCode(m) {
  const prefixes = m.aliasCodes || [m.prefix];
  let max = 0;
  for (const p of prefixes) {
    const rows = db.prepare(`SELECT code FROM ${m.table} WHERE code LIKE ?`).all(`${p}-%`);
    for (const row of rows) { const n = parseInt(row.code.split('-')[1], 10); if (n > max) max = n; }
  }
  return `${m.prefix}-${pad(max + 1, 4)}`;
}

function whitelistedBody(m, body, existing) {
  const out = {};
  const errors = [];
  for (const f of m.fields) {
    const has = Object.prototype.hasOwnProperty.call(body, f.name);
    if (f.type === 'ref' && body[f.name] === '') body[f.name] = null;
    if (f.ref && body[f.name] === 0) body[f.name] = null;
    if (!has) {
      if (!existing && f.required) errors.push(`${f.label} is required`);
      continue;
    }
    try { out[f.name] = coerce(f, body[f.name]); } catch (e) { errors.push(e.message); }
  }
  if (existing) {
    for (const f of m.fields) {
      if (f.required && !out[f.name] && out[f.name] !== 0 && Object.prototype.hasOwnProperty.call(out, f.name) && (out[f.name] === null || out[f.name] === '')) {
        if (!existing[f.name]) errors.push(`${f.label} is required`);
        else delete out[f.name];
      }
    }
  }
  return { out, errors };
}

function loadChildDefs(m) {
  const defs = [];
  if (m.child) defs.push({ key: m.child.key || m.child.table, ...m.child });
  if (m.children) defs.push(...m.children);
  return defs;
}

function resolveRefs(rows, defs) {
  const cache = {};
  const nameOf = (table, id) => {
    if (id === null || id === undefined) return null;
    if (!cache[table]) {
      const col = table === 'users' || table === 'employees' || table === 'suppliers' ? (table === 'suppliers' ? 'name' : 'name') : (table === 'policies' || table === 'documents' || table === 'trainings' ? 'title' : 'name');
      cache[table] = db.prepare(`SELECT id, ${col} AS label FROM ${table}`).all().reduce((a, x) => { a[x.id] = x.label; return a; }, {});
    }
    return cache[table][id] || null;
  };
  return rows.map(row => {
    const copy = { ...row };
    for (const [k, v] of Object.entries(row)) {
      if (k.endsWith('_id') && v !== null) {
        const t = { owner_id: 'users', manager_id: 'employees', employee_id: 'employees', competency_id: 'competencies', policy_id: 'policies', supplier_id: 'suppliers', chair_id: 'users', lead_auditor_id: 'users', raised_by: 'users', verified_by: 'users', approved_by: 'users', assessor_id: 'users', evaluator_id: 'users', performed_by: 'users', user_id: 'users', equipment_id: 'equipment', training_id: 'trainings' }[k];
        if (t) copy[k.replace('_id', '_name')] = nameOf(t, v);
      }
    }
    return copy;
  });
}

/* ---------------- LIST ---------------- */
r.get('/:module', (req, res, next) => {
  if (req.params.module === 'actions') return next('route');
  const m = MODULES[norm(req.params.module)];
  if (!m) return next();
  if (!(m.perms.read === 'all' || (Array.isArray(m.perms.read) && m.perms.read.includes(req.user.role))))
    return res.status(403).json({ error: 'You do not have access to this module' });

  const { q, status, owner, limit, offset } = req.query;
  let sql = `SELECT * FROM ${m.table} WHERE 1=1`;
  const args = [];
  if (q && m.search) {
    sql += ` AND (${m.search.map(c => `${c} LIKE ?`).join(' OR ')})`;
    m.search.forEach(() => args.push(`%${q}%`));
  }
  if (status && status !== 'all') { sql += ' AND status = ?'; args.push(status); }
  if (owner === 'me') {
    const ownerCols = ['owner_id', 'chair_id', 'lead_auditor_id'].filter(c => db.prepare(`SELECT 1 FROM pragma_table_info('${m.table}') WHERE name = ?`).get(c));
    if (ownerCols.length) { sql += ` AND ${ownerCols[0]} = ?`; args.push(req.user.id); }
  }
  if (m.table === 'records' && !['admin', 'quality_manager', 'management', 'manager', 'compliance_manager'].includes(req.user.role))
    sql += ` AND confidentiality != 'restricted'`;

  const total = db.prepare(`SELECT COUNT(*) AS c FROM (${sql})`).get(...args).c;
  const hasCodeCol = db.prepare(`SELECT 1 AS x FROM pragma_table_info('${m.table}') WHERE name = 'code'`).get();
  const orderCol = (hasCodeCol && hasCodeCol.x) ? 'code' : 'id';
  sql += ` ORDER BY ${orderCol} LIMIT ? OFFSET ?`;
  args.push(Math.min(Number(limit) || 200, 500), Number(offset) || 0);
  const rows = db.prepare(sql).all(...args).map(row => decorate(req.params.module, m, row));
  res.json({ total, rows });
});

/* ---------------- DETAIL ---------------- */
r.get('/:module/:id', (req, res, next) => {
  if (req.params.module === 'actions') return next('route');
  const m = MODULES[norm(req.params.module)];
  if (!m || Number.isNaN(Number(req.params.id))) return next();
  if (!(m.perms.read === 'all' || (Array.isArray(m.perms.read) && m.perms.read.includes(req.user.role))))
    return res.status(403).json({ error: 'You do not have access to this module' });
  const row = db.prepare(`SELECT * FROM ${m.table} WHERE id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!canReadRow(req.user, m, row)) return res.status(403).json({ error: 'This record is restricted' });

  const children = {};
  for (const cd of loadChildDefs(m)) {
    const order = cd.orderBy || 'id DESC';
    const rows = resolveRefs(db.prepare(`SELECT * FROM ${cd.table} WHERE ${cd.fk} = ? ORDER BY ${order}`).all(row.id), cd.fields);
    children[cd.key] = rows;
  }
  const actions = db.prepare('SELECT * FROM actions WHERE source_code = ? ORDER BY due_date').all(row.code);
  const comments = resolveRefs(db.prepare('SELECT * FROM comments WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC').all(m.table, String(row.id)), []).map(c => ({ ...c, user_name: c.user_name || (db.prepare('SELECT name FROM users WHERE id = ?').get(c.user_id) || {}).name }));
  const files = db.prepare('SELECT f.id, f.original_name, f.size, f.mime, f.category, f.created_at, f.downloads, u.name AS uploaded_by_name FROM files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.entity_type = ? AND f.entity_id = ?').all(m.table, String(row.id));
  const history = db.prepare(`SELECT * FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT 25`).all(m.table, String(row.id));
  const approvalsList = db.prepare('SELECT * FROM approvals WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC').all(m.table, String(row.id));
  const canTransition = m.transitions ? (m.transitions[row.status] || []) : [];

  res.json({
    row: decorate(req.params.module, m, resolveRefs([row])[0]),
    children, actions, comments, files, history, approvals: approvalsList,
    workflow: {
      transitions: canTransition,
      canApprove: m.approveRole ? m.approveRole.includes(req.user.role) : false,
      closeRequires: m.closeRequires || null
    },
    perms: { update: can(req.user, m, 'update'), delete: can(req.user, m, 'delete') }
  });
});

/* ---------------- CREATE ---------------- */
r.post('/:module', (req, res, next) => {
  if (req.params.module === 'actions') return next('route');
  const m = MODULES[norm(req.params.module)];
  if (!m) return next();
  if (!can(req.user, m, 'create')) return res.status(403).json({ error: 'You do not have permission to create records in this module' });
  const { out, errors } = whitelistedBody(m, req.body || {}, null);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const code = nextCode(m);
  const keys = ['code', ...Object.keys(out)];
  const vals = [code, ...Object.values(out)];
  if (m.table === 'nonconformances') { keys.push('raised_by'); vals.push(req.user.id); if (!out.owner_id) { keys[keys.length - 1] = 'owner_id'; vals[vals.length - 1] = req.user.id; keys.push('raised_by'); vals.push(req.user.id); } }
  try {
    const id = db.prepare(`INSERT INTO ${m.table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...vals).lastInsertRowid;
    const row = db.prepare(`SELECT * FROM ${m.table} WHERE id = ?`).get(id);
    audit(req, 'create', m.table, id, `${code} ${row.title || row.name || ''}`, { fields: out });
    if (out.owner_id && out.owner_id !== req.user.id)
      notify(out.owner_id, `New ${m.title.toLowerCase()} assigned`, `${code}: ${row.title || row.name}`, `/${req.params.module}/${id}`, 'info');
    emit(`${req.params.module}.created`, { module: req.params.module, code, id });
    res.status(201).json({ row: decorate(req.params.module, m, row) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: 'A record with this code already exists' });
    res.status(400).json({ error: e.message });
  }
});

/* ---------------- UPDATE ---------------- */
r.put('/:module/:id', (req, res, next) => {
  if (req.params.module === 'actions') return next('route');
  const m = MODULES[norm(req.params.module)];
  if (!m || Number.isNaN(Number(req.params.id))) return next();
  const row = db.prepare(`SELECT * FROM ${m.table} WHERE id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Not found' });
  const allowed = can(req.user, m, 'update') ||
    (m.perms.updateSelfRole === req.user.role && (row.owner_id === req.user.id || row.user_id === req.user.id));
  if (!allowed) return res.status(403).json({ error: 'You do not have permission to update this record' });

  const { out, errors } = whitelistedBody(m, req.body || {}, row);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  // Status changes must go through the workflow endpoint
  delete out.status;
  if (!Object.keys(out).length) return res.status(400).json({ error: 'No valid fields to update' });
  const sets = Object.keys(out).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE ${m.table} SET ${sets} WHERE id = ?`).run(...Object.values(out), row.id);
  const updated = db.prepare(`SELECT * FROM ${m.table} WHERE id = ?`).get(row.id);
  const diff = {};
  for (const k of Object.keys(out)) if (String(row[k]) !== String(updated[k])) diff[k] = { from: row[k], to: updated[k] };
  audit(req, 'update', m.table, row.id, `${row.code} ${row.title || row.name || ''}`, diff);
  if (out.owner_id && out.owner_id !== row.owner_id && out.owner_id !== req.user.id)
    notify(out.owner_id, `${m.title.replace(/s$/, '')} reassigned to you`, `${row.code}: ${updated.title || updated.name || ''}`, `/${req.params.module}/${row.id}`, 'info');
  emit(`${req.params.module}.updated`, { module: req.params.module, code: row.code, id: row.id, changes: Object.keys(out) });
  res.json({ row: decorate(req.params.module, m, updated) });
});

/* ---------------- WORKFLOW TRANSITION ---------------- */
r.post('/:module/:id/status', (req, res, next) => {
  if (req.params.module === 'actions') return next('route');
  const m = MODULES[norm(req.params.module)];
  if (!m || Number.isNaN(Number(req.params.id))) return next();
  const row = db.prepare(`SELECT * FROM ${m.table} WHERE id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!can(req.user, m, 'update')) return res.status(403).json({ error: 'You do not have permission to change workflow status' });
  const to = (req.body || {}).status;
  const note = (req.body || {}).note || '';
  if (!to || to === row.status) return res.status(400).json({ error: 'New status required' });
  if (!m.transitions) return res.status(400).json({ error: 'This module has no workflow transitions' });
  const allowedNext = m.transitions[row.status] || [];
  if (!allowedNext.includes(to)) return res.status(400).json({ error: `Invalid transition: ${row.status} → ${to}. Allowed: ${allowedNext.join(', ') || 'none'}` });

  const isFinalApproval = ['approved', 'closed', 'issued', 'disqualified'].includes(to);
  if (isFinalApproval && m.approveRole && !m.approveRole.includes(req.user.role))
    return res.status(403).json({ error: 'Only authorized approvers may perform this transition (human approval required)' });
  if (to === 'closed' && m.closeRequires) {
    for (const f of m.closeRequires) if (!row[f]) return res.status(400).json({ error: `Cannot close: field "${f.replace(/_/g, ' ')}" must be completed first` });
  }

  const sets = ['status = ?'];
  const args = [to];
  if (m.table === 'policies' && to === 'approved' && !row.effective_date) { sets.push('effective_date = ?'); args.push(today()); }
  if (m.table === 'nonconformances' && to === 'closed') { sets.push('closed_at = ?', 'verified_at = ?', 'verified_by = ?'); args.push(today(), today(), req.user.id); }
  if (m.table === 'audits' && to === 'closed' && !row.conducted_on) { sets.push('conducted_on = ?'); args.push(today()); }
  args.push(row.id);
  db.prepare(`UPDATE ${m.table} SET ${sets.join(', ')} WHERE id = ?`).run(...args);

  if (m.table === 'documents' && to === 'approved') {
    const parts = String(row.version || '1.0').split('.');
    const newVer = `${Number(parts[0])}.${Number(parts[1] || 0) + 1}`;
    db.prepare('UPDATE documents SET version = ?, effective_date = COALESCE(effective_date, ?) WHERE id = ?').run(newVer, today(), row.id);
    db.prepare('INSERT INTO document_versions (document_id, version, change_summary, status, approved_by, approved_at) VALUES (?,?,?,?,?,?)')
      .run(row.id, newVer, note || row.change_summary || 'Approved via workflow.', 'approved', req.user.id, today());
    db.prepare('UPDATE document_versions SET status = ? WHERE document_id = ? AND status = ?').run('superseded', row.id, 'approved');
    const keep = db.prepare('SELECT id FROM document_versions WHERE document_id = ? ORDER BY id DESC LIMIT 1').get(row.id);
    db.prepare('UPDATE document_versions SET status = ? WHERE id = ?').run('approved', keep.id);
  }

  db.prepare('INSERT INTO approvals (entity_type, entity_id, from_state, to_state, approver_id, approver_name, comment, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(m.table, String(row.id), row.status, to, req.user.id, req.user.name, note, nowIso());
  audit(req, 'status_change', m.table, row.id, `${row.code} ${row.title || row.name || ''}`, { from: row.status, to, note });
  if (row.owner_id && row.owner_id !== req.user.id)
    notify(row.owner_id, `${m.title.replace(/s$/, '')} status: ${to}`, `${row.code}: ${row.title || row.name || ''}`, `/${req.params.module}/${row.id}`, isFinalApproval ? 'success' : 'info');
  emit(`${req.params.module}.${to}`, { module: req.params.module, code: row.code, id: row.id, status: to, by: req.user.id });
  res.json({ row: db.prepare(`SELECT * FROM ${m.table} WHERE id = ?`).get(row.id) });
});

/* ---------------- DELETE ---------------- */
r.delete('/:module/:id', (req, res, next) => {
  if (req.params.module === 'actions') return next('route');
  const m = MODULES[norm(req.params.module)];
  if (!m || Number.isNaN(Number(req.params.id))) return next();
  const row = db.prepare(`SELECT * FROM ${m.table} WHERE id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!can(req.user, m, 'delete')) return res.status(403).json({ error: 'Only senior quality roles may delete records' });
  if (m.table === 'nonconformances' && !['closed'].includes(row.status))
    return res.status(400).json({ error: 'Non-conformances must be closed before deletion (record integrity)' });
  db.prepare(`DELETE FROM ${m.table} WHERE id = ?`).run(row.id);
  audit(req, 'delete', m.table, row.id, `${row.code} ${row.title || row.name || ''}`, { snapshot: JSON.stringify(row).slice(0, 800) });
  res.json({ ok: true });
});

/* ---------------- CHILDREN (linked records) ---------------- */
r.post('/:module/:id/children/:key', (req, res, next) => {
  if (req.params.module === 'actions') return next('route');
  const m = MODULES[norm(req.params.module)];
  if (!m || Number.isNaN(Number(req.params.id))) return next();
  const cd = loadChildDefs(m).find(c => c.key === req.params.key);
  if (!cd) return res.status(404).json({ error: 'Unknown child collection' });
  const parent = db.prepare(`SELECT * FROM ${m.table} WHERE id = ?`).get(Number(req.params.id));
  if (!parent) return res.status(404).json({ error: 'Parent not found' });
  if (cd.readOnly) return res.status(403).json({ error: 'This collection is system-managed' });
  if (!can(req.user, m, 'update')) return res.status(403).json({ error: 'No permission' });

  const body = req.body || {};
  const cols = [cd.fk];
  const vals = [parent.id];
  for (const f of cd.fields) {
    if (body[f] === undefined) { cols.push(f); vals.push(null); continue; }
    let v = body[f];
    if (typeof v === 'number' || /_score|level|hours|score/.test(f)) v = v === '' || v === null ? null : Number(v);
    cols.push(f); vals.push(v === '' ? null : v);
  }
  try {
    const id = db.prepare(`INSERT INTO ${cd.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals).lastInsertRowid;
    audit(req, 'child_create', cd.table, id, `${parent.code} → ${cd.key}`, { fields: body });

    // Automation: audit findings and major design findings generate tracked actions
    let madeAction = null;
    const finding = cd.table === 'audit_items' ? body : (cd.table === 'design_findings' ? body : null);
    if (finding && (finding.finding_type === 'major' || finding.severity === 'major')) {
      madeAction = createActionFromSource({
        title: `${cd.table === 'audit_items' ? 'Audit finding' : 'Design finding'}: ${(finding.description || '').slice(0, 80)}`,
        source_type: cd.table === 'audit_items' ? 'audit' : 'design',
        source_code: parent.code, owner_id: finding.owner_id || parent.owner_id || req.user.id,
        priority: 'high', due_date: finding.due_date || null, created_by: req.user.id
      });
    }
    // Goal measurement alerts
    if (cd.table === 'goal_entries' && parent.target_value != null && body.value != null) {
      const miss = parent.direction === 'higher' ? Number(body.value) < parent.target_value : Number(body.value) > parent.target_value;
      if (miss && parent.owner_id) notify(parent.owner_id, 'KPI off target', `${parent.code} ${parent.title}: recorded ${body.value}${parent.target_unit} vs target ${parent.target_value}${parent.target_unit}`, `/goals/${parent.id}`, 'warning');
    }
    // Supplier evaluation threshold
    if (cd.table === 'supplier_evaluations' && Number(body.total_score) < 70 && parent.code) {
      const sup = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(parent.id);
      for (const u of db.prepare(`SELECT id FROM users WHERE role IN ('quality_manager','supplier_manager')`).all())
        notify(u.id, 'Supplier below performance threshold', `${sup.code} ${sup.name}: score ${body.total_score}/100 — policy POL-0003 requires action.`, `/suppliers/${sup.id}`, 'warning');
    }
    emit(`${req.params.module}.child_created`, { module: req.params.module, parent: parent.code, child: cd.key, id });
    res.status(201).json({ id, madeAction });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* ---------------- COMMENTS ---------------- */
r.get('/:module/:id/comments', (req, res, next) => {
  if (req.params.module === 'actions') return next('route');
  const m = MODULES[norm(req.params.module)];
  if (!m) return next();
  const rows = db.prepare('SELECT c.*, u.name AS user_name FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.entity_type = ? AND c.entity_id = ? ORDER BY c.id DESC').all(m.table, String(req.params.id));
  res.json({ rows });
});
r.post('/:module/:id/comments', (req, res, next) => {
  if (req.params.module === 'actions') return next('route');
  const m = MODULES[norm(req.params.module)];
  if (!m) return next();
  const body = (req.body || {}).body;
  if (!body) return res.status(400).json({ error: 'Comment body required' });
  const row = db.prepare(`SELECT * FROM ${m.table} WHERE id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Not found' });
  const id = db.prepare('INSERT INTO comments (entity_type, entity_id, user_id, body) VALUES (?,?,?,?)').run(m.table, String(row.id), req.user.id, body).lastInsertRowid;
  audit(req, 'comment', m.table, row.id, row.code);
  if (row.owner_id && row.owner_id !== req.user.id)
    notify(row.owner_id, 'New comment on your record', `${row.code}: ${String(body).slice(0, 80)}`, `/${req.params.module}/${row.id}`, 'info');
  res.status(201).json({ id });
});

/* ---------------- HISTORY ---------------- */
r.get('/:module/:id/history', (req, res, next) => {
  if (req.params.module === 'actions') return next('route');
  const m = MODULES[norm(req.params.module)];
  if (!m) return next();
  const rows = db.prepare('SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.entity_type = ? AND a.entity_id = ? ORDER BY a.id DESC LIMIT 100').all(m.table, String(req.params.id));
  res.json({ rows });
});

function createActionFromSource(a) {
  const max = db.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(code, 5) AS INTEGER)), 0) AS m FROM actions WHERE code LIKE 'ACT-%'").get().m;
  const code = `ACT-${pad(max + 1, 4)}`;
  const id = db.prepare('INSERT INTO actions (code, title, source_type, source_code, owner_id, priority, due_date, created_by, status) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(code, a.title, a.source_type, a.source_code, a.owner_id, a.priority || 'medium', a.due_date, a.created_by, 'open').lastInsertRowid;
  return { id, code };
}

module.exports = r;
