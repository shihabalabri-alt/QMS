const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { today, addDays, daysUntil } = require('../utils');

const r = express.Router();
r.use(authRequired);

const TRACKING_FILTERS = [
  'code', 'title', 'category', 'department', 'status', 'version',
  'tracking_number', 'revision_number', 'current_stage', 'assigned_reviewer_id',
  'reviewer_department', 'review_priority', 'routing_status', 'routing_rule_id',
  'owner_id', 'effective_date', 'review_date', 'stage_entered_at', 'stage_due_at', 'routed_at'
];

function buildWhereClause(filters, args) {
  let where = 'WHERE 1=1';
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '' || value === 'all') continue;
    if (key === 'q') continue;
    if (key === 'days_in_stage_min') { where += ' AND days_in_stage >= ?'; args.push(Number(value)); continue; }
    if (key === 'days_in_stage_max') { where += ' AND days_in_stage <= ?'; args.push(Number(value)); continue; }
    if (key === 'escalation_level_min') { where += ' AND escalation_level >= ?'; args.push(Number(value)); continue; }
    if (key === 'sla_breached') { where += ' AND sla_breached = ?'; args.push(value === 'true' ? 1 : 0); continue; }
    if (key === 'overdue') {
      if (value === 'true') { where += " AND (stage_due_at IS NOT NULL AND stage_due_at < date('now'))"; }
      continue;
    }
    if (key === 'due_within_days') { where += " AND stage_due_at IS NOT NULL AND stage_due_at <= date('now', '+' || ? || ' days')"; args.push(Number(value)); continue; }
    if (TRACKING_FILTERS.includes(key)) {
      if (key.endsWith('_id') || key === 'routing_rule_id') {
        where += ` AND ${key} = ?`; args.push(Number(value));
      } else if (key.includes('date')) {
        where += ` AND ${key} = ?`; args.push(value);
      } else {
        where += ` AND ${key} = ?`; args.push(value);
      }
    }
  }
  return where;
}

r.get('/documents/tracking', (req, res) => {
  const filters = { ...req.query };
  const limit = Math.min(Number(filters.limit) || 200, 500);
  const offset = Number(filters.offset) || 0;
  delete filters.limit; delete filters.offset;

  const args = [];
  const where = buildWhereClause(filters, args);

  let sql = `SELECT d.*, u.name AS owner_name, r.name AS reviewer_name, rr.name AS routing_rule_name
    FROM documents d
    LEFT JOIN users u ON u.id = d.owner_id
    LEFT JOIN users r ON r.id = d.assigned_reviewer_id
    LEFT JOIN document_routing_rules rr ON rr.id = d.routing_rule_id
    ${where}
    ORDER BY d.code LIMIT ? OFFSET ?`;
  args.push(limit, offset);

  const rows = db.prepare(sql).all(...args);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM documents d ${where}`).get(...args.slice(0, -2)).c;

  res.json({ total, rows, filters: Object.keys(filters).filter(k => filters[k] !== undefined && filters[k] !== '').length });
});

r.get('/documents/tracking/summary', (req, res) => {
  const stats = {
    total: db.prepare('SELECT COUNT(*) AS c FROM documents').get().c,
    byStatus: db.prepare('SELECT status, COUNT(*) AS c FROM documents GROUP BY status').all(),
    byStage: db.prepare('SELECT current_stage, COUNT(*) AS c FROM documents GROUP BY current_stage').all(),
    byPriority: db.prepare('SELECT review_priority, COUNT(*) AS c FROM documents GROUP BY review_priority').all(),
    byRoutingStatus: db.prepare('SELECT routing_status, COUNT(*) AS c FROM documents GROUP BY routing_status').all(),
    slaBreached: db.prepare('SELECT COUNT(*) AS c FROM documents WHERE sla_breached = 1').get().c,
    overdue: db.prepare("SELECT COUNT(*) AS c FROM documents WHERE stage_due_at IS NOT NULL AND stage_due_at < date('now') AND current_stage != 'effective' AND current_stage != 'archived'").get().c,
    escalated: db.prepare('SELECT COUNT(*) AS c FROM documents WHERE escalation_level > 0').get().c,
    avgDaysInStage: db.prepare('SELECT AVG(days_in_stage) AS avg FROM documents WHERE days_in_stage > 0').get().avg || 0,
    byDepartment: db.prepare('SELECT department, COUNT(*) AS c FROM documents GROUP BY department').all(),
    byCategory: db.prepare('SELECT category, COUNT(*) AS c FROM documents GROUP BY category').all(),
  };
  res.json(stats);
});

r.get('/documents/tracking/filter-options', (req, res) => {
  try {
    const options = {
      categories: db.prepare('SELECT DISTINCT category FROM documents WHERE category IS NOT NULL ORDER BY category').all().map(r => r.category),
      departments: db.prepare('SELECT DISTINCT department FROM documents WHERE department IS NOT NULL ORDER BY department').all().map(r => r.department),
      stages: ['draft', 'review', 'approval', 'distribution', 'effective', 'archived'],
      priorities: ['low', 'normal', 'high', 'critical'],
      routingStatuses: ['pending', 'in_progress', 'completed', 'escalated', 'rejected', 'on_hold'],
      statuses: ['draft', 'in_review', 'approved', 'obsolete'],
      reviewers: db.prepare("SELECT id, name FROM users WHERE role IN ('quality_manager', 'doc_controller', 'qa', 'manager', 'management') ORDER BY name").all(),
      routingRules: db.prepare('SELECT id, name FROM document_routing_rules WHERE active = 1 ORDER BY name').all(),
      owners: db.prepare('SELECT id, name FROM users ORDER BY name').all(),
    };
    res.json(options);
  } catch (e) {
    console.error('Filter options error:', e);
    res.status(500).json({ error: e.message });
  }
});

r.post('/documents/tracking/bulk-update', (req, res) => {
  const { ids, updates } = req.body || {};
  if (!Array.isArray(ids) || !ids.length || !updates) return res.status(400).json({ error: 'ids[] and updates required' });
  const placeholders = ids.map(() => '?').join(',');
  const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), ...ids];
  db.prepare(`UPDATE documents SET ${setClause} WHERE id IN (${placeholders})`).run(...values);
  audit(req, 'bulk_update', 'documents', null, `Bulk update ${ids.length} documents`, updates);
  res.json({ updated: ids.length });
});

r.get('/documents/tracking/across', (req, res) => {
  const { groupBy = 'current_stage', metric = 'count' } = req.query;
  const validGroups = ['current_stage', 'status', 'category', 'department', 'review_priority', 'routing_status', 'assigned_reviewer_id', 'owner_id'];
  const validMetrics = ['count', 'avg_days_in_stage', 'sla_breach_rate', 'escalation_rate'];
  const group = validGroups.includes(groupBy) ? groupBy : 'current_stage';
  const met = validMetrics.includes(metric) ? metric : 'count';

  let sql = '';
  if (met === 'count') {
    sql = `SELECT ${group} AS group_value, COUNT(*) AS value FROM documents GROUP BY ${group} ORDER BY value DESC`;
  } else if (met === 'avg_days_in_stage') {
    sql = `SELECT ${group} AS group_value, AVG(days_in_stage) AS value FROM documents WHERE days_in_stage > 0 GROUP BY ${group} ORDER BY value DESC`;
  } else if (met === 'sla_breach_rate') {
    sql = `SELECT ${group} AS group_value,
      ROUND(100.0 * SUM(CASE WHEN sla_breached = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS value
      FROM documents GROUP BY ${group} ORDER BY value DESC`;
  } else if (met === 'escalation_rate') {
    sql = `SELECT ${group} AS group_value,
      ROUND(100.0 * SUM(CASE WHEN escalation_level > 0 THEN 1 ELSE 0 END) / COUNT(*), 1) AS value
      FROM documents GROUP BY ${group} ORDER BY value DESC`;
  }
  const rows = db.prepare(sql).all();
  res.json({ groupBy: group, metric: met, rows });
});

r.get('/documents/tracking/compare', (req, res) => {
  const { ids } = req.query;
  if (!ids) return res.status(400).json({ error: 'ids parameter required (comma-separated)' });
  const idList = ids.split(',').map(Number).filter(n => !isNaN(n));
  if (!idList.length) return res.status(400).json({ error: 'No valid IDs' });
  const placeholders = idList.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM documents WHERE id IN (${placeholders})`).all(...idList);
  const compare = rows.map(r => ({
    id: r.id, code: r.code, title: r.title,
    category: r.category, department: r.department, status: r.status, version: r.version,
    tracking_number: r.tracking_number, revision_number: r.revision_number,
    current_stage: r.current_stage, days_in_stage: r.days_in_stage,
    review_priority: r.review_priority, sla_breached: r.sla_breached,
    escalation_level: r.escalation_level, routing_status: r.routing_status,
    total_review_cycles: r.total_review_cycles, review_date: r.review_date
  }));
  res.json({ rows: compare });
});

r.get('/documents/tracking/:id/timeline', (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Not found' });

  const history = db.prepare('SELECT * FROM document_versions WHERE document_id = ? ORDER BY id').all(doc.id);
  const routing = db.prepare('SELECT * FROM document_routing_executions WHERE document_id = ? ORDER BY created_at').all(String(doc.id));
  const auditLog = db.prepare('SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.entity_type = ? AND a.entity_id = ? ORDER BY a.id DESC').all('documents', String(doc.id));
  const comments = db.prepare('SELECT c.*, u.name AS user_name FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.entity_type = ? AND c.entity_id = ? ORDER BY c.id DESC').all('documents', String(doc.id));

  res.json({ document: doc, history, routing, auditLog, comments });
});

r.post('/documents/:id/advance-stage', (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Not found' });

  const { to_stage, note, reviewer_id, priority } = req.body || {};
  const validStages = ['draft', 'review', 'approval', 'distribution', 'effective', 'archived'];
  if (!to_stage || !validStages.includes(to_stage)) return res.status(400).json({ error: 'Invalid target stage' });

  const now = today();
  const daysInStage = doc.stage_entered_at ? daysUntil(doc.stage_entered_at) * -1 : 0;

  db.prepare('UPDATE documents SET current_stage = ?, stage_entered_at = ?, stage_due_at = ?, days_in_stage = ?, total_review_cycles = total_review_cycles + 1, last_action = ?, last_action_by = ?, last_action_at = ?, assigned_reviewer_id = COALESCE(?, assigned_reviewer_id), review_priority = COALESCE(?, review_priority) WHERE id = ?')
    .run(to_stage, now, req.body.stage_due_at || null, Math.max(0, daysInStage), `Advanced to ${to_stage}: ${note || ''}`, req.user.id, now, reviewer_id || null, priority || null, doc.id);

  const updated = db.prepare('SELECT * FROM documents WHERE id = ?').get(doc.id);
  audit(req, 'stage_advance', 'documents', doc.id, `${doc.code} ${doc.title}`, { from: doc.current_stage, to: to_stage, note });
  if (reviewer_id && reviewer_id !== req.user.id) {
    require('../middleware/audit').notify(reviewer_id, `Document assigned for review`, `${doc.code}: ${doc.title} - ${to_stage}`, `/documents/${doc.id}`, priority === 'critical' ? 'critical' : 'info');
  }
  res.json({ row: updated });
});

module.exports = r;