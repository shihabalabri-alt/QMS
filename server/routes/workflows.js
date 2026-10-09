// Workflow rules admin API + dependency management
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const engine = require('../workflow-engine');

const r = express.Router();
r.use(authRequired);

const ADMIN = ['admin', 'quality_manager'];

// ---- Workflow Rules CRUD ----
r.get('/rules', (req, res) => {
  if (!ADMIN.includes(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
  const rows = db.prepare('SELECT * FROM workflow_rules ORDER BY module, trigger_event, id').all();
  res.json({ rows: rows.map(x => ({ ...x, conditions: JSON.parse(x.conditions || '[]'), actions: JSON.parse(x.actions || '[]') })) });
});

r.post('/rules', (req, res) => {
  if (!ADMIN.includes(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
  const { name, description, module, trigger_event, conditions, actions } = req.body || {};
  if (!name || !module || !trigger_event || !actions) return res.status(400).json({ error: 'Name, module, trigger_event, and actions are required' });
  const id = db.prepare('INSERT INTO workflow_rules (name, description, module, trigger_event, conditions, actions, created_by) VALUES (?,?,?,?,?,?,?)')
    .run(name, description || '', module, trigger_event, JSON.stringify(conditions || []), JSON.stringify(actions), req.user.id).lastInsertRowid;
  audit(req, 'create', 'workflow_rules', id, name);
  res.status(201).json({ id });
});

r.put('/rules/:id', (req, res) => {
  if (!ADMIN.includes(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
  const rule = db.prepare('SELECT * FROM workflow_rules WHERE id = ?').get(Number(req.params.id));
  if (!rule) return res.status(404).json({ error: 'Not found' });
  const { name, description, module, trigger_event, conditions, actions, active } = req.body || {};
  db.prepare('UPDATE workflow_rules SET name=?, description=?, module=?, trigger_event=?, conditions=?, actions=?, active=? WHERE id=?')
    .run(name ?? rule.name, description ?? rule.description, module ?? rule.module, trigger_event ?? rule.trigger_event,
      conditions ? JSON.stringify(conditions) : rule.conditions, actions ? JSON.stringify(actions) : rule.actions,
      active !== undefined ? (active ? 1 : 0) : rule.active, rule.id);
  audit(req, 'update', 'workflow_rules', rule.id, name || rule.name);
  res.json({ ok: true });
});

r.delete('/rules/:id', (req, res) => {
  if (!['admin'].includes(req.user.role)) return res.status(403).json({ error: 'Only administrators can delete workflow rules' });
  const rule = db.prepare('SELECT * FROM workflow_rules WHERE id = ?').get(Number(req.params.id));
  if (!rule) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM workflow_rules WHERE id = ?').run(rule.id);
  audit(req, 'delete', 'workflow_rules', rule.id, rule.name);
  res.json({ ok: true });
});

// ---- Workflow execution log ----
r.get('/executions', (req, res) => {
  if (!ADMIN.includes(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
  const { limit = 100 } = req.query;
  const rows = db.prepare('SELECT * FROM workflow_executions ORDER BY id DESC LIMIT ?').all(Math.min(Number(limit) || 100, 300));
  res.json({ rows: rows.map(x => ({ ...x, conditions_evaluated: JSON.parse(x.conditions_evaluated || '{}'), actions_taken: JSON.parse(x.actions_taken || '[]') })) });
});

// ---- Action Dependencies ----
r.get('/dependencies/:actionId', (req, res) => {
  const deps = db.prepare(`
    SELECT ad.id, ad.depends_on_id, a.code, a.title, a.status, a.priority, a.due_date
    FROM action_dependencies ad JOIN actions a ON a.id = ad.depends_on_id
    WHERE ad.action_id = ? ORDER BY a.due_date
  `).all(Number(req.params.actionId));
  res.json({ rows: deps, blocked: deps.some(d => !['completed', 'verified', 'cancelled'].includes(d.status)) });
});

r.post('/dependencies/:actionId', (req, res) => {
  const { dependsOnId } = req.body || {};
  if (!dependsOnId) return res.status(400).json({ error: 'dependsOnId required' });
  if (Number(dependsOnId) === Number(req.params.actionId)) return res.status(400).json({ error: 'Action cannot depend on itself' });
  // Check for circular dependencies
  const check = db.prepare(`
    WITH RECURSIVE chain(id) AS (
      SELECT depends_on_id FROM action_dependencies WHERE action_id = ?
      UNION ALL
      SELECT ad.depends_on_id FROM action_dependencies ad JOIN chain c ON c.id = ad.action_id
    ) SELECT id FROM chain WHERE id = ?
  `).get(Number(dependsOnId), Number(req.params.actionId));
  if (check) return res.status(400).json({ error: 'Circular dependency detected' });
  try {
    const id = db.prepare('INSERT INTO action_dependencies (action_id, depends_on_id, created_by) VALUES (?,?,?)')
      .run(Number(req.params.actionId), Number(dependsOnId), req.user.id).lastInsertRowid;
    audit(req, 'create', 'action_dependencies', id);
    res.status(201).json({ id });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: 'Dependency already exists' });
    res.status(400).json({ error: e.message });
  }
});

r.delete('/dependencies/:actionId/:depId', (req, res) => {
  db.prepare('DELETE FROM action_dependencies WHERE action_id = ? AND id = ?').run(Number(req.params.actionId), Number(req.params.depId));
  audit(req, 'delete', 'action_dependencies', Number(req.params.depId));
  res.json({ ok: true });
});

module.exports = r;
