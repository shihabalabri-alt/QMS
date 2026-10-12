// AI Brain API — with strict human-in-the-loop control.
// The AI proposes (recommendations); humans decide; the system records every decision.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { audit, notify } = require('../middleware/audit');
const ai = require('../ai/brain');
const { MODULES, ROLE_LABELS } = require('../modules');
const { pad, today } = require('../utils');

const r = express.Router();
r.use(authRequired);

const PROPOSERS = ['admin', 'quality_manager', 'management', 'manager', 'qa', 'investigator', 'risk_manager', 'compliance_manager', 'supplier_manager', 'equipment_manager', 'doc_controller', 'competency_manager', 'auditor'];

r.post('/ask', async (req, res) => {
  const question = String((req.body || {}).question || '').trim();
  if (!question) return res.status(400).json({ error: 'Question required' });
  if (question.length > 500) return res.status(400).json({ error: 'Question too long' });
  try {
    const answer = ai.ask(question, req.user, (req.body || {}).context || null);
    audit(req, 'ai_ask', 'ai', null, question.slice(0, 100), { intent: answer.intent });
    const narrative = await ai.llmPhrase(question, answer, req.user);
    res.json({ answer, narrative, humanControl: 'All facts above are from live authorized data. AI output is advisory only — decisions require human approval.' });
  } catch (e) {
    res.status(500).json({ error: 'AI engine error: ' + e.message });
  }
});

r.get('/insights', (req, res) => {
  res.json({ insights: ai.insights(req.user) });
});

// Full-system connection map (JSON for the visual map page)
r.get('/network', (req, res) => {
  res.json(ai.buildNetwork(req.user));
});

r.get('/related/:type/:code', (req, res) => {
  res.json(ai.graph(req.params.type, req.params.code.toUpperCase(), req.user, 2));
});

r.get('/summarize/:module/:id', (req, res) => {
  const m = MODULES[req.params.module];
  if (!m || Number.isNaN(Number(req.params.id))) return res.status(404).json({ error: 'Not found' });
  const row = db.prepare(`SELECT * FROM ${m.table} WHERE id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Not found' });
  const label = ({ policies: 'Policy', goals: 'KPI', risks: 'Risk', suppliers: 'Supplier', employees: 'Employee', competencies: 'Employee', trainings: 'Training', records: 'Document', documents: 'Document', design: 'Design review', equipment: 'Equipment', nonconformances: 'NC', audits: 'Audit', compliance: 'Compliance', mgmt_reviews: 'Mgmt review', actions: 'Action' })[req.params.module] || 'Record';
  const c = ai.collect(req.user);
  const A = ai.analyze(c, req.user);
  res.json(ai.ask(`summarize ${row.code}`, req.user).intent === 'summarize_record' ? { ...ai.ask(`summarize ${row.code}`, req.user), label } : { error: 'Cannot summarize' });
});

r.get('/management-review-draft', (req, res) => {
  const c = ai.collect(req.user);
  const A = ai.analyze(c, req.user);
  res.json(ai.managementReviewDraft(c, A, req.user));
});

// Save the AI draft into a management review record — always as DRAFT; a human must review and issue it.
r.post('/management-review-draft/apply/:id', (req, res) => {
  if (!['admin', 'quality_manager', 'management'].includes(req.user.role))
    return res.status(403).json({ error: 'Only management may generate review drafts' });
  const mr = db.prepare('SELECT * FROM management_reviews WHERE id = ?').get(Number(req.params.id));
  if (!mr) return res.status(404).json({ error: 'Management review not found' });
  if (mr.status === 'issued') return res.status(400).json({ error: 'Cannot modify an issued review' });
  const c = ai.collect(req.user);
  const A = ai.analyze(c, req.user);
  const draft = ai.managementReviewDraft(c, A, req.user);
  const summary = draft.keyFindings.length ? `Key findings:\n- ${draft.keyFindings.join('\n- ')}\n\nSuggested decisions:\n- ${draft.decisions.join('\n- ')}` : '';
  db.prepare('UPDATE management_reviews SET inputs = ?, summary = COALESCE(NULLIF(summary, \'\'), ?) WHERE id = ?')
    .run(JSON.stringify(draft), summary, mr.id);
  audit(req, 'ai_draft_applied', 'management_reviews', mr.id, mr.code, { note: 'AI draft generated — human review required before issuing' });
  res.json({ ok: true, note: 'Draft saved. A human must review and issue it via the workflow.' });
});

/* ---------------- AI Recommendations: propose → review → approve → record ---------------- */
const OPS = {
  create_action: {
    label: 'Create a tracked action',
    decideRoles: ['admin', 'quality_manager', 'management', 'manager', 'qa', 'investigator'],
    describe: p => `Create action "${p.title}"${p.owner_id ? ' (owner assigned)' : ''}${p.due_date ? ` due ${p.due_date}` : ''}`,
    execute: (p, user) => {
      const max = db.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(code,5) AS INTEGER)),0) m FROM actions WHERE code LIKE 'ACT-%'").get().m;
      const code = `ACT-${pad(max + 1, 4)}`;
      const id = db.prepare('INSERT INTO actions (code, title, description, source_type, source_code, owner_id, priority, due_date, created_by) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(code, p.title, p.description || `Created from approved AI recommendation.`, p.source_type || 'manual', p.source_code || null, p.owner_id || user.id, p.priority || 'medium', p.due_date || null, user.id).lastInsertRowid;
      if (p.owner_id) notify(p.owner_id, 'Action assigned (AI-recommended, human-approved)', `${code}: ${p.title}`, `/actions?focus=${id}`, 'info');
      return { created: 'actions', code, id };
    }
  },
  escalate_action: {
    label: 'Escalate an overdue action to management',
    decideRoles: ['admin', 'quality_manager', 'management', 'manager'],
    describe: p => `Escalate ${p.action_code || 'action'} to management`,
    execute: (p, user) => {
      const a = db.prepare('SELECT * FROM actions WHERE code = ?').get(p.action_code);
      if (!a) throw new Error('Action not found');
      for (const u of db.prepare("SELECT id FROM users WHERE role IN ('quality_manager','management','manager') AND active = 1").all())
        notify(u.id, 'ESCALATION: overdue action', `${a.code} "${a.title}" (due ${a.due_date}) escalated by ${user.name}.`, `/actions?focus=${a.id}`, 'critical');
      if (a.priority !== 'critical') db.prepare('UPDATE actions SET priority = ? WHERE id = ?').run('high', a.id);
      return { escalated: a.code, notified: 'management + quality' };
    }
  },
  set_supplier_status: {
    label: 'Change supplier status (e.g. move to conditional)',
    decideRoles: ['admin', 'quality_manager', 'supplier_manager', 'management'],
    describe: p => `Set supplier ${p.supplier_code} status to "${p.status}"`,
    execute: (p, user) => {
      const s = db.prepare('SELECT * FROM suppliers WHERE code = ?').get(p.supplier_code);
      if (!s) throw new Error('Supplier not found');
      db.prepare('UPDATE suppliers SET status = ? WHERE id = ?').run(p.status, s.id);
      return { updated: 'suppliers', code: s.code, status: p.status };
    }
  },
  schedule_review: {
    label: 'Schedule a review date for a record',
    decideRoles: ['admin', 'quality_manager', 'management', 'manager', 'doc_controller', 'risk_manager', 'compliance_manager'],
    describe: p => `Set review of ${p.target_code} to ${p.review_date}`,
    execute: (p, user) => {
      const table = ({ RSK: 'risks', DOC: 'documents', POL: 'policies', CR: 'compliance_requirements', SUP: 'suppliers' })[String(p.target_code || '').split('-')[0]];
      if (!table) throw new Error('Unsupported target');
      const row = db.prepare(`SELECT * FROM ${table} WHERE code = ?`).get(p.target_code);
      if (!row) throw new Error('Record not found');
      const col = table === 'suppliers' ? 'next_audit' : 'review_date';
      db.prepare(`UPDATE ${table} SET ${col} = ? WHERE id = ?`).run(p.review_date, row.id);
      return { updated: table, code: row.code, review_date: p.review_date };
    }
  }
};

r.get('/recommendations', (req, res) => {
  if (!PROPOSERS.includes(req.user.role)) return res.status(403).json({ error: 'Not authorized' });
  const status = req.query.status;
  const rows = status && status !== 'all'
    ? db.prepare('SELECT * FROM ai_recommendations WHERE status = ? ORDER BY id DESC LIMIT 100').all(status)
    : db.prepare('SELECT * FROM ai_recommendations ORDER BY id DESC LIMIT 100').all();
  const decorated = rows.map(x => ({
    ...x,
    payload: JSON.parse(x.payload || '{}'),
    op_label: OPS[x.op] ? OPS[x.op].label : x.op,
    op_description: OPS[x.op] ? OPS[x.op].describe(JSON.parse(x.payload || '{}')) : null,
    decided_by_name: x.decided_by ? (db.prepare('SELECT name FROM users WHERE id = ?').get(x.decided_by) || {}).name : null,
    can_decide: OPS[x.op] ? OPS[x.op].decideRoles.includes(req.user.role) : false
  }));
  res.json({ rows: decorated, availableOps: Object.entries(OPS).map(([k, v]) => ({ op: k, label: v.label })) });
});

r.post('/recommendations', (req, res) => {
  if (!PROPOSERS.includes(req.user.role)) return res.status(403).json({ error: 'Not authorized to create AI recommendations' });
  const { op, target_type, target_code, payload, rationale, question, intent, risk_note } = req.body || {};
  if (!OPS[op]) return res.status(400).json({ error: 'Unknown recommendation operation. Allowed: ' + Object.keys(OPS).join(', ') });
  if (!rationale) return res.status(400).json({ error: 'Rationale required — the AI must justify every recommendation' });
  const id = db.prepare('INSERT INTO ai_recommendations (question, intent, op, target_type, target_code, payload, rationale, risk_note, proposed_by) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(question || null, intent || null, op, target_type || null, target_code || null, JSON.stringify(payload || {}), rationale, risk_note || null, 'ai:' + req.user.name).lastInsertRowid;
  audit(req, 'ai_recommend', 'ai_recommendations', id, OPS[op].describe(payload || {}), { op, target_code, rationale });
  res.status(201).json({ id, note: 'Recommendation stored for human review. Nothing has been changed.' });
});

r.post('/recommendations/:id/decide', (req, res) => {
  const rec = db.prepare('SELECT * FROM ai_recommendations WHERE id = ?').get(Number(req.params.id));
  if (!rec) return res.status(404).json({ error: 'Recommendation not found' });
  if (rec.status !== 'proposed') return res.status(400).json({ error: `Already ${rec.status}` });
  const { decision, note } = req.body || {};
  if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'decision must be approve or reject' });
  const op = OPS[rec.op];
  if (!op) return res.status(400).json({ error: 'Unknown operation' });
  if (!op.decideRoles.includes(req.user.role))
    return res.status(403).json({ error: `This decision requires one of: ${op.decideRoles.map(x => ROLE_LABELS[x] || x).join(', ')}` });

  let result = null, error = null;
  if (decision === 'approve') {
    try { result = op.execute(JSON.parse(rec.payload || '{}'), req.user); }
    catch (e) { error = e.message; }
  }
  const finalStatus = error ? 'failed' : decision === 'approve' ? 'approved' : 'rejected';
  db.prepare('UPDATE ai_recommendations SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?')
    .run(finalStatus, req.user.id, new Date().toISOString(), note || error || null, rec.id);
  audit(req, `ai_recommendation_${finalStatus}`, 'ai_recommendations', rec.id, `${rec.op} ${rec.target_code || ''}`, {
    decision, note, executed: result, error,
    human: `${req.user.name} (${ROLE_LABELS[req.user.role] || req.user.role})`
  });
  res.json({ ok: !error, status: finalStatus, result, error });
});

module.exports = r;
