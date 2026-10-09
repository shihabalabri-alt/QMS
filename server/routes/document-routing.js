const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { audit, notify } = require('../middleware/audit');
const { today, nowIso, addDays } = require('../utils');

const r = express.Router();
r.use(authRequired);

const DEFAULT_ROUTING_RULES = [
  {
    name: 'Standard Review - Quality Procedure',
    description: 'Standard 3-step review for Quality procedures',
    module: 'documents', document_category: 'Procedure', department: 'Quality',
    trigger_event: 'submitted_for_review',
    conditions: JSON.stringify({ category: 'Procedure', department: 'Quality' }),
    steps: JSON.stringify([
      { step: 1, name: 'Technical Review', role: 'qa', days: 5, required: true },
      { step: 2, name: 'Quality Manager Approval', role: 'quality_manager', days: 3, required: true },
      { step: 3, name: 'Document Controller Distribution', role: 'doc_controller', days: 2, required: true }
    ])
  },
  {
    name: 'Standard Review - Work Instruction',
    description: 'Standard 2-step review for Work Instructions',
    module: 'documents', document_category: 'Work Instruction', department: 'Operations',
    trigger_event: 'submitted_for_review',
    conditions: JSON.stringify({ category: 'Work Instruction', department: 'Operations' }),
    steps: JSON.stringify([
      { step: 1, name: 'Area Supervisor Review', role: 'manager', department: 'Operations', days: 3, required: true },
      { step: 2, name: 'Document Controller Distribution', role: 'doc_controller', days: 2, required: true }
    ])
  },
  {
    name: 'Standard Review - Engineering Specification',
    description: 'Standard 3-step review for Engineering specifications',
    module: 'documents', document_category: 'Specification', department: 'Engineering',
    trigger_event: 'submitted_for_review',
    conditions: JSON.stringify({ category: 'Specification', department: 'Engineering' }),
    steps: JSON.stringify([
      { step: 1, name: 'Design Engineer Review', role: 'manager', department: 'Engineering', days: 5, required: true },
      { step: 2, name: 'Quality Engineer Review', role: 'qa', days: 3, required: true },
      { step: 3, name: 'Engineering Manager Approval', role: 'manager', department: 'Engineering', days: 2, required: true }
    ])
  },
  {
    name: 'Standard Review - Supplier Quality Agreement',
    description: 'Standard review for Supplier Quality Agreements',
    module: 'documents', document_category: 'Plan', department: 'Supply Chain',
    trigger_event: 'submitted_for_review',
    conditions: JSON.stringify({ category: 'Plan', department: 'Supply Chain' }),
    steps: JSON.stringify([
      { step: 1, name: 'Supplier Manager Review', role: 'supplier_manager', days: 5, required: true },
      { step: 2, name: 'Quality Manager Approval', role: 'quality_manager', days: 3, required: true },
      { step: 3, name: 'Legal Review', role: 'management', days: 5, required: true }
    ])
  },
  {
    name: 'Standard Review - Compliance Document',
    description: 'Standard review for Compliance/Regulatory documents',
    module: 'documents', document_category: 'Manual', department: 'Quality',
    trigger_event: 'submitted_for_review',
    conditions: JSON.stringify({ category: 'Manual' }),
    steps: JSON.stringify([
      { step: 1, name: 'Compliance Manager Review', role: 'compliance_manager', days: 5, required: true },
      { step: 2, name: 'Quality Manager Approval', role: 'quality_manager', days: 3, required: true },
      { step: 3, name: 'Management Review', role: 'management', days: 5, required: true }
    ])
  },
  {
    name: 'Fast Track - Minor Revision',
    description: 'Fast track for minor revisions (typo, formatting)',
    module: 'documents', document_category: null, department: null,
    trigger_event: 'submitted_for_review',
    conditions: JSON.stringify({ revision_type: 'minor' }),
    steps: JSON.stringify([
      { step: 1, name: 'Document Controller Review', role: 'doc_controller', days: 1, required: true },
      { step: 2, name: 'Auto-Approve', role: 'doc_controller', days: 0, required: true, auto: true }
    ])
  },
  {
    name: 'Urgent - Regulatory Deadline',
    description: 'Urgent routing for regulatory deadline documents',
    module: 'documents', document_category: null, department: null,
    trigger_event: 'submitted_for_review',
    conditions: JSON.stringify({ priority: 'critical', regulatory_deadline: true }),
    steps: JSON.stringify([
      { step: 1, name: 'Immediate Quality Review', role: 'quality_manager', days: 1, required: true },
      { step: 2, name: 'Management Emergency Approval', role: 'management', days: 1, required: true }
    ])
  },
  {
    name: 'Cross-Functional - New Product',
    description: 'Cross-functional review for new product documents',
    module: 'documents', document_category: 'Protocol', department: null,
    trigger_event: 'submitted_for_review',
    conditions: JSON.stringify({ category: 'Protocol' }),
    steps: JSON.stringify([
      { step: 1, name: 'Engineering Lead Review', role: 'manager', department: 'Engineering', days: 5, required: true },
      { step: 2, name: 'Quality Lead Review', role: 'quality_manager', days: 5, required: true },
      { step: 3, name: 'Operations Lead Review', role: 'manager', department: 'Operations', days: 3, required: true },
      { step: 4, name: 'Regulatory Review', role: 'compliance_manager', days: 5, required: true },
      { step: 5, name: 'Final Approval', role: 'management', days: 3, required: true }
    ])
  }
];

function evaluateConditions(doc, conditions) {
  if (!conditions) return true;
  const cond = typeof conditions === 'string' ? JSON.parse(conditions) : conditions;
  for (const [key, value] of Object.entries(cond)) {
    if (doc[key] !== value && doc[key] != value) return false;
  }
  return true;
}

function findMatchingRule(doc) {
  const rules = db.prepare('SELECT * FROM document_routing_rules WHERE active = 1 ORDER BY id').all();
  for (const rule of rules) {
    if (evaluateConditions(doc, rule.conditions)) return rule;
  }
  return null;
}

function getAssigneeForStep(step) {
  let query = 'SELECT id FROM users WHERE role = ? AND 1=1';
  const params = [step.role];
  if (step.department) { query += ' AND department = ?'; params.push(step.department); }
  const user = db.prepare(query + ' ORDER BY id LIMIT 1').get(...params);
  return user ? user.id : null;
}

function createRoutingExecution(doc, rule, req) {
  const steps = JSON.parse(rule.steps);
  const firstStep = steps[0];
  const assignee = getAssigneeForStep(firstStep);
  const dueAt = addDays(today(), firstStep.days || 0);

  const executionId = db.prepare(`
    INSERT INTO document_routing_executions (rule_id, rule_name, document_id, document_code, document_title, current_step, status, assigned_to, assigned_at, due_at, step_history)
    VALUES (?, ?, ?, ?, ?, 0, 'in_progress', ?, ?, ?, '[]')
  `).run(rule.id, rule.name, String(doc.id), doc.code, doc.title, assignee, nowIso(), dueAt).lastInsertRowid;

  db.prepare(`
    INSERT INTO document_routing_audit (execution_id, step_index, action, actor_id, actor_name, from_step, to_step, details)
    VALUES (?, 0, 'started', ?, ?, -1, 0, ?)
  `).run(executionId, req?.user?.id || 0, req?.user?.name || 'System', JSON.stringify({ rule: rule.name }));

  db.prepare('UPDATE documents SET routing_rule_id = ?, routing_status = ?, current_step_index = 0, routed_by = ?, routed_at = ?, routing_path = ? WHERE id = ?')
    .run(rule.id, 'in_progress', req?.user?.id || 0, nowIso(), JSON.stringify(steps.map(s => s.name)), doc.id);

  if (assignee) notify(assignee, `Document routed for review`, `${doc.code}: ${doc.title} - Step 1: ${firstStep.name}`, `/documents/${doc.id}`, 'info');

  return executionId;
}

r.get('/rules', (req, res) => {
  const rows = db.prepare('SELECT * FROM document_routing_rules ORDER BY name').all();
  res.json({ rows: rows.map(r => ({ ...r, conditions: JSON.parse(r.conditions || '{}'), steps: JSON.parse(r.steps || '[]') })) });
});

r.post('/rules', (req, res) => {
  const { name, description, module, document_category, department, trigger_event, conditions, steps } = req.body || {};
  if (!name || !module || !trigger_event) return res.status(400).json({ error: 'name, module, trigger_event required' });
  const id = db.prepare(`
    INSERT INTO document_routing_rules (name, description, module, document_category, department, trigger_event, conditions, steps, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, description || '', module, document_category || null, department || null, trigger_event, JSON.stringify(conditions || {}), JSON.stringify(steps || []), req.user.id).lastInsertRowid;
  audit(req, 'create', 'document_routing_rules', id, name);
  res.status(201).json({ id });
});

r.put('/rules/:id', (req, res) => {
  const { name, description, module, document_category, department, trigger_event, conditions, steps, active } = req.body || {};
  db.prepare(`
    UPDATE document_routing_rules SET name = ?, description = ?, module = ?, document_category = ?, department = ?, trigger_event = ?, conditions = ?, steps = ?, active = ?
    WHERE id = ?
  `).run(name, description || '', module, document_category || null, department || null, trigger_event, JSON.stringify(conditions || {}), JSON.stringify(steps || []), active ? 1 : 0, req.params.id);
  audit(req, 'update', 'document_routing_rules', req.params.id, name);
  res.json({ ok: true });
});

r.delete('/rules/:id', (req, res) => {
  db.prepare('DELETE FROM document_routing_rules WHERE id = ?').run(req.params.id);
  audit(req, 'delete', 'document_routing_rules', req.params.id, '');
  res.json({ ok: true });
});

r.post('/rules/seed-defaults', (req, res) => {
  let created = 0;
  for (const rule of DEFAULT_ROUTING_RULES) {
    const exists = db.prepare('SELECT 1 FROM document_routing_rules WHERE name = ?').get(rule.name);
    if (!exists) {
      db.prepare(`
        INSERT INTO document_routing_rules (name, description, module, document_category, department, trigger_event, conditions, steps, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(rule.name, rule.description, rule.module, rule.document_category, rule.department, rule.trigger_event, rule.conditions, rule.steps, req.user.id);
      created++;
    }
  }
  audit(req, 'seed', 'document_routing_rules', null, `Seeded ${created} default routing rules`);
  res.json({ created });
});

r.post('/documents/:id/route', (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (doc.routing_status === 'in_progress') return res.status(400).json({ error: 'Document already in routing' });

  const rule = findMatchingRule(doc);
  if (!rule) return res.status(400).json({ error: 'No matching routing rule found. Create or seed rules first.' });

  const executionId = createRoutingExecution(doc, rule, req);
  res.json({ executionId, rule: rule.name });
});

r.post('/executions/:id/advance', (req, res) => {
  const exec = db.prepare('SELECT * FROM document_routing_executions WHERE id = ?').get(Number(req.params.id));
  if (!exec) return res.status(404).json({ error: 'Execution not found' });
  if (exec.status !== 'in_progress') return res.status(400).json({ error: 'Execution not in progress' });

  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(exec.document_id);
  const steps = JSON.parse(db.prepare('SELECT steps FROM document_routing_rules WHERE id = ?').get(exec.rule_id).steps);
  const currentStep = steps[exec.current_step];
  const nextStepIndex = exec.current_step + 1;

  const { action, note } = req.body || {};
  if (action === 'reject') {
    db.prepare('UPDATE document_routing_executions SET status = ?, completed_at = ? WHERE id = ?').run('rejected', nowIso(), exec.id);
    db.prepare('UPDATE documents SET routing_status = ?, current_stage = ? WHERE id = ?').run('rejected', 'draft', doc.id);
    db.prepare('INSERT INTO document_routing_audit (execution_id, step_index, action, actor_id, actor_name, from_step, to_step, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(exec.id, exec.current_step, 'rejected', req.user.id, req.user.name, exec.current_step, -1, JSON.stringify({ note }));
    audit(req, 'route_reject', 'documents', doc.id, `${doc.code} rejected at step ${exec.current_step + 1}`, { note });
    return res.json({ status: 'rejected' });
  }

  if (action === 'hold') {
    db.prepare('UPDATE document_routing_executions SET status = ? WHERE id = ?').run('on_hold', exec.id);
    db.prepare('UPDATE documents SET routing_status = ? WHERE id = ?').run('on_hold', doc.id);
    db.prepare('INSERT INTO document_routing_audit (execution_id, step_index, action, actor_id, actor_name, from_step, to_step, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(exec.id, exec.current_step, 'on_hold', req.user.id, req.user.name, exec.current_step, exec.current_step, JSON.stringify({ note }));
    return res.json({ status: 'on_hold' });
  }

  const history = JSON.parse(exec.step_history || '[]');
  history.push({ step: exec.current_step, name: currentStep.name, completed_by: req.user.id, completed_at: nowIso(), note: note || '' });

  if (nextStepIndex >= steps.length) {
    db.prepare('UPDATE document_routing_executions SET status = ?, current_step = ?, completed_at = ?, step_history = ? WHERE id = ?')
      .run('completed', nextStepIndex, nowIso(), JSON.stringify(history), exec.id);
    db.prepare('UPDATE documents SET routing_status = ?, current_stage = ?, current_step_index = ? WHERE id = ?')
      .run('completed', 'effective', nextStepIndex, doc.id);
    db.prepare('INSERT INTO document_routing_audit (execution_id, step_index, action, actor_id, actor_name, from_step, to_step, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(exec.id, exec.current_step, 'completed', req.user.id, req.user.name, exec.current_step, nextStepIndex, JSON.stringify({ note }));
    audit(req, 'route_complete', 'documents', doc.id, `${doc.code} routing completed`, { rule: exec.rule_name });
    return res.json({ status: 'completed' });
  }

  const nextStep = steps[nextStepIndex];
  const assignee = getAssigneeForStep(nextStep);
  const dueAt = addDays(today(), nextStep.days || 0);

  db.prepare('UPDATE document_routing_executions SET current_step = ?, assigned_to = ?, assigned_at = ?, due_at = ?, step_history = ? WHERE id = ?')
    .run(nextStepIndex, assignee, nowIso(), dueAt, JSON.stringify(history), exec.id);
  db.prepare('UPDATE documents SET current_step_index = ?, assigned_reviewer_id = ?, stage_due_at = ? WHERE id = ?')
    .run(nextStepIndex, assignee, dueAt, doc.id);
  db.prepare('INSERT INTO document_routing_audit (execution_id, step_index, action, actor_id, actor_name, from_step, to_step, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(exec.id, exec.current_step, 'advanced', req.user.id, req.user.name, exec.current_step, nextStepIndex, JSON.stringify({ note }));

  if (assignee) notify(assignee, `Document routed to you`, `${doc.code}: ${doc.title} - Step ${nextStepIndex + 1}: ${nextStep.name}`, `/documents/${doc.id}`, 'info');

  res.json({ status: 'advanced', nextStep: nextStep.name, assignee });
});

r.get('/executions', (req, res) => {
  const { status, assigned_to, limit = 100, offset = 0 } = req.query;
  let where = 'WHERE 1=1', args = [];
  if (status) { where += ' AND status = ?'; args.push(status); }
  if (assigned_to === 'me') { where += ' AND assigned_to = ?'; args.push(req.user.id); }
  const rows = db.prepare(`SELECT e.*, d.title AS doc_title FROM document_routing_executions e LEFT JOIN documents d ON d.id = e.document_id ${where} ORDER BY e.created_at DESC LIMIT ? OFFSET ?`).all(...args, Number(limit), Number(offset));
  const total = db.prepare(`SELECT COUNT(*) AS c FROM document_routing_executions ${where}`).get(...args).c;
  res.json({ total, rows });
});

r.get('/executions/:id', (req, res) => {
  const exec = db.prepare('SELECT * FROM document_routing_executions WHERE id = ?').get(Number(req.params.id));
  if (!exec) return res.status(404).json({ error: 'Not found' });
  const rule = db.prepare('SELECT * FROM document_routing_rules WHERE id = ?').get(exec.rule_id);
  const auditLog = db.prepare('SELECT a.*, u.name AS user_name FROM document_routing_audit a LEFT JOIN users u ON u.id = a.actor_id WHERE a.execution_id = ? ORDER BY a.timestamp').all(exec.id);
  res.json({ execution: exec, rule: rule ? { ...rule, steps: JSON.parse(rule.steps || '[]'), conditions: JSON.parse(rule.conditions || '{}') } : null, auditLog });
});

r.get('/escalation-rules', (req, res) => {
  const rows = db.prepare('SELECT * FROM document_escalation_rules ORDER BY name').all();
  res.json({ rows: rows.map(r => ({ ...r, escalation_levels: JSON.parse(r.escalation_levels || '[]'), notify_roles: JSON.parse(r.notify_roles || '[]') })) });
});

r.post('/escalation-rules', (req, res) => {
  const { name, description, routing_rule_id, trigger_after_days, escalation_levels, notify_roles } = req.body || {};
  const id = db.prepare(`
    INSERT INTO document_escalation_rules (name, description, routing_rule_id, trigger_after_days, escalation_levels, notify_roles, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(name, description || '', routing_rule_id || null, trigger_after_days || 7, JSON.stringify(escalation_levels || []), JSON.stringify(notify_roles || []), req.user.id).lastInsertRowid;
  audit(req, 'create', 'document_escalation_rules', id, name);
  res.status(201).json({ id });
});

r.post('/escalation/check', (req, res) => {
  const executions = db.prepare(`
    SELECT e.*, d.title, d.code FROM document_routing_executions e
    JOIN documents d ON d.id = e.document_id
    WHERE e.status = 'in_progress' AND e.due_at IS NOT NULL AND e.due_at < date('now')
  `).all();

  let escalated = 0;
  for (const exec of executions) {
    const rules = db.prepare('SELECT * FROM document_escalation_rules WHERE active = 1 AND (routing_rule_id = ? OR routing_rule_id IS NULL)').all(exec.rule_id);
    for (const rule of rules) {
      const levels = JSON.parse(rule.escalation_levels || '[]');
      const nextLevel = levels[exec.escalation_level];
      if (!nextLevel) continue;

      const daysOverdue = Math.ceil((new Date() - new Date(exec.due_at)) / (1000 * 60 * 60 * 24));
      if (daysOverdue >= (rule.trigger_after_days || 7)) {
        db.prepare('UPDATE document_routing_executions SET escalated = 1, escalation_level = escalation_level + 1 WHERE id = ?').run(exec.id);
        db.prepare('UPDATE documents SET escalation_level = escalation_level + 1 WHERE id = ?').run(exec.document_id);
        db.prepare('INSERT INTO document_routing_audit (execution_id, step_index, action, actor_id, actor_name, from_step, to_step, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(exec.id, exec.current_step, 'escalated', 0, 'System', exec.escalation_level, exec.escalation_level + 1, JSON.stringify({ rule: rule.name, daysOverdue }));

        const notifyRoles = JSON.parse(rule.notify_roles || '[]');
        for (const role of notifyRoles) {
          const users = db.prepare('SELECT id FROM users WHERE role = ?').all(role);
          for (const u of users) notify(u.id, `Document routing escalated`, `${exec.code}: ${exec.title} - Overdue ${daysOverdue} days (Level ${exec.escalation_level + 1})`, `/documents/${exec.document_id}`, 'warning');
        }
        escalated++;
      }
    }
  }
  res.json({ checked: executions.length, escalated });
});

r.get('/audit/:executionId', (req, res) => {
  const rows = db.prepare('SELECT a.*, u.name AS user_name FROM document_routing_audit a LEFT JOIN users u ON u.id = a.actor_id WHERE a.execution_id = ? ORDER BY a.timestamp').all(Number(req.params.executionId));
  res.json({ rows });
});

r.get('/dashboard', (req, res) => {
  try {
    const stats = {
      activeExecutions: db.prepare("SELECT COUNT(*) AS c FROM document_routing_executions WHERE status = 'in_progress'").get().c,
      completedToday: db.prepare("SELECT COUNT(*) AS c FROM document_routing_executions WHERE status = 'completed' AND date(completed_at) = date('now')").get().c,
      overdue: db.prepare("SELECT COUNT(*) AS c FROM document_routing_executions WHERE status = 'in_progress' AND due_at IS NOT NULL AND due_at < date('now')").get().c,
      escalated: db.prepare("SELECT COUNT(*) AS c FROM document_routing_executions WHERE escalated = 1").get().c,
      byStep: db.prepare(`
        SELECT current_step, COUNT(*) AS c FROM document_routing_executions WHERE status = 'in_progress' GROUP BY current_step
      `).all(),
      byRule: db.prepare(`
        SELECT rule_name, COUNT(*) AS c FROM document_routing_executions WHERE status = 'in_progress' GROUP BY rule_name
      `).all(),
      avgCycleTime: db.prepare(`
        SELECT AVG(julianday(completed_at) - julianday(created_at)) AS avg FROM document_routing_executions WHERE status = 'completed' AND completed_at IS NOT NULL
      `).get().avg || 0,
    };
    res.json(stats);
  } catch (e) {
    console.error('Dashboard error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = r;