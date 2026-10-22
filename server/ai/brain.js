// AI Brain: relationship-aware QMS intelligence.
// Principles:
//  1. Facts come ONLY from authorized database queries (never invented).
//  2. Deterministic analyzers produce facts/evidence/findings/recommendations.
//  3. Optional LLM layer only rephrases provided facts; it is instructed never to add data.
//  4. Every fact cites entity codes so users can verify evidence.
const db = require('../db');
const config = require('../config');
const { MODULES, findByCode, CODE_TO_MODULE } = require('../modules');
const { daysUntil, riskRating } = require('../utils');
const guide = require('./guide');
const ar = require('./ar');
const doer = require('./do');
const maker = require('./make');
const flow = require('./flow');
const bulk = require('./bulk');
const watcher = require('./watch');
const memory = require('./memory');

const q = (sql, ...args) => db.prepare(sql).all(...args);
const q1 = (sql, ...args) => db.prepare(sql).get(...args);

/* ------------------------------------------------------------------ *
 * Data collectors (role-scoped snapshots). The AI never sees data the
 * requesting user could not read via normal list endpoints.
 * ------------------------------------------------------------------ */
function collect(user) {
  const restrictedRead = ['admin', 'quality_manager', 'manager'];
  const c = {};
  c.actions = q('SELECT * FROM actions ORDER BY due_date');
  c.risks = q('SELECT * FROM risks');
  c.nonconformances = q('SELECT * FROM nonconformances');
  c.audits = q('SELECT * FROM audits');
  c.audit_items = q('SELECT ai.*, a.code AS audit_code, a.title AS audit_title FROM audit_items ai JOIN audits a ON a.id = ai.audit_id');
  c.suppliers = q('SELECT * FROM suppliers');
  c.supplier_evals = q('SELECT se.*, s.name AS supplier_name, s.code AS supplier_code FROM supplier_evaluations se JOIN suppliers s ON s.id = se.supplier_id ORDER BY se.period');
  c.supplier_incidents = q('SELECT si.*, s.name AS supplier_name, s.code AS supplier_code FROM supplier_incidents si JOIN suppliers s ON s.id = si.supplier_id');
  c.documents = q('SELECT * FROM documents');
  c.policies = q('SELECT * FROM policies');
  c.goals = q('SELECT * FROM goals');
  c.goal_entries = q('SELECT ge.*, g.code AS goal_code, g.title AS goal_title, g.target_value, g.direction, g.target_unit FROM goal_entries ge JOIN goals g ON ge.id = ge.goal_id ORDER BY ge.period');
  c.employees = q('SELECT * FROM employees');
  c.assessments = q('SELECT a.*, e.name AS employee_name, e.code AS employee_code, c.name AS competency_name, c.required_level FROM assessments a JOIN employees e ON e.id = a.employee_id JOIN competencies c ON c.id = a.competency_id');
  c.trainings = q('SELECT t.*, (SELECT COUNT(*) FROM training_participants tp WHERE tp.training_id = t.id) AS participants FROM trainings t');
  c.training_parts = q('SELECT tp.*, e.name AS employee_name, t.title AS training_title FROM training_participants tp JOIN employees e ON e.id = tp.employee_id JOIN trainings t ON t.id = tp.training_id');
  c.equipment = q('SELECT * FROM equipment');
  c.equipment_quals = q('SELECT eqq.*, e.code AS equipment_code, e.name AS equipment_name FROM equipment_qualifications eqq JOIN equipment e ON e.id = eqq.equipment_id');
  c.design_reviews = q('SELECT * FROM design_reviews');
  c.design_findings = q('SELECT df.*, dr.code AS review_code, dr.project FROM design_findings df JOIN design_reviews dr ON dr.id = df.review_id');
  c.design_reqs = q('SELECT r.*, dr.code AS review_code FROM design_requirements r JOIN design_reviews dr ON dr.id = r.review_id');
  c.compliance = q('SELECT * FROM compliance_requirements');
  c.mgmt_reviews = q('SELECT * FROM management_reviews ORDER BY review_date DESC LIMIT 3');
  const recWhere = restrictedRead.includes(user.role) || user.role === 'admin' ? '' : "WHERE confidentiality != 'restricted'";
  c.records = recWhere ? q(`SELECT * FROM records ${recWhere}`) : q('SELECT * FROM records');
  c.users = q('SELECT id, name, email, role, department, job_title, active FROM users');
  return c;
}

/* ------------------------------------------------------------------ *
 * Analyzers (deterministic intelligence)
 * ------------------------------------------------------------------ */
function trendOf(values) {
  if (!values || values.length < 3) return { direction: 'insufficient_data', slope: 0 };
  const n = values.length;
  const xs = values.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (values[i] - my); den += (xs[i] - mx) ** 2; }
  const slope = den === 0 ? 0 : num / den;
  const spread = Math.max(...values) - Math.min(...values) || 1;
  const rel = slope / spread;
  return { direction: rel > 0.08 ? 'improving' : rel < -0.08 ? 'deteriorating' : 'flat', slope: Math.round(slope * 1000) / 1000 };
}

function analyze(c, user) {
  const A = {};
  const T = new Date().toISOString().slice(0, 10);

  // --- Actions: overdue & priority
  A.overdueActions = c.actions.filter(a => a.due_date && a.due_date < T && !['completed', 'verified', 'cancelled'].includes(a.status));
  A.dueSoonActions = c.actions.filter(a => a.due_date && a.due_date >= T && daysUntil(a.due_date) <= 7 && !['completed', 'verified', 'cancelled'].includes(a.status));
  A.criticalActions = c.actions.filter(a => ['critical', 'high'].includes(a.priority) && ['open', 'in_progress'].includes(a.status));

  // --- Risks: high residual, worsening (residual not reduced, review overdue)
  const rk = r => ({ ...r, inherent_score: r.inherent_likelihood * r.inherent_severity, residual_score: r.residual_likelihood * r.residual_severity, residual_rating: riskRating(r.residual_likelihood * r.residual_severity) });
  A.highResidualRisks = c.risks.map(rk).filter(r => r.residual_rating === 'high' && !['closed'].includes(r.status));
  A.overdueRiskReviews = c.risks.filter(r => r.review_date && r.review_date < T && r.status !== 'closed');
  A.ineffectiveControls = c.risks.map(rk).filter(r => r.residual_score >= r.inherent_score * 0.72 && r.treatment === 'mitigate' && r.status !== 'closed');
  A.worseningRisks = [...A.ineffectiveControls, ...A.overdueRiskReviews.filter(r => r.treatment === 'mitigate')]
    .filter((v, i, a) => a.findIndex(x => x.id === v.id) === i);

  // --- NC/Incident patterns: recurring by supplier, department, root cause, equipment mention
  const open = x => !['closed'].includes(x.status);
  A.openNCs = c.nonconformances.filter(open);
  A.overdueNCs = c.nonconformances.filter(n => open(n) && n.occurred_at && daysUntil(n.occurred_at) < -30);
  const groupBy = (arr, keyFn) => {
    const m = new Map();
    for (const x of arr) { const k = keyFn(x); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
    return m;
  };
  const supNC = groupBy(c.nonconformances.filter(n => n.supplier_id), n => n.supplier_id);
  A.recurringSuppliers = [...supNC.entries()].map(([sid, list]) => {
    const s = c.suppliers.find(x => x.id === sid) || { name: 'Unknown', code: 'SUP-?' };
    const incidents = c.supplier_incidents.filter(i => i.supplier_id === sid);
    const all = [...list.map(n => ({ ...n, kind: n.type })), ...incidents.map(i => ({ ...i, code: `SI-${i.id}`, type: 'supplier incident', title: i.description, occurred_at: i.incident_date, status: i.status }))];
    return { supplier: s, count: all.length, openCount: all.filter(x => x.status !== 'closed').length, items: all.sort((a, b) => (b.occurred_at || '').localeCompare(a.occurred_at || '')) };
  }).filter(g => g.count >= 2).sort((a, b) => b.count - a.count);
  const deptNC = groupBy(c.nonconformances, n => n.department);
  A.recurringDepartments = [...deptNC.entries()].map(([dept, list]) => ({ dept, count: list.length, openCount: list.filter(open).length, items: list })).filter(g => g.count >= 3).sort((a, b) => b.count - a.count);
  const rcNC = groupBy(c.nonconformances.filter(n => n.root_cause_category && n.status !== 'open'), n => n.root_cause_category);
  A.recurringRootCauses = [...rcNC.entries()].map(([cat, list]) => ({ cat, count: list.length, items: list })).filter(g => g.count >= 2).sort((a, b) => b.count - a.count);

  // --- Documents & policies due for review
  A.docsForReview = c.documents.filter(d => d.status === 'approved' && d.review_date && daysUntil(d.review_date) <= 30);
  A.policiesForReview = c.policies.filter(p => p.status === 'approved' && p.review_date && daysUntil(p.review_date) <= 30);

  // --- Expiries: competency certs, calibrations, maintenance
  A.expiringAssessments = c.assessments.filter(a => a.expiry_date && daysUntil(a.expiry_date) <= 30);
  A.calibrationDue = c.equipment.filter(e => e.requires_calibration && e.next_calibration && daysUntil(e.next_calibration) <= 30);
  A.maintenanceDue = c.equipment.filter(e => e.next_maintenance && daysUntil(e.next_maintenance) <= 14);
  A.equipmentDown = c.equipment.filter(e => ['under_maintenance', 'under_qualification', 'out_of_service'].includes(e.status));
  A.pendingQuals = c.equipment_quals.filter(x => x.status === 'pending');

  // --- Supplier performance
  A.decliningSuppliers = [];
  for (const s of c.suppliers) {
    const evs = c.supplier_evals.filter(e => e.supplier_id === s.id).sort((a, b) => a.period.localeCompare(b.period));
    if (evs.length >= 2) {
      const t = trendOf(evs.map(e => e.total_score));
      const last = evs[evs.length - 1];
      A.decliningSuppliers.push({ supplier: s, trend: t.direction, lastScore: last.total_score, periods: evs.length, evals: evs });
    }
  }
  A.decliningSuppliers = A.decliningSuppliers.filter(x => x.trend === 'deteriorating' || x.lastScore < 75);
  A.pendingSuppliers = c.suppliers.filter(s => s.status === 'pending');

  // --- KPI trends & misses
  A.kpis = [];
  for (const g of c.goals.filter(g => g.type === 'kpi')) {
    const evs = c.goal_entries.filter(e => e.goal_id === g.id).sort((a, b) => a.period.localeCompare(b.period));
    if (!evs.length) continue;
    const last = evs[evs.length - 1];
    const hit = g.direction === 'higher' ? last.value >= g.target_value : last.value <= g.target_value;
    const t = trendOf(evs.map(e => e.value));
    const offTargetPct = g.direction === 'higher'
      ? Math.round((g.target_value - last.value) / (g.target_value || 1) * 1000) / 10
      : Math.round((last.value - g.target_value) / (Math.abs(g.target_value) || 1) * 1000) / 10;
    A.kpis.push({ ...g, entries: evs, lastValue: last.value, lastPeriod: last.period, onTarget: hit, trend: t.direction, slope: t.slope, offTargetPct });
  }
  A.kpisOffTarget = A.kpis.filter(k => !k.onTarget);

  // --- Audits & compliance
  A.auditsUpcoming = c.audits.filter(a => a.status !== 'closed' && a.planned_date && daysUntil(a.planned_date) <= 30);
  A.openAuditFindings = c.audit_items.filter(i => i.status !== 'closed');
  A.complianceGaps = c.compliance.filter(r => ['non_compliant', 'partially'].includes(r.status));
  A.unassessed = c.compliance.filter(r => r.status === 'not_assessed');

  // --- Design
  A.openDesignFindings = c.design_findings.filter(f => f.status !== 'closed');
  A.upcomingDesignReviews = c.design_reviews.filter(r => r.status === 'planned' && r.review_date && daysUntil(r.review_date) <= 21);
  A.failedRequirements = c.design_reqs.filter(r => r.status === 'fail');

  // --- Missing information (data quality)
  A.missingInfo = [];
  for (const n of c.nonconformances.filter(x => x.status !== 'closed' && x.type !== 'incident')) {
    const gaps = [];
    if (!n.root_cause && daysUntil(n.occurred_at || T) <= -7) gaps.push('root cause not documented');
    if (!n.correction) gaps.push('correction/containment not documented');
    if (gaps.length) A.missingInfo.push({ type: 'nonconformances', code: n.code, title: n.title, gaps });
  }
  for (const r of c.risks.filter(r => r.status !== 'closed')) {
    const gaps = [];
    if (!r.controls) gaps.push('no controls documented');
    if (!r.review_date) gaps.push('no review date set');
    if (gaps.length) A.missingInfo.push({ type: 'risks', code: r.code, title: r.title, gaps });
  }
  for (const d of c.documents.filter(d => d.status === 'approved')) {
    if (!d.review_date) A.missingInfo.push({ type: 'documents', code: d.code, title: d.title, gaps: ['approved but no review date set'] });
  }
  for (const s of c.suppliers.filter(s => s.status === 'approved')) {
    const evs = c.supplier_evals.filter(e => e.supplier_id === s.id);
    if (!evs.length) A.missingInfo.push({ type: 'suppliers', code: s.code, title: s.name, gaps: ['approved but never evaluated'] });
    if (!s.qualification_date) A.missingInfo.push({ type: 'suppliers', code: s.code, title: s.name, gaps: ['no qualification date'] });
  }
  for (const a of c.actions.filter(a => ['open', 'in_progress'].includes(a.status))) {
    if (!a.due_date) A.missingInfo.push({ type: 'actions', code: a.code, title: a.title, gaps: ['no due date set'] });
  }
  for (const e of c.equipment) {
    if (e.requires_calibration && !e.next_calibration) A.missingInfo.push({ type: 'equipment', code: e.code, title: e.name, gaps: ['calibration required but next date missing'] });
  }

  // --- Composite attention list
  const score = [];
  const add = (pts, type, code, title, why, link) => score.push({ pts, type, code, title, why, link });
  for (const a of A.overdueActions) add(50 + (a.priority === 'critical' ? 40 : a.priority === 'high' ? 20 : 0), 'Action', a.code, a.title, `overdue since ${a.due_date}`, `/actions?focus=${a.id}`);
  for (const r of A.highResidualRisks) add(55, 'Risk', r.code, r.title, `residual risk ${r.residual_score} (high)`, `/risks/${r.id}`);
  for (const g of A.complianceGaps) add(g.status === 'non_compliant' ? 50 : 25, 'Compliance', g.code, g.title, `${g.framework} ${g.clause} ${g.status.replace('_', ' ')}`, `/compliance/${g.id}`);
  for (const s of A.recurringSuppliers.filter(g => g.openCount > 0)) add(30 + s.count * 5, 'Supplier', s.supplier.code, s.supplier.name, `${s.count} quality events, ${s.openCount} open`, `/suppliers/${s.supplier.id}`);
  for (const d of A.docsForReview.filter(d => d.review_date < T)) add(20, 'Document', d.code, d.title, 'review overdue', `/documents/${d.id}`);
  for (const a of A.expiringAssessments.filter(a => a.expiry_date < T)) add(30, 'Competency', a.code, `${a.employee_name} - ${a.competency_name}`, `expired ${a.expiry_date}`, `/competencies/${a.competency_id}`);
  for (const e of A.calibrationDue.filter(e => e.next_calibration < T)) add(35, 'Equipment', e.code, e.name, `calibration overdue (${e.next_calibration})`, `/equipment/${e.id}`);
  for (const n of A.overdueNCs) add(25 + (n.severity === 'major' ? 15 : 0), 'NC', n.code, n.title, `open >30 days`, `/nonconformances/${n.id}`);
  for (const k of A.kpisOffTarget) add(15, 'KPI', k.code, k.title, `${k.lastValue}${k.target_unit} vs target ${k.target_value}${k.target_unit}`, `/goals/${k.id}`);
  for (const f of A.openDesignFindings.filter(f => f.due_date && f.due_date < T)) add(20, 'Design', f.review_code, f.description.slice(0, 60), 'design finding overdue', `/design`);
  A.attention = score.sort((a, b) => b.pts - a.pts).slice(0, 15);

  return A;
}

/* ------------------------------------------------------------------ *
 * Knowledge graph: traverse real relationships across modules.
 * Chain example: Incident -> Supplier -> Evaluations/Incidents ->
 * Actions -> Documents -> Risks -> Equipment -> Management Review.
 * ------------------------------------------------------------------ */
function node(type, code, label, rel) {
  return { type, code, label, rel, link: linkFor(type, code) };
}
function linkFor(type, code) {
  const db1 = () => q1('SELECT id FROM actions WHERE code = ?', code);
  const resolve = (table, route) => { const r = q1(`SELECT id FROM ${table} WHERE code = ?`, code); return r ? `/${route}/${r.id}` : `/${route}`; };
  switch (type) {
    case 'Action': return db1() ? `/actions?focus=${db1().id}` : '/actions';
    case 'Risk': return resolve('risks', 'risks');
    case 'NC': return resolve('nonconformances', 'nonconformances');
    case 'Supplier': return resolve('suppliers', 'suppliers');
    case 'Document': return resolve('documents', 'documents');
    case 'Policy': return resolve('policies', 'policies');
    case 'Equipment': return resolve('equipment', 'equipment');
    case 'Audit': return resolve('audits', 'audits');
    case 'KPI':
    case 'Objective': return resolve('goals', 'goals');
    case 'Compliance': return resolve('compliance_requirements', 'compliance');
    case 'Employee': return resolve('employees', 'employees');
    case 'Design review': return resolve('design_reviews', 'design');
    case 'Training': return resolve('trainings', 'trainings');
    case 'Competency': return resolve('competencies', 'competencies');
    case 'Mgmt review': return resolve('management_reviews', 'mgmt-reviews');
    default: return null;
  }
}

function neighbors(type, code, user) {
  const out = [];
  const T = new Date().toISOString().slice(0, 10);
  const acts = (srcType, srcCode) => q('SELECT * FROM actions WHERE source_code = ? ORDER BY due_date', srcCode);
  const userName = id => (q1('SELECT name FROM users WHERE id = ?', id) || {}).name;
  const empName = id => (q1('SELECT name FROM employees WHERE id = ?', id) || {}).name;

  if (type === 'NC' || type === 'CAPA' || type === 'INC') {
    const n = q1('SELECT * FROM nonconformances WHERE code = ?', code);
    if (!n) return out;
    if (n.supplier_id) { const s = q1('SELECT * FROM suppliers WHERE id = ?', n.supplier_id); if (s) out.push(node('Supplier', s.code, s.name, 'supplier implicated in this event')); }
    if (n.owner_id) out.push(node('Person', null, `${userName(n.owner_id) || 'Unknown'} (owner)`, 'assigned owner'));
    if (n.raised_by) out.push(node('Person', null, `${userName(n.raised_by) || 'Unknown'} (reporter)`, 'reported by'));
    for (const a of acts('nonconformance', code)) out.push(node('Action', a.code, a.title, `${a.status} action, due ${a.due_date || 'n/a'}`));
    const dept = n.department ? n.department.toLowerCase() : '';
    for (const r of q('SELECT * FROM risks WHERE department = ? AND status != ?', n.department, 'closed')) out.push(node('Risk', r.code, r.title, `open risk in same department (${n.department})`));
    for (const d of q("SELECT * FROM documents WHERE department = ? AND status = 'approved' LIMIT 3", n.department || 'Quality')) out.push(node('Document', d.code, d.title, `governing procedure (${n.department})`));
    for (const mr of q('SELECT * FROM management_reviews ORDER BY review_date DESC LIMIT 1')) out.push(node('Mgmt review', mr.code, mr.title, 'most recent management review context'));
    // equipment mentioned in text
    const text = `${n.title} ${n.description || ''}`.toLowerCase();
    for (const e of q('SELECT * FROM equipment')) if (text.includes(e.name.toLowerCase().split(' ')[0]) && e.name.length > 4) out.push(node('Equipment', e.code, e.name, 'referenced in event description'));
    // sibling events from same supplier
    if (n.supplier_id) {
      for (const s2 of q('SELECT * FROM nonconformances WHERE supplier_id = ? AND code != ?', n.supplier_id, code)) out.push(node(s2.type === 'capa' ? 'CAPA' : s2.type === 'incident' ? 'INC' : 'NC', s2.code, s2.title, 'related event from same supplier'));
    }
  }
  if (type === 'Risk') {
    const r = q1('SELECT * FROM risks WHERE code = ?', code);
    if (!r) return out;
    if (r.owner_id) out.push(node('Person', null, `${userName(r.owner_id) || 'Unknown'} (owner)`, 'risk owner'));
    for (const a of acts('risk', code)) out.push(node('Action', a.code, a.title, `mitigation action, due ${a.due_date || 'n/a'}`));
    for (const d of q('SELECT * FROM documents WHERE department = ? AND status = \'approved\' LIMIT 2', r.department || 'Quality')) out.push(node('Document', d.code, d.title, 'related controlled document'));
    for (const p of q('SELECT * FROM policies WHERE status = \'approved\' LIMIT 2')) out.push(node('Policy', p.code, p.title, 'governing policy'));
    for (const s of q('SELECT * FROM suppliers WHERE risk_level IN (\'high\',\'critical\') AND category IS NOT NULL LIMIT 2')) out.push(node('Supplier', s.code, s.name, `${s.risk_level}-risk supplier exposure`));
    for (const e of q('SELECT * FROM equipment WHERE status != \'operational\' LIMIT 2')) out.push(node('Equipment', e.code, e.name, 'equipment currently not operational'));
  }
  if (type === 'Supplier') {
    const s = q1('SELECT * FROM suppliers WHERE code = ?', code);
    if (!s) return out;
    for (const e of q('SELECT * FROM supplier_evaluations WHERE supplier_id = ? ORDER BY period DESC LIMIT 3', s.id)) out.push(node('Evaluation', s.code, `${e.period}: ${e.total_score}/100`, 'performance evaluation'));
    for (const i of q('SELECT * FROM supplier_incidents WHERE supplier_id = ?', s.id)) out.push(node('Incident', `SI-${i.id}`, (i.description || '').slice(0, 70), `${i.severity} incident ${i.incident_date}`));
    for (const n of q('SELECT * FROM nonconformances WHERE supplier_id = ?', s.id)) out.push(node(n.type === 'capa' ? 'CAPA' : n.type === 'incident' ? 'INC' : 'NC', n.code, n.title, `status ${n.status}`));
    for (const a of q('SELECT * FROM audits WHERE supplier_id = ?', s.id)) out.push(node('Audit', a.code, a.title, `${a.status} audit, result: ${a.result || 'pending'}`));
    for (const ac of acts('supplier', code)) out.push(node('Action', ac.code, ac.title, 'supplier-related action'));
    const d = q1('SELECT * FROM documents WHERE code = ?', 'DOC-0004') || q1("SELECT * FROM documents WHERE title LIKE '%Supplier%' LIMIT 1");
    if (d) out.push(node('Document', d.code, d.title, 'supplier evaluation procedure'));
    const rp = q1("SELECT * FROM policies WHERE title LIKE '%Supplier%' AND status = 'approved'");
    if (rp) out.push(node('Policy', rp.code, rp.title, 'supplier policy'));
  }
  if (type === 'Equipment') {
    const e = q1('SELECT * FROM equipment WHERE code = ?', code);
    if (!e) return out;
    for (const x of q('SELECT * FROM equipment_qualifications WHERE equipment_id = ?', e.id)) out.push(node('Qualification', e.code, `${x.type} - ${x.status}`, (x.result || '').slice(0, 60)));
    for (const ac of acts('equipment', code)) out.push(node('Action', ac.code, ac.title, 'equipment action'));
    if (e.owner_id) out.push(node('Person', null, `${userName(e.owner_id) || 'Unknown'} (owner)`, 'equipment owner'));
    const d = q1("SELECT * FROM documents WHERE title LIKE '%Calibration%' AND status = 'approved'");
    if (d && e.requires_calibration) out.push(node('Document', d.code, d.title, 'calibration procedure'));
    const text = `${e.name}`.toLowerCase();
    for (const n of q('SELECT * FROM nonconformances WHERE status != ?', 'closed')) {
      const t = `${n.title} ${n.description || ''}`.toLowerCase();
      if (t.includes(text.split(' ')[0]) && text.split(' ')[0].length > 3) out.push(node('NC', n.code, n.title, 'open event referencing this equipment'));
    }
  }
  if (type === 'Document') {
    const d = q1('SELECT * FROM documents WHERE code = ?', code);
    if (!d) return out;
    for (const v of q('SELECT * FROM document_versions WHERE document_id = ? ORDER BY id DESC LIMIT 3', d.id)) out.push(node('Version', d.code, `v${v.version} (${v.status})`, (v.change_summary || '').slice(0, 70)));
    if (d.owner_id) out.push(node('Person', null, `${userName(d.owner_id) || 'Unknown'} (owner)`, 'document owner'));
    for (const ac of acts('document', code)) out.push(node('Action', ac.code, ac.title, 'document action'));
    for (const n of q('SELECT * FROM nonconformances WHERE source = \'audit\' AND status != \'closed\'')) out.push(node('NC', n.code, n.title, 'audit finding on document control'));
  }
  if (type === 'Action') {
    const a = q1('SELECT * FROM actions WHERE code = ?', code);
    if (!a) return out;
    if (a.owner_id) out.push(node('Person', null, `${userName(a.owner_id) || 'Unknown'} (owner)`, 'action owner'));
    if (a.source_code) {
      const found = findByCode(a.source_code);
      if (found) out.push(node(typeLabel(found.module), found.row.code, titleOf(found.module, found.row), `source of this action`));
    }
  }
  if (type === 'Audit') {
    const a = q1('SELECT * FROM audits WHERE code = ?', code);
    if (!a) return out;
    for (const i of q('SELECT * FROM audit_items WHERE audit_id = ? AND finding_type != \'ok\'', a.id)) out.push(node('Finding', a.code, `${i.clause} ${i.finding_type}: ${(i.description || '').slice(0, 50)}`, `status ${i.status}`));
    if (a.supplier_id) { const s = q1('SELECT * FROM suppliers WHERE id = ?', a.supplier_id); if (s) out.push(node('Supplier', s.code, s.name, 'audited supplier')); }
    for (const ac of acts('audit', code)) out.push(node('Action', ac.code, ac.title, 'audit action'));
  }
  if (type === 'KPI' || type === 'Objective') {
    const g = q1('SELECT * FROM goals WHERE code = ?', code);
    if (!g) return out;
    if (g.policy_id) { const p = q1('SELECT * FROM policies WHERE id = ?', g.policy_id); if (p) out.push(node('Policy', p.code, p.title, 'linked policy')); }
    if (g.owner_id) out.push(node('Person', null, `${userName(g.owner_id) || 'Unknown'} (owner)`, 'KPI owner'));
    const n = q('SELECT COUNT(*) AS c FROM goal_entries WHERE goal_id = ?', g.id).c;
    out.push(node('Data', null, `${n} measurement points`, 'recorded performance data'));
    for (const ac of acts('goal', code)) out.push(node('Action', ac.code, ac.title, 'improvement action'));
  }
  if (type === 'Design review') {
    const r = q1('SELECT * FROM design_reviews WHERE code = ?', code);
    if (!r) return out;
    for (const f of q('SELECT * FROM design_findings WHERE review_id = ?', r.id)) out.push(node('Finding', r.code, (f.description || '').slice(0, 60), `${f.severity}, ${f.status}`));
    for (const x of q('SELECT * FROM design_requirements WHERE review_id = ? AND status != \'pass\'', r.id)) out.push(node('Requirement', r.code, (x.requirement || '').slice(0, 60), `status ${x.status}`));
  }
  if (type === 'Policy') {
    const p = q1('SELECT * FROM policies WHERE code = ?', code);
    if (!p) return out;
    for (const g of q('SELECT * FROM goals WHERE policy_id = ?', p.id)) out.push(node('Objective', g.code, g.title, 'linked objective/KPI'));
    for (const ac of acts('policy', code)) out.push(node('Action', ac.code, ac.title, 'policy action'));
  }
  if (type === 'Compliance') {
    const r = q1('SELECT * FROM compliance_requirements WHERE code = ?', code);
    if (!r) return out;
    for (const ac of acts('compliance', code)) out.push(node('Action', ac.code, ac.title, 'gap-closure action'));
    if (r.status === 'non_compliant') out.push(node('Risk', null, 'Compliance exposure', 'non-compliance creates regulatory risk'));
  }
  // dedupe
  const seen = new Set();
  return out.filter(n => { const k = `${n.type}|${n.code}|${n.label}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 18);
}

const TYPE_LABEL = {
  policies: 'Policy', goals: 'KPI', risks: 'Risk', suppliers: 'Supplier', employees: 'Employee',
  competencies: 'Competency', trainings: 'Training', records: 'Record', documents: 'Document',
  design_reviews: 'Design review', equipment: 'Equipment', nonconformances: 'NC', audits: 'Audit',
  compliance: 'Compliance', mgmt_reviews: 'Mgmt review', actions: 'Action'
};
function typeLabel(moduleKey) {
  if (TYPE_LABEL[moduleKey]) return TYPE_LABEL[moduleKey];
  const m = MODULES[moduleKey]; return m ? m.title.replace(/s$/, '').replace('NC & Incident', 'NC') : moduleKey;
}
function titleOf(moduleKey, row) { return row.title || row.name || row.code; }

function graph(type, code, user, depth) {
  const center = node(type, code, code, 'query origin');
  const nb = neighbors(type, code, user);
  const nodes = [center, ...nb];
  const links = nb.map(n => ({ source: code, target: n.label, rel: n.rel }));
  // second hop: expand supplier / action nodes one level
  if (depth > 1) {
    for (const n of [...nb]) {
      if (['Supplier', 'Action'].includes(n.type) && n.code) {
        for (const n2 of neighbors(n.type, n.code, user)) {
          if (n2.label !== center.label) { nodes.push(n2); links.push({ source: n.label, target: n2.label, rel: n2.rel }); }
        }
      }
    }
  }
  const seen = new Set();
  const finalNodes = nodes.filter(n => { const k = n.type + n.label; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 40);
  // Enrich every coded node with its exact record link so all items are clickable
  for (const n of finalNodes) {
    if (n.code && !n.link) {
      try {
        const hit = findByCode(n.code);
        if (hit) {
          const route = ({ policies: 'policies', goals: 'goals', risks: 'risks', suppliers: 'suppliers', employees: 'employees', competencies: 'competencies', trainings: 'trainings', records: 'records', documents: 'documents', design: 'design', equipment: 'equipment', nonconformances: 'nonconformances', audits: 'audits', compliance: 'compliance', mgmt_reviews: 'mgmt-reviews', actions: 'actions' })[hit.module] || null;
          n.id = hit.row.id;
          if (route) n.link = `/${route}/${hit.row.id}`;
        }
      } catch {}
    }
  }
  return { center, nodes: finalNodes, links };
}

/* ------------------------------------------------------------------ *
 * Answer engine: intents + structured responses
 * ------------------------------------------------------------------ */
function entityMentions(text) {
  const found = [];
  const re = /\b(NC|CAPA|INC|RSK|SUP|DOC|POL|ACT|EQ|AUD|KPI|OBJ|ASM|TRN|REC|DR|CR|MR|EMP|CMP)-\d{1,6}\b/gi;
  let m; const seen = new Set();
  while ((m = re.exec(text))) {
    const code = m[0].toUpperCase();
    if (seen.has(code)) continue; seen.add(code);
    const hit = findByCode(code);
    if (hit) found.push(hit);
  }
  return found;
}

function fmtList(items, fn, max) {
  const lines = items.slice(0, max || 8).map(fn);
  if (items.length > (max || 8)) lines.push(`…and ${items.length - (max || 8)} more`);
  return lines;
}

function baseAnswer(intent, user) {
  return { intent, role: user.role, scope: 'authorized live database', generatedAt: new Date().toISOString(), facts: [], findings: [], recommendations: [], citations: [], evidence: [], actions: [] };
}
function cite(ans, type, code, title) {
  if (code && !ans.citations.some(c => c.code === code)) ans.citations.push({ type, code, title, link: linkFor(type, code) });
}

function answerAttention(c, A, user) {
  const a = baseAnswer('needs_attention', user);
  a.facts.push(`Composite attention scan across ${Object.keys(MODULES).length} modules using live data:`);
  if (A.overdueActions.length) a.facts.push(`${A.overdueActions.length} overdue action(s): ${A.overdueActions.slice(0, 4).map(x => x.code).join(', ')}`);
  if (A.highResidualRisks.length) a.facts.push(`${A.highResidualRisks.length} risk(s) with HIGH residual rating: ${A.highResidualRisks.slice(0, 4).map(x => `${x.code} (score ${x.residual_score})`).join(', ')}`);
  if (A.complianceGaps.length) a.facts.push(`${A.complianceGaps.length} compliance gap(s): ${A.complianceGaps.map(x => `${x.code} ${x.framework} ${x.clause}`).join('; ')}`);
  if (A.recurringSuppliers.length) a.facts.push(`${A.recurringSuppliers.length} supplier(s) with repeated quality events, led by ${A.recurringSuppliers[0].supplier.name} (${A.recurringSuppliers[0].count} events)`);
  if (A.overdueNCs.length) a.facts.push(`${A.overdueNCs.length} non-conformance(s)/incident(s) open >30 days`);
  if (A.calibrationDue.filter(e => e.next_calibration < new Date().toISOString().slice(0, 10)).length) a.facts.push(`${A.calibrationDue.filter(e => e.next_calibration < new Date().toISOString().slice(0, 10)).length} equipment item(s) overdue for calibration`);
  if (A.kpisOffTarget.length) a.facts.push(`${A.kpisOffTarget.length} of ${A.kpis.length} KPIs off target: ${A.kpisOffTarget.map(k => `${k.code} (${k.lastValue}${k.target_unit} vs ${k.target_value}${k.target_unit})`).join('; ')}`);
  a.evidence = A.attention.slice(0, 10);
  for (const it of A.attention) cite(a, it.type, it.code, it.title);
  if (A.overdueActions.some(x => x.priority === 'critical')) a.findings.push('Critical-priority actions are overdue — escalation to management is warranted.');
  if (A.complianceGaps.some(g => g.status === 'non_compliant')) a.findings.push('At least one regulatory requirement is assessed non-compliant; this is a notified-body-visible exposure.');
  if (A.recurringSuppliers.length) a.findings.push('Repeat supplier events suggest systemic supplier weakness rather than isolated failures.');
  a.recommendations.push('Work the attention list top-down; the top 5 items cover the highest composite risk scores.');
  if (A.overdueActions.length) a.recommendations.push('Re-baseline or close overdue actions at the next management review; owners should be notified.');
  if (A.complianceGaps.length) a.recommendations.push('Prioritize closure of compliance gaps with linked actions and evidence.');
  return a;
}

function resolveSupplier(c, text) {
  const codeHit = (text.match(/\bSUP-\d{1,6}\b/i) || [])[0];
  if (codeHit) {
    const s = c.suppliers.find(x => x.code === codeHit.toUpperCase());
    if (s) return { one: s };
  }
  const words = String(text || '').toLowerCase().replace(/[^a-z0-9 -]+/g, ' ').split(/\s+/)
    .filter(w => w && w.length > 2 && !/compare|trend|trending|supplier|vendor|with|against|quarter|month|last|history|over|time|improving|declining|better|worse|show|tell|about|please|quarterly|performance|versus|vs|last|this/.test(w)).join(' ').trim();
  if (words.length < 3) return { none: true };
  const hits = c.suppliers.filter(s => s.name.toLowerCase().includes(words) || words.split(' ').some(w => w.length > 3 && s.name.toLowerCase().includes(w)));
  if (!hits.length) return { missing: words };
  if (hits.length === 1) return { one: hits[0] };
  return { many: hits.slice(0, 5) };
}

function answerSupplierTrend(c, A, user, question) {
  const a = baseAnswer('supplier_trend', user);
  const r = resolveSupplier(c, question);
  if (r.none) {
    a.facts.push('Which supplier? Say "compare Nordic" or "compare SUP-0004".');
    return a;
  }
  if (r.missing) {
    a.facts.push(`I don't track a supplier called "${r.missing}".`);
    a.recommendations.push('For overall direction ask "are we better than last month?"; for a supplier try "compare SUP-0004".');
    return a;
  }
  if (r.many) {
    a.facts.push(`Several match — which one? ${r.many.map(s => `${s.code} ${s.name}`).join(' · ')}`);
    r.many.forEach(s => a.citations.push({ type: 'Supplier', code: s.code, title: s.name, link: `/suppliers/${s.id}` }));
    return a;
  }
  const s = r.one;
  const evs = c.supplier_evals.filter(e => e.supplier_id === s.id).sort((x, y) => x.period.localeCompare(y.period));
  cite(a, 'Supplier', s.code, s.name);
  if (evs.length < 2) {
    a.facts.push(`${s.name} (${s.code}) has ${evs.length} evaluation(s) — not enough history to call a trend.`);
    a.facts.push(`Status: ${s.status}${s.risk_level ? ` · risk: ${s.risk_level}` : ''}.`);
    return a;
  }
  const vals = evs.map(e => e.total_score);
  const t = trendOf(vals);
  const delta = Math.round((vals[vals.length - 1] - vals[0]) * 10) / 10;
  a.facts.push(`${s.name} (${s.code}) — ${evs.length} periods, ${evs[0].period} → ${evs[evs.length - 1].period}:`);
  for (const e of evs.slice(-4)) a.facts.push(`• ${e.period}: ${e.total_score}/100`);
  a.facts.push(`Verdict: ${t.direction} (${delta >= 0 ? '+' : ''}${delta} pts). Status ${s.status}${s.risk_level ? `, risk ${s.risk_level}` : ''}.`);
  a.evidence = evs.map(e => ({ period: e.period, score: e.total_score }));
  if (t.direction === 'deteriorating') {
    a.findings.push('Scores are sliding — intervene before it crosses below 70% twice (conditional status per POL-0003).');
    a.recommendations.push('Open a supplier development plan and consider an on-site audit.');
  } else if (t.direction === 'improving') {
    a.findings.push('Recovery in progress — confirm the improvement holds one more period.');
  } else {
    a.findings.push('Flat trend — stable, keep the regular evaluation rhythm.');
  }
  return a;
}

function answerMonthPulse(c, A, user) {
  const a = baseAnswer('month_pulse', user);
  const now = new Date();
  const cur = now.toISOString().slice(0, 7);
  const prevD = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prev = prevD.toISOString().slice(0, 7);
  const curName = now.toLocaleDateString(undefined, { month: 'long' });
  const prevName = prevD.toLocaleDateString(undefined, { month: 'long' });

  // KPIs: latest period avg vs previous period avg, direction-aware
  const kpiLines = [];
  let kpiBetter = 0, kpiWorse = 0;
  for (const g of c.goals) {
    const es = c.goal_entries.filter(e => e.goal_id === g.id);
    if (!es.length) continue;
    const periods = [...new Set(es.map(e => e.period))].sort();
    if (periods.length < 2) continue;
    const avg = p => { const v = es.filter(e => e.period === p).map(e => e.value); return v.reduce((x, y) => x + y, 0) / v.length; };
    const last = avg(periods[periods.length - 1]), before = avg(periods[periods.length - 2]);
    if (last === before) continue;
    const good = g.direction === 'lower' ? last < before : last > before;
    good ? kpiBetter++ : kpiWorse++;
    kpiLines.push(`• ${g.code} ${g.title}: ${before} → ${last} (${good ? 'better' : 'worse'})`);
  }

  const ncCur = c.nonconformances.filter(n => (n.occurred_at || '').startsWith(cur)).length;
  const ncPrev = c.nonconformances.filter(n => (n.occurred_at || '').startsWith(prev)).length;
  const doneCur = c.actions.filter(x => (x.completed_at || '').startsWith(cur)).length;
  const donePrev = c.actions.filter(x => (x.completed_at || '').startsWith(prev)).length;

  const goods = (ncCur <= ncPrev ? 1 : 0) + (doneCur >= donePrev ? 1 : 0) + (kpiBetter >= kpiWorse ? 1 : 0);
  a.facts.push(`${prevName} → ${curName}: ${goods >= 2 ? 'yes, better' : goods === 1 ? 'mixed' : 'no, worse'}.`);
  a.facts.push(`Quality events opened: ${ncPrev} → ${ncCur} (${ncCur <= ncPrev ? 'fewer, good' : 'more — watch it'}).`);
  a.facts.push(`Actions completed: ${donePrev} → ${doneCur} (${doneCur >= donePrev ? 'pace held' : 'pace dropped'}).`);
  if (kpiLines.length) {
    a.facts.push(`KPIs with two periods to compare (${kpiBetter} better, ${kpiWorse} worse):`);
    kpiLines.slice(0, 6).forEach(l => a.facts.push(l));
    for (const g of c.goals.slice(0, 3)) cite(a, 'KPI', g.code, g.title);
  } else {
    a.facts.push('No KPI has two comparable periods yet — record this month to start the comparison.');
  }
  a.evidence = [{ prevMonth: prev, curMonth: cur, ncPrev, ncCur, donePrev, doneCur, kpiBetter, kpiWorse }];
  if (ncCur > ncPrev) a.recommendations.push('More events than last month — check the repeat-pattern suppliers and open NCs.');
  if (doneCur < donePrev) a.recommendations.push('Completion pace dropped — re-baseline overdue owners at the next review.');
  return a;
}

function answerBriefing(c, A, user) {
  const a = baseAnswer('briefing', user);
  const T = new Date().toISOString().slice(0, 10);
  const day = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const first = (user.name || 'there').split(' ')[0];
  const n = x => (x || []).length;

  const overdue = A.overdueActions, crit = overdue.filter(x => x.priority === 'critical');
  const mineOverdue = overdue.filter(x => x.owner_id === user.id);
  const nonComp = A.complianceGaps.filter(g => g.status === 'non_compliant');
  const calOver = A.calibrationDue.filter(e => e.next_calibration && e.next_calibration < T);
  const docsOver = A.docsForReview.filter(d => d.review_date && d.review_date < T);
  const heat = crit.length + nonComp.length + n(A.highResidualRisks);

  a.facts.push(`Good morning, ${first} — ${day}. Your company in 30 seconds:`);
  a.facts.push(heat === 0 && !overdue.length
    ? `Calm day: nothing critical, nothing non-compliant, no high residual risks.`
    : `Verdict: ${heat > 3 ? 'red day' : heat > 0 ? 'busy day' : 'steady day'} — ${heat} critical-level item(s), ${n(overdue)} overdue action(s).`);
  a.facts.push(`Actions: ${n(overdue)} overdue${crit.length ? ` (${crit.length} critical)` : ''}${mineOverdue.length ? `, ${mineOverdue.length} of them yours` : ''} · ${n(A.dueSoonActions)} due within 7 days.`);
  a.facts.push(`Risks: ${n(A.highResidualRisks)} high residual · ${n(A.overdueRiskReviews)} review(s) overdue.`);
  a.facts.push(`Quality events: ${n(A.openNCs)} open NCs/incidents${n(A.overdueNCs) ? ` (${n(A.overdueNCs)} open >30 days)` : ''}.`);
  if (n(nonComp) || n(A.complianceGaps)) a.facts.push(`Compliance: ${n(nonComp)} non-compliant · ${n(A.complianceGaps)} gap(s) total.`);
  const extras = [];
  if (docsOver.length) extras.push(`${docsOver.length} document review(s) overdue`);
  if (n(A.policiesForReview)) extras.push(`${n(A.policiesForReview)} polic(ies) due`);
  if (calOver.length) extras.push(`${calOver.length} calibration(s) overdue`);
  if (n(A.kpisOffTarget)) extras.push(`${n(A.kpisOffTarget)} of ${n(A.kpis)} KPIs off target`);
  if (n(A.expiringAssessments)) extras.push(`${n(A.expiringAssessments)} qualification(s) expiring/expired`);
  if (n(A.pendingSuppliers)) extras.push(`${n(A.pendingSuppliers)} supplier(s) pending`);
  if (n(A.openAuditFindings)) extras.push(`${n(A.openAuditFindings)} audit finding(s) open`);
  if (extras.length) a.facts.push('Also on the radar: ' + extras.join(' · ') + '.');

  const top = A.attention.slice(0, 5);
  if (top.length) {
    a.facts.push(`Today's top ${top.length} — work top-down:`);
    for (const it of top) {
      a.facts.push(`• ${it.code} "${it.title}" — ${it.why}`);
      cite(a, it.type, it.code, it.title);
    }
    a.evidence = A.attention.slice(0, 10);
    a.recommendations.push(`Start with ${top[0].code} — highest risk score (${top[0].pts} pts).`);
  } else {
    a.recommendations.push('Nothing urgent — a good day for reviews and prevention work.');
  }
  a.recommendations.push(`Ask "what needs my signature?" to see your approval pile.`);
  return a;
}

function answerWorseningRisks(c, A, user) {
  const a = baseAnswer('risks_worsening', user);
  const list = A.worseningRisks;
  a.facts.push(`${list.length} risk(s) show worsening signals (insufficient residual reduction, overdue review, or deteriorating context):`);
  for (const r of list.slice(0, 8)) {
    const why = [];
    const score = r.residual_score ?? r.residual_likelihood * r.residual_severity;
    const inhScore = r.inherent_score ?? r.inherent_likelihood * r.inherent_severity;
    if (score >= inhScore * 0.72) why.push(`residual ${score} barely below inherent ${inhScore}`);
    if (r.review_date && r.review_date < new Date().toISOString().slice(0, 10)) why.push(`review overdue (${r.review_date})`);
    a.facts.push(`• ${r.code} "${r.title}" — ${why.join('; ') || 'monitor'} [${riskRating(score).toUpperCase()} residual]`);
    cite(a, 'Risk', r.code, r.title);
  }
  a.evidence = list.slice(0, 10).map(r => ({ code: r.code, title: r.title, inherent: r.inherent_score, residual: r.residual_score, review: r.review_date, status: r.status }));
  a.findings.push('Controls are not reducing exposure as intended for the listed risks.');
  if (A.overdueRiskReviews.length) a.findings.push(`${A.overdueRiskReviews.length} risk review(s) are overdue, so residual scores may be stale.`);
  a.recommendations.push('Re-assess control effectiveness for these risks; escalate high-residual items to management review.');
  a.recommendations.push('Schedule the overdue reviews within 14 days and update residual scoring.');
  return a;
}

function answerSupplierProblems(c, A, user) {
  const a = baseAnswer('supplier_repeated_problems', user);
  if (!A.recurringSuppliers.length) { a.facts.push('No suppliers with repeated quality events found.'); return a; }
  for (const g of A.recurringSuppliers) {
    a.facts.push(`• ${g.supplier.code} ${g.supplier.name} — ${g.count} total event(s), ${g.openCount} open [status: ${g.supplier.status}, risk: ${g.supplier.risk_level}]`);
    for (const i of g.items.slice(0, 3)) a.facts.push(`   – ${i.code || 'SI'} ${(i.title || i.description || '').slice(0, 80)} (${i.occurred_at || i.incident_date || ''}, ${i.status})`);
    cite(a, 'Supplier', g.supplier.code, g.supplier.name);
    const ev = A.decliningSuppliers.find(d => d.supplier.id === g.supplier.id);
    if (ev) a.facts.push(`   – Performance trend: ${ev.trend} (last score ${ev.lastScore}/100)`);
  }
  a.evidence = A.recurringSuppliers.map(g => ({ supplier: g.supplier.name, code: g.supplier.code, events: g.count, open: g.openCount, trend: (A.decliningSuppliers.find(d => d.supplier.id === g.supplier.id) || {}).trend || 'n/a' }));
  a.findings.push('Suppliers listed above have 2+ quality events (NCs, incidents or CAPA) — a repeat pattern, not isolated failures.');
  if (A.decliningSuppliers.length) a.findings.push(`Performance data confirms declining scores for: ${A.decliningSuppliers.map(d => d.supplier.name).join(', ')}.`);
  a.recommendations.push('Trigger supplier development plan / 8D requests for repeat offenders.');
  a.recommendations.push('Per policy POL-0003, suppliers below 70% for two consecutive periods should move to conditional status.');
  a.recommendations.push('Consider on-site supplier audits for suppliers with 3+ events.');
  return a;
}

function answerDocsReview(c, A, user) {
  const a = baseAnswer('documents_review_due', user);
  const overdueD = A.docsForReview.filter(d => d.review_date < new Date().toISOString().slice(0, 10));
  a.facts.push(`${overdueD.length} document(s) OVERDUE for review, ${A.docsForReview.length - overdueD.length} due within 30 days.`);
  for (const d of A.docsForReview.slice(0, 10)) { a.facts.push(`• ${d.code} "${d.title}" v${d.version} — review ${d.review_date < new Date().toISOString().slice(0, 10) ? 'OVERDUE since' : 'due'} ${d.review_date} [${d.status}]`); cite(a, 'Document', d.code, d.title); }
  for (const p of A.policiesForReview.slice(0, 5)) { a.facts.push(`• ${p.code} "${p.title}" (policy) — review due ${p.review_date}`); cite(a, 'Policy', p.code, p.title); }
  a.evidence = A.docsForReview.map(d => ({ code: d.code, title: d.title, review_date: d.review_date, status: d.status }));
  a.findings.push('Overdue document reviews are an audit finding risk (seen in AUD-0003 minor NC).');
  a.recommendations.push('Schedule reviews with owners; batch-approve unchanged documents to clear the backlog.');
  return a;
}

function answerOverdue(c, A, user, kind) {
  const a = baseAnswer(kind === 'calibration' ? 'calibration_due' : kind === 'expiry' ? 'certifications_expiring' : 'overdue_items', user);
  if (kind === 'calibration') {
    for (const e of A.calibrationDue) { a.facts.push(`• ${e.code} ${e.name} — calibration due ${e.next_calibration}${e.next_calibration < new Date().toISOString().slice(0, 10) ? ' (OVERDUE)' : ''}`); cite(a, 'Equipment', e.code, e.name); }
    a.findings.push('Overdue calibration invalidates measurement results taken since the due date.');
    a.recommendations.push('Quarantine affected equipment and review impact on released product.');
  } else if (kind === 'expiry') {
    for (const x of A.expiringAssessments) { a.facts.push(`• ${x.employee_name} — ${x.competency_name} expires ${x.expiry_date}${x.expiry_date < new Date().toISOString().slice(0, 10) ? ' (EXPIRED)' : ''}`); cite(a, 'Competency', x.code, `${x.employee_name} ${x.competency_name}`); }
    a.findings.push('Expired certifications mean affected staff may not meet role competency requirements (POL-0004).');
    a.recommendations.push('Schedule renewals and restrict independent work for expired critical competencies.');
  } else {
    for (const x of A.overdueActions.slice(0, 10)) { a.facts.push(`• ${x.code} ${x.title} — overdue since ${x.due_date} [${x.priority}, owner assigned]`); cite(a, 'Action', x.code, x.title); }
    a.findings.push(`${A.overdueActions.length} actions are past due; ${A.dueSoonActions.length} more due within 7 days.`);
    a.recommendations.push('Escalate overdue critical/high actions to the responsible managers.');
  }
  return a;
}

function answerRelated(c, A, user, hit) {
  const a = baseAnswer('related_entities', user);
  const label = typeLabel(hit.module);
  a.facts.push(`Everything connected to ${hit.row.code} — ${titleOf(hit.module, hit.row)}:`);
  a.facts.push(`Module: ${MODULES[hit.module].title} | Status: ${hit.row.status || 'n/a'}`);
  cite(a, label, hit.row.code, titleOf(hit.module, hit.row));
  const g = graph(label, hit.row.code, user, 2);
  for (const n of g.nodes.filter(n => n.rel !== 'query origin')) {
    a.facts.push(`• [${n.type}] ${n.label} — ${n.rel}`);
    if (n.code) cite(a, n.type, n.code, n.label);
  }
  a.evidence = g.nodes.filter(n => n.rel !== 'query origin').map(n => ({ type: n.type, label: n.label, relation: n.rel }));
  a.findings.push(`${g.nodes.length - 1} connected items found across ${new Set(g.nodes.map(n => n.type)).size} module types — this record sits in an active chain.`);
  // contextual findings from analysis
  if (hit.module === 'nonconformances' && hit.row.status !== 'closed' && hit.row.supplier_id) {
    const g2 = A.recurringSuppliers.find(x => x.supplier.id === hit.row.supplier_id);
    if (g2) a.findings.push(`This event is part of a repeat pattern: supplier has ${g2.count} quality events in total.`);
  }
  a.recommendations.push('Follow the graph links to verify each connected item is being actively managed.');
  a.recommendations.push('Check for a linked management review covering these items.');
  return a;
}

function answerTrend(c, A, user, kpiHit) {
  const a = baseAnswer('trend_analysis', user);
  const kpis = kpiHit ? A.kpis.filter(k => k.code === kpiHit) : A.kpis;
  for (const k of kpis.slice(0, 6)) {
    a.facts.push(`• ${k.code} ${k.title}: last ${k.lastValue}${k.target_unit} (period ${k.lastPeriod}), target ${k.target_value}${k.target_unit} — ${k.onTarget ? 'ON TARGET' : `OFF by ${k.offTargetPct}%`}; trend ${k.trend}`);
    a.facts.push(`   series: ${k.entries.map(e => e.value).join(' → ')}`);
    cite(a, 'KPI', k.code, k.title);
  }
  if (!kpiHit) {
    for (const g of A.recurringDepartments.slice(0, 3)) a.facts.push(`• NC volume by department: ${g.dept} = ${g.count} events (${g.openCount} open)`);
  }
  a.evidence = kpis.map(k => ({ code: k.code, last: k.lastValue, target: k.target_value, trend: k.trend, onTarget: k.onTarget }));
  const det = kpis.filter(k => k.trend === 'deteriorating');
  if (det.length) a.findings.push(`Deteriorating KPIs detected: ${det.map(k => k.code).join(', ')} — investigate drivers.`);
  if (A.kpisOffTarget.length) a.findings.push(`${A.kpisOffTarget.length} KPI(s) currently off target.`);
  a.recommendations.push('For off-target KPIs, link corrective actions and review progress at the next management review.');
  return a;
}

function answerSummarize(c, A, user, hit) {
  const a = baseAnswer('summarize_record', user);
  const r = hit.row, m = MODULES[hit.module];
  const label = typeLabel(hit.module);
  const pairs = Object.entries(r).filter(([k, v]) => v !== null && v !== '' && typeof v !== 'number' || (typeof v === 'number' && v !== 0));
  a.facts.push(`Summary of ${r.code} — ${titleOf(hit.module, r)}:`);
  const keep = ['status', 'severity', 'priority', 'owner_id', 'department', 'occurred_at', 'due_date', 'review_date', 'version', 'effective_date', 'category', 'risk_level', 'result', 'stage', 'framework', 'clause', 'treatment', 'root_cause_category', 'source', 'source_ref', 'residual_likelihood', 'residual_severity', 'next_calibration', 'next_maintenance', 'expiry_date', 'level', 'period', 'total_score'];
  const userName = id => (q1('SELECT name FROM users WHERE id = ?', id) || {}).name;
  for (const k of keep) {
    if (r[k] === undefined || r[k] === null || r[k] === '') continue;
    let v = r[k];
    if (k.endsWith('_id')) v = userName(v) || v;
    a.facts.push(`• ${k.replace(/_/g, ' ')}: ${String(v).slice(0, 140)}`);
  }
  if (r.description) a.facts.push(`• description: ${String(r.description).slice(0, 200)}`);
  if (r.root_cause) a.facts.push(`• root cause: ${String(r.root_cause).slice(0, 200)}`);
  cite(a, label, r.code, titleOf(hit.module, r));
  const g = graph(label, r.code, user, 1);
  a.facts.push(`• connected items: ${g.nodes.filter(n => n.rel !== 'query origin').length}`);
  for (const n of g.nodes.filter(n => n.rel !== 'query origin').slice(0, 5)) a.facts.push(`   – [${n.type}] ${n.label} (${n.rel})`);
  // missing info for this record
  const mi = A.missingInfo.filter(x => x.code === r.code);
  for (const x of mi) a.findings.push(`Missing information: ${x.gaps.join(', ')}.`);
  if (m.dueField && r[m.dueField] && daysUntil(r[m.dueField]) < 0 && !['closed', 'obsolete', 'archived'].includes(r.status)) a.findings.push(`${m.dueField.replace(/_/g, ' ')} is overdue (${r[m.dueField]}).`);
  if (hit.module === 'nonconformances' && r.status !== 'closed') a.findings.push('Record is not closed — verification of effectiveness still pending.');
  a.recommendations.push('Complete the missing fields identified above to keep the record audit-ready.');
  a.recommendations.push('Ensure linked actions are tracked to closure with effectiveness checks.');
  return a;
}

/* Evidence pack: "evidence pack RSK-0001" / "flashcard NC-0002" — a compact,
 * printable one-pager built entirely from live linked data. */
function answerEvidencePack(c, A, user, hit) {
  const a = baseAnswer('evidence_pack', user);
  a.scope = 'one-page evidence pack (live data)';
  const r = hit.row, label = typeLabel(hit.module), title = titleOf(hit.module, r);
  cite(a, label, r.code, title);
  a.facts.push(`Evidence pack — ${r.code} "${title}" (${MODULES[hit.module].title})`);
  const owner = r.owner_id ? (q1('SELECT name FROM users WHERE id = ?', r.owner_id) || {}).name : null;
  const bits = [`status: ${r.status || 'n/a'}`];
  if (owner) bits.push(`owner: ${owner}`);
  if (r.department) bits.push(`department: ${r.department}`);
  for (const k of ['severity', 'priority', 'occurred_at', 'due_date', 'review_date', 'effective_date', 'version', 'next_calibration', 'expiry_date']) {
    if (r[k]) bits.push(`${k.replace(/_/g, ' ')}: ${r[k]}`);
  }
  a.facts.push(bits.join(' · '));
  const inh = r.inherent_score ?? (r.inherent_likelihood ? r.inherent_likelihood * r.inherent_severity : null);
  const res = r.residual_score ?? (r.residual_likelihood ? r.residual_likelihood * r.residual_severity : null);
  if (inh || res) a.facts.push(`Risk score: inherent ${inh ?? 'n/a'} → residual ${res ?? 'n/a'} (${riskRating(res ?? inh).toUpperCase()}).`);
  if (r.description) a.facts.push(`Description: ${String(r.description).slice(0, 220)}`);
  if (r.root_cause) a.facts.push(`Root cause: ${String(r.root_cause).slice(0, 220)}`);
  const g = graph(label, r.code, user, 2);
  const linked = g.nodes.filter(n => n.rel !== 'query origin');
  a.facts.push(`Linked evidence (${linked.length} item(s)):`);
  const rank = n => (n.type === 'Action' ? 0 : n.type === 'NC' ? 1 : ['Risk', 'Audit', 'Document', 'Policy', 'Supplier'].includes(n.type) ? 2 : 3);
  for (const n of [...linked].sort((x, y) => rank(x) - rank(y)).slice(0, 10)) {
    a.facts.push(`• [${n.type}] ${n.label} — ${n.rel}`);
    if (n.code) cite(a, n.type, n.code, n.label);
  }
  let openActs = [];
  try { openActs = q("SELECT code, title, status, due_date FROM actions WHERE source_code = ? AND status NOT IN ('completed','verified','cancelled') ORDER BY due_date", r.code); } catch {}
  if (openActs.length) a.facts.push(`Open actions on this record: ${openActs.map(x => `${x.code} (${x.status}${x.due_date ? ', due ' + x.due_date : ''})`).join('; ')}`);
  const mi = A.missingInfo.filter(x => x.code === r.code);
  for (const x of mi) a.findings.push(`Missing information: ${x.gaps.join(', ')}.`);
  const dueK = ['review_date', 'due_date', 'next_calibration', 'expiry_date'].find(k => r[k] && daysUntil(r[k]) < 0 && !['closed', 'obsolete', 'archived', 'completed', 'verified', 'cancelled'].includes(r.status));
  if (dueK) a.findings.push(`${dueK.replace(/_/g, ' ')} is overdue (${r[dueK]}).`);
  if (hit.module === 'nonconformances' && r.status !== 'closed') a.findings.push('NC not closed — effectiveness verification is still pending.');
  if (!linked.length) a.findings.push('No linked records — an auditor may ask for supporting evidence from outside the system.');
  a.recommendations.push('Print this pack and attach the referenced records as the evidence bundle.');
  a.recommendations.push('Each open action above needs closure evidence: what changed, who verified it, and when.');
  a.actions.push({ kind: 'client', op: 'print', label: 'Print this pack', primary: true });
  a.actions.push({ kind: 'navigate', label: `Open ${r.code}`, link: linkFor(label, r.code), primary: false });
  a.evidence = linked.slice(0, 20).map(n => ({ type: n.type, label: n.label, relation: n.rel, link: n.link || null }));
  return a;
}

const NOISE_ACTIONS = new Set(['ai_ask', 'ai_recommend', 'ai_recommendation_approved', 'login', 'login_failed', 'logout', 'job_run', 'rate_limited', 'export', 'search', 'view', 'page_view', 'watch_sweep']);

function diaryRange(question) {
  const d = new Date();
  const iso = x => x.toISOString().slice(0, 10);
  const shift = days => { const x = new Date(d); x.setUTCDate(x.getUTCDate() - days); return x; };
  let from, to = null, label;
  const mDays = question.match(/last\s+(\d+)\s+days?/i);
  if (/yesterday/i.test(question)) { from = iso(shift(1)); to = iso(d); label = 'yesterday'; }
  else if (/today/i.test(question)) { from = iso(d); label = 'today'; }
  else if (/last week/i.test(question)) { from = iso(shift(14)); to = iso(shift(7)); label = 'last week'; }
  else if (/this week/i.test(question)) { from = iso(shift(7)); label = 'last 7 days'; }
  else if (/last month/i.test(question)) {
    from = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)));
    to = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
    label = 'last month';
  } else if (/this month/i.test(question)) { from = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))); label = 'this month'; }
  else if (mDays) { from = iso(shift(Number(mDays[1]))); label = `last ${mDays[1]} days`; }
  else { from = iso(shift(7)); label = 'last 7 days'; }
  return { from, to, label };
}

/* Change diary: "what changed this week?" — real audit_log changes,
 * noise (logins, AI asks, jobs) filtered out. */
function answerWhatChanged(question, user) {
  const a = baseAnswer('what_changed', user);
  const { from, to, label } = diaryRange(question);
  const rowsAll = to
    ? q('SELECT * FROM audit_log WHERE date(created_at) >= date(?) AND date(created_at) < date(?) ORDER BY id DESC LIMIT 1000', from, to)
    : q('SELECT * FROM audit_log WHERE date(created_at) >= date(?) ORDER BY id DESC LIMIT 1000', from);
  const rows = rowsAll.filter(r => !NOISE_ACTIONS.has(String(r.action || '').toLowerCase()));
  const dayOf = s => String(s || '').slice(0, 10);
  const fmtDay = s => new Date(dayOf(s) + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtTime = s => String(s || '').replace('T', ' ').slice(0, 16);
  const people = [...new Set(rows.map(r => r.user_name).filter(n => n && n !== 'System'))];
  a.facts.push(`Change diary — ${label} (since ${from}): ${rows.length} recorded change(s)${people.length ? ` by ${people.length} ${people.length === 1 ? 'person' : 'people'}` : ''}.`);
  if (!rows.length) {
    a.findings.push('No changes recorded in this period — either a quiet stretch or work happening outside the system.');
    a.recommendations.push('Try "what changed this month" for a wider window.');
    a.recommendations.push('Tap Open activity for the full filterable trail.');
    a.actions.push({ kind: 'navigate', label: 'Open activity', link: '/activity', primary: true, auto: false });
    return a;
  }
  const mods = {};
  for (const r of rows) mods[r.entity_type || 'other'] = (mods[r.entity_type || 'other'] || 0) + 1;
  const modName = t => (MODULES[t] && MODULES[t].title) || (t === 'ai_watches' ? 'AI watches' : t.replace(/_/g, ' '));
  const topMods = Object.entries(mods).sort((x, y) => y[1] - x[1]).slice(0, 5);
  a.facts.push('Busiest areas: ' + topMods.map(([t, n]) => `${modName(t)} (${n})`).join(' · '));
  const actorCount = {};
  for (const r of rows) actorCount[r.user_name || 'System'] = (actorCount[r.user_name || 'System'] || 0) + 1;
  const topActor = Object.entries(actorCount).sort((x, y) => y[1] - x[1])[0];
  if (topActor) a.facts.push(`Most active: ${topActor[0]} (${topActor[1]} change(s)).`);
  const days = {};
  for (const r of rows) days[dayOf(r.created_at)] = (days[dayOf(r.created_at)] || 0) + 1;
  a.facts.push('Per day: ' + Object.entries(days).sort((x, y) => (x[0] < y[0] ? 1 : -1)).slice(0, 8).map(([d, n]) => `${fmtDay(d)}: ${n}`).join(' · '));
  const moves = [];
  for (const r of rows) {
    if (!r.details) continue;
    try {
      const dj = JSON.parse(r.details);
      let pair = null, field = 'status';
      if (dj && dj.from !== undefined && dj.to !== undefined) pair = [dj.from, dj.to];
      else if (dj) {
        const e = Object.entries(dj).find(([, v]) => v && typeof v === 'object' && 'from' in v && 'to' in v);
        if (e) { pair = [e[1].from, e[1].to]; field = e[0]; }
      }
      if (pair) moves.push({ ...r, fromV: pair[0], toV: pair[1], field });
    } catch {}
  }
  if (moves.length) {
    a.facts.push(`Field changes (${moves.length}):`);
    for (const m of moves.slice(0, 6)) a.facts.push(`• ${fmtTime(m.created_at)} — ${m.entity_label || m.entity_type} · ${String(m.field).replace(/_/g, ' ')}: ${m.fromV} → ${m.toV} (${m.user_name || 'System'})`);
  }
  a.facts.push(`Latest ${Math.min(rows.length, 10)} change(s):`);
  for (const r of rows.slice(0, 10)) {
    a.facts.push(`• ${fmtTime(r.created_at)} — ${r.user_name || 'System'} · ${String(r.action || '').replace(/_/g, ' ')} · ${r.entity_label || r.entity_type || ''}`);
    const codeM = String(r.entity_label || '').match(/^([A-Z]{2,4}-\d{1,6})/);
    if (codeM) { try { const hit = findByCode(codeM[1]); if (hit) cite(a, typeLabel(hit.module), hit.row.code, titleOf(hit.module, hit.row)); } catch {} }
  }
  a.evidence = rows.slice(0, 50).map(r => ({ at: r.created_at, actor: r.user_name, action: r.action, entity: r.entity_label, type: r.entity_type }));
  const busiest = Object.entries(days).sort((x, y) => y[1] - x[1])[0];
  if (busiest) a.findings.push(`Busiest day: ${fmtDay(busiest[0])} with ${busiest[1]} change(s).`);
  const approvals = moves.filter(m => m.field === 'status' && String(m.toV) === 'approved').length;
  if (approvals) a.findings.push(`${approvals} approval(s) granted in this period — the decision trail is intact.`);
  a.recommendations.push('Tap Open activity for the full filterable trail (by person, category, date).');
  a.recommendations.push('Ask "what changed today" each morning — silent edits show up here first.');
  a.recommendations.push('Before an audit, print this diary as evidence of active change control.');
  a.actions.push({ kind: 'navigate', label: 'Open activity', link: '/activity', primary: true, auto: false });
  return a;
}

/* Workload & ownership: "who is overloaded?", "who owns RSK-0001?". */
const OPEN_ACT = "status NOT IN ('completed','verified','cancelled')";
function addDaysStr(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

function answerWorkload(question, user) {
  const a = baseAnswer('workload', user);
  const T = new Date().toISOString().slice(0, 10), soon = addDaysStr(T, 7);
  const openActs = q(`SELECT * FROM actions WHERE ${OPEN_ACT} ORDER BY due_date`);
  const by = new Map();
  const bucket = id => {
    const k = id || 0;
    if (!by.has(k)) by.set(k, { id: k, name: id ? ((q1('SELECT name FROM users WHERE id = ?', id) || {}).name || `User ${id}`) : 'Unassigned', open: 0, overdue: 0, critical: 0, soon: 0, risks: 0, ncs: 0, top: [] });
    return by.get(k);
  };
  for (const x of openActs) {
    const b = bucket(x.owner_id); b.open++;
    if (x.due_date && x.due_date < T) b.overdue++;
    if (x.priority === 'critical') b.critical++;
    if (x.due_date && x.due_date >= T && x.due_date <= soon) b.soon++;
    if (b.top.length < 2 && x.due_date && x.due_date < T) b.top.push(x);
  }
  for (const r of q("SELECT owner_id FROM risks WHERE status NOT IN ('closed','archived')")) if (r.owner_id) bucket(r.owner_id).risks++;
  for (const n of q("SELECT owner_id FROM nonconformances WHERE status != 'closed'")) if (n.owner_id) bucket(n.owner_id).ncs++;
  const list = [...by.values()].map(b => ({ ...b, score: b.open * 2 + b.overdue * 3 + b.critical * 3 + b.risks * 2 + b.ncs * 2 })).sort((x, y) => y.score - x.score);
  const unassigned = by.get(0) || { open: 0 };
  const visible = user.role === 'employee' ? list.filter(b => b.id === user.id) : list;
  a.facts.push(`Workload — ${openActs.length} open action(s) across ${list.filter(b => b.id).length} owner(s)${unassigned.open ? ` · ${unassigned.open} unassigned` : ''}.`);
  const band = b => (b.overdue >= 6 || b.critical >= 3 || b.open >= 12 ? 'OVERLOADED' : b.overdue >= 2 || b.open >= 6 ? 'busy' : 'light');
  for (const b of visible.filter(x => x.id).slice(0, 7)) {
    a.facts.push(`• ${b.name} — ${b.open} open (${b.overdue} overdue, ${b.critical} critical, ${b.soon} due ≤7d)${b.risks ? ` · ${b.risks} risk(s)` : ''}${b.ncs ? ` · ${b.ncs} NC(s)` : ''} → ${band(b)}`);
    b.top.forEach(x => cite(a, 'Action', x.code, x.title));
  }
  if (unassigned.open) a.facts.push(`• Unassigned — ${unassigned.open} action(s) nobody owns: assign these first.`);
  const mine = list.find(b => b.id === user.id);
  if (mine) {
    a.facts.push(`Your own load: ${mine.open} open (${mine.overdue} overdue, ${mine.critical} critical).`);
    if (mine.top[0]) a.findings.push(`Your oldest overdue item is ${mine.top[0].code} — "${mine.top[0].title}".`);
  }
  const heavy = list.filter(b => b.id && band(b) === 'OVERLOADED');
  const lights = list.filter(b => b.id && b.open <= 2 && b.overdue === 0);
  if (heavy.length) a.findings.push(`Overloaded right now: ${heavy.map(b => b.name).join(', ')} — commitments will slip.`);
  if (lights.length && heavy.length) a.recommendations.push(`Rebalance: ${lights[0].name} has only ${lights[0].open} open action(s) — a good place to reassign from ${heavy[0].name}.`);
  if (unassigned.open) a.recommendations.push('Assign every unowned action — auditors treat orphan actions as a control gap.');
  a.recommendations.push('Reassess load at the next team meeting; aim for no owner above 6 open actions.');
  a.actions.push({ kind: 'navigate', label: 'Open actions board', link: '/actions?status=open', primary: true, auto: false });
  a.evidence = list.slice(0, 10).map(b => ({ owner: b.name, open: b.open, overdue: b.overdue, critical: b.critical, risks: b.risks, ncs: b.ncs, score: b.score }));
  return a;
}

function answerOwnership(c, A, user, hit) {
  const a = baseAnswer('ownership', user);
  const r = hit.row, label = typeLabel(hit.module), title = titleOf(hit.module, r);
  const T = new Date().toISOString().slice(0, 10);
  cite(a, label, r.code, title);
  a.facts.push(`${r.code} "${title}" — ${MODULES[hit.module].title} · status: ${r.status || 'n/a'}.`);
  const u = r.owner_id ? q1('SELECT name, department, job_title FROM users WHERE id = ?', r.owner_id) : null;
  if (u) {
    a.facts.push(`Owner: ${u.name}${u.job_title ? ` (${u.job_title})` : ''}${u.department ? ` — ${u.department}` : ''}.`);
    const openA = (q1(`SELECT COUNT(*) c FROM actions WHERE owner_id = ? AND ${OPEN_ACT}`, r.owner_id) || {}).c || 0;
    const overA = (q1(`SELECT COUNT(*) c FROM actions WHERE owner_id = ? AND ${OPEN_ACT} AND due_date < ?`, r.owner_id, T) || {}).c || 0;
    const openR = (q1("SELECT COUNT(*) c FROM risks WHERE owner_id = ? AND status NOT IN ('closed','archived')", r.owner_id) || {}).c || 0;
    a.facts.push(`Their current load: ${openA} open action(s)${overA ? ` (${overA} overdue)` : ''} · ${openR} open risk(s).`);
    const plate = q(`SELECT code, title, due_date FROM actions WHERE owner_id = ? AND ${OPEN_ACT} ORDER BY COALESCE(due_date, '9999') LIMIT 3`, r.owner_id);
    if (plate.length) a.facts.push('On their plate: ' + plate.map(x => `${x.code} "${x.title}"${x.due_date ? ` due ${x.due_date}` : ''}`).join(' · '));
    const late = q(`SELECT code, title, due_date FROM actions WHERE owner_id = ? AND ${OPEN_ACT} AND due_date < ? ORDER BY due_date LIMIT 2`, r.owner_id, T);
    late.forEach(x => { a.findings.push(`${x.code} is overdue since ${x.due_date} — chase the owner, not the file.`); cite(a, 'Action', x.code, x.title); });
  } else {
    a.facts.push(`No owner recorded${r.department ? ` — department: ${r.department}` : ''}.`);
    a.findings.push('Unowned record — this is a classic audit finding.');
    a.recommendations.push('Assign an owner before the next review.');
  }
  const linked = q('SELECT code, title, status FROM actions WHERE source_code = ?', r.code);
  if (linked.length) a.facts.push(`Linked action(s): ${linked.map(x => `${x.code} (${x.status})`).join(', ')}.`);
  a.recommendations.push('Tap the record link to reassign or add a deputy in the record form.');
  a.actions.push({ kind: 'navigate', label: `Open ${r.code}`, link: linkFor(label, r.code), primary: true, auto: false });
  return a;
}

/* Slippage risk: "what is at risk of slipping?" — action-level score from
 * overdue days, proximity, owner load, priority, stale age, missing dates. */
function answerSlippage(question, user) {
  const a = baseAnswer('slippage_risk', user);
  const T = new Date().toISOString().slice(0, 10);
  const open = q(`SELECT * FROM actions WHERE ${OPEN_ACT}`);
  const loadBy = {}, overdueBy = {};
  const nameOf = id => (q1('SELECT name FROM users WHERE id = ?', id) || {}).name || 'Unassigned';
  for (const x of open) {
    const k = x.owner_id || 0;
    loadBy[k] = (loadBy[k] || 0) + 1;
    if (x.due_date && x.due_date < T) overdueBy[k] = (overdueBy[k] || 0) + 1;
  }
  const days = d => Math.round((new Date(d + 'T00:00:00Z') - new Date(T + 'T00:00:00Z')) / 86400000);
  const scored = open.map(x => {
    let score = 0; const why = [];
    const d = x.due_date ? days(x.due_date) : null;
    if (d !== null && d < 0) { score += Math.min(45, 20 + (-d)); why.push(`${-d}d overdue`); }
    else if (d !== null && d <= 3) { score += 12; why.push(d === 0 ? 'due today' : `due in ${d}d`); }
    if (d === null) { score += 10; why.push('no due date'); }
    if (x.priority === 'critical') { score += 15; why.push('critical priority'); }
    const load = loadBy[x.owner_id || 0] || 0;
    if (load >= 10) { score += 12; why.push(`owner has ${load} open`); }
    else if (load >= 6) { score += 8; why.push(`owner has ${load} open`); }
    const od = overdueBy[x.owner_id || 0] || 0;
    if (od >= 3) { score += 8; why.push(`${od} overdue on owner`); }
    const age = x.created_at ? (Date.now() - new Date(x.created_at).getTime()) / 86400000 : 0;
    if (age > 30) { score += 6; why.push('open >30 days'); }
    return { ...x, score: Math.min(100, score), why };
  }).filter(x => x.score >= 30).sort((x, y) => y.score - x.score);
  if (!scored.length) {
    const noDates = open.filter(x => !x.due_date).length;
    a.facts.push(`Slippage check — ${open.length} open action(s), nothing scoring at risk right now.`);
    a.findings.push('No action currently trips the 30-point slip threshold — nothing overdue, imminent, or held by an overloaded owner.');
    if (noDates) a.facts.push(`${noDates} open action(s) have no due date — low risk today, but they can slip silently.`);
    a.recommendations.push('Keep due dates on every action — undated work is invisible until it is late.');
    a.actions.push({ kind: 'navigate', label: 'Open actions board', link: '/actions?status=open', primary: true, auto: false });
    return a;
  }
  const veryHigh = scored.filter(x => x.score >= 60);
  const high = scored.filter(x => x.score >= 45 && x.score < 60);
  const watch = scored.length - veryHigh.length - high.length;
  const risky = veryHigh.length + high.length;
  a.facts.push(`Slippage check — ${risky} of ${open.length} open action(s) are at risk of slipping${watch ? ` · ${watch} more at watch level (undated or heavy load)` : ''}.`);
  a.facts.push(`Split: ${veryHigh.length} very likely (≥60) · ${high.length} high (45–59) · ${watch} watch (30–44).`);  for (const x of scored.slice(0, 8)) {
    a.facts.push(`• ${x.code} "${x.title}" — slip risk ${x.score}/100 (${x.why.join(', ')}) · owner: ${nameOf(x.owner_id)} · due: ${x.due_date || 'none'}`);
    cite(a, 'Action', x.code, x.title);
  }
  const top = scored[0];
  a.findings.push(`First to slip: ${top.code} — "${top.title}" (${top.score}/100, ${top.why.join(', ')}).`);
  const overdueOpen = open.filter(x => x.due_date && x.due_date < T).length;
  if (overdueOpen > open.length * 0.3) a.findings.push(`${overdueOpen} of ${open.length} open actions are already overdue — the plan is behind, not at risk.`);
  const noDate = open.filter(x => !x.due_date).length;
  if (noDate) a.findings.push(`${noDate} open action(s) have no due date — they can slip silently.`);
  a.recommendations.push(`Triage ${top.code} first: confirm the owner, reset the date, or escalate it today.`);
  a.recommendations.push('Ask "escalate all overdue actions" to pre-draft the escalation in one Confirm.');
  a.recommendations.push('Ask "who is overloaded?" — slippage usually follows one person holding too much.');
  a.actions.push({ kind: 'navigate', label: 'Open actions board', link: '/actions?status=open', primary: true, auto: false });
  a.evidence = scored.slice(0, 15).map(x => ({ code: x.code, title: x.title, score: x.score, why: x.why, due: x.due_date, owner: nameOf(x.owner_id) }));
  return a;
}

/* What-if: "what if EQ-0007 fails?" — live blast radius from graph links. */
function answerWhatIf(c, A, user, hit) {
  const a = baseAnswer('what_if', user);
  const r = hit.row, label = typeLabel(hit.module), title = titleOf(hit.module, r);
  const T = new Date().toISOString().slice(0, 10);
  cite(a, label, r.code, title);
  const verb = hit.module === 'nonconformances' ? 'escalates or is rejected'
    : (hit.module === 'documents' || hit.module === 'policies') ? 'is withdrawn or found outdated'
    : hit.module === 'suppliers' ? 'fails or is rejected'
    : 'fails or goes offline';
  a.facts.push(`What-if — if ${r.code} "${title}" ${verb}:`);
  const g = graph(label, r.code, user, 2);
  const linked = g.nodes.filter(n => n.rel !== 'query origin');
  const acts = linked.filter(n => n.type === 'Action');
  const ncs = linked.filter(n => ['NC', 'CAPA', 'INC'].includes(n.type));
  const risks = linked.filter(n => n.type === 'Risk');
  const audits = linked.filter(n => n.type === 'Audit');
  const ownActs = q(`SELECT * FROM actions WHERE source_code = ? AND ${OPEN_ACT}`, r.code);
  const overdue = ownActs.filter(x => x.due_date && x.due_date < T);
  const critical = ownActs.filter(x => x.priority === 'critical');
  const impact = linked.length + ownActs.length * 2 + (ncs.length ? 5 : 0) + (critical.length ? 4 : 0);
  a.facts.push(`Impact rating: ${impact >= 18 ? 'HIGH' : impact >= 8 ? 'MEDIUM' : 'LOW'} (rule-based: ${linked.length} link(s), ${ownActs.length} open action(s), ${ncs.length} quality event(s)).`);
  a.facts.push(`Blast radius: ${acts.length} action(s) · ${ncs.length} quality event(s) · ${risks.length} risk(s) · ${audits.length} audit(s) directly connected.`);
  if (ownActs.length) a.facts.push(`Actions on this record: ${ownActs.length} open${overdue.length ? ` (${overdue.length} already overdue)` : ''}${critical.length ? ` · ${critical.length} critical` : ''} — these stall immediately.`);
  if (hit.module === 'equipment') {
    const cal = r.next_calibration;
    a.facts.push(`Equipment: ${r.name} · status ${r.status || 'n/a'}${cal ? ` · next calibration ${cal}` : ''}${r.requires_calibration ? ' · calibration-critical' : ''}.`);
    if (cal && cal < T) a.findings.push('Already past its calibration date — this impact is happening now, not hypothetical.');
    let quals = [];
    try { quals = q('SELECT status FROM equipment_qualifications WHERE equipment_id = ?', r.id); } catch {}
    const passing = quals.filter(x => x.status === 'passed').length;
    a.facts.push(`Qualifications on file: ${quals.length}${passing ? ` (${passing} passed)` : ' — no passing qualification to fall back on'}.`);
    if (!passing) a.findings.push('No passing qualification — there is no documented fallback for this equipment.');
    const first = (r.name || '').toLowerCase().split(' ')[0];
    const evts = q("SELECT code, title, status FROM nonconformances WHERE status != 'closed' AND lower(title || ' ' || COALESCE(description,'')) LIKE ?", '%' + first + '%');
    if (evts.length) a.facts.push(`Open events already referencing it: ${evts.map(x => x.code).join(', ')}.`);
    a.recommendations.push(`Draft a backup plan: "create an action to qualify a backup for ${r.code}".`);
  } else if (hit.module === 'suppliers') {
    a.facts.push(`Supplier: ${r.name} · status ${r.status || 'n/a'} · risk: ${r.risk_level || 'n/a'}.`);
    const openN = q("SELECT code FROM nonconformances WHERE supplier_id = ? AND status != 'closed'", r.id);
    if (openN.length) a.facts.push(`Open events with this supplier: ${openN.map(x => x.code).join(', ')} — a failure compounds an existing problem.`);
    const auditsS = q('SELECT code, status, result FROM audits WHERE supplier_id = ? ORDER BY id DESC LIMIT 3', r.id);
    if (auditsS.length) a.facts.push(`Audits: ${auditsS.map(x => `${x.code} (${x.status}${x.result ? ', ' + x.result : ''})`).join(' · ')}.`);
    const evals = q('SELECT period, total_score FROM supplier_evaluations WHERE supplier_id = ? ORDER BY period DESC LIMIT 2', r.id);
    if (evals.length) a.facts.push(`Recent scores: ${evals.map(e => `${e.period} ${e.total_score}/100`).join(' · ')}.`);
    if (openN.length + (r.risk_level === 'high' || r.risk_level === 'critical' ? 1 : 0) >= 2) a.findings.push('This supplier is already a known weak point — a stop-ship would hit open events first.');
    a.recommendations.push(`Ask "compare ${(r.name || '').split(' ')[0]}" to see the trend, and "replace ${r.code}" is worth a contingency action.`);
  } else if (hit.module === 'risks') {
    const inh = r.inherent_score ?? (r.inherent_likelihood ? r.inherent_likelihood * r.inherent_severity : null);
    const res = r.residual_score ?? (r.residual_likelihood ? r.residual_likelihood * r.residual_severity : null);
    a.facts.push(`Risk ${r.code}: inherent ${inh ?? 'n/a'} → residual ${res ?? 'n/a'} — if it materialises, the residual becomes actual impact.`);
    if (res && res >= 12) a.findings.push('Residual is still high — the controls in place are not enough if this triggers.');
    a.recommendations.push(`Ask "watch ${r.code}" to get alerted when anything linked changes.`);
  } else if (hit.module === 'documents' || hit.module === 'policies') {
    const dept = r.department;
    a.facts.push(`Controlled ${hit.module === 'policies' ? 'policy' : 'document'}${dept ? ` — owned process area: ${dept}` : ''}${r.review_date ? ` · review date ${r.review_date}` : ''}.`);
    if (r.review_date && r.review_date < T) a.findings.push('Review is already overdue — an auditor would treat it as an uncontrolled document today.');
    const evts = dept ? q("SELECT code FROM nonconformances WHERE status != 'closed' AND department = ? LIMIT 3", dept) : [];
    if (evts.length) a.facts.push(`Open events in the same area: ${evts.map(x => x.code).join(', ')} — evidence that the process already leaks.`);
    a.recommendations.push('Check training and process owners who rely on this document before any change.');
  }
  const people = [...new Set(linked.filter(n => n.type === 'Person').map(n => n.label))];
  if (people.length) a.facts.push(`People in the blast radius: ${people.slice(0, 6).join(', ')}.`);
  if (!linked.length) a.findings.push('No linked records found — the failure would be invisible to the QMS until someone reports it.');
  a.recommendations.push(`Tap Open connections to walk the chain yourself, and "watch ${r.code}" to get alerts.`);
  a.actions.push({ kind: 'navigate', label: 'Open connections', link: '/connections', primary: true, auto: false });
  a.actions.push({ kind: 'navigate', label: `Open ${r.code}`, link: linkFor(label, r.code), primary: false });
  a.evidence = linked.slice(0, 20).map(n => ({ type: n.type, label: n.label, relation: n.rel, link: n.link || null }));
  return a;
}

/* Root-cause assist: "why does this keep happening?" — clusters repeat NCs
 * by cause category, department and supplier, grounded in live records. */
function answerRootCause(c, A, user) {
  const a = baseAnswer('root_cause', user);
  const ncs = c.nonconformances || [];
  const openN = ncs.filter(n => n.status !== 'closed');
  a.facts.push(`Root-cause scan — ${ncs.length} quality event(s), ${openN.length} still open, across ${new Set(ncs.map(n => n.department).filter(Boolean)).size} department(s).`);
  const cats = A.recurringRootCauses || [];
  if (cats.length) {
    a.facts.push('Repeat cause categories:');
    for (const g of cats.slice(0, 5)) {
      const sample = g.items.slice(0, 3).map(x => x.code).join(', ');
      const op = g.items.filter(x => x.status !== 'closed').length;
      a.facts.push(`• ${g.cat} — ${g.count} event(s)${op ? ` (${op} open)` : ''}: ${sample}`);
      g.items.slice(0, 2).forEach(x => cite(a, 'NC', x.code, x.title));
    }
  } else {
    a.facts.push('No repeated root-cause category yet — classified events do not form a pattern.');
  }
  if (A.recurringDepartments.length) {
    a.facts.push('Where it repeats:');
    for (const g of A.recurringDepartments.slice(0, 4)) a.facts.push(`• ${g.dept} — ${g.count} event(s), ${g.openCount} open: ${g.items.slice(0, 3).map(x => x.code).join(', ')}`);
  }
  if (A.recurringSuppliers.length) {
    a.facts.push('Supplier patterns:');
    for (const g of A.recurringSuppliers.slice(0, 3)) a.facts.push(`• ${g.supplier.name} (${g.supplier.code}) — ${g.count} event(s), ${g.openCount} open · status ${g.supplier.status || 'n/a'}`);
  }
  const sev = {};
  for (const n of ncs) sev[n.severity || 'unrated'] = (sev[n.severity || 'unrated'] || 0) + 1;
  a.facts.push('Severity mix: ' + Object.entries(sev).map(([k, v]) => `${v} ${k}`).join(' · ') + '.');
  a.facts.push('Fishbone lens: people · process/method · machine · material · measurement · environment — the categories above sit on these branches.');
  const unclassified = ncs.filter(n => !n.root_cause_category).length;
  if (unclassified) a.findings.push(`${unclassified} event(s) have no root-cause category — the pattern cannot be trusted until they are classified.`);
  const classified = ncs.filter(n => n.root_cause_category).length;
  if (cats.length && classified) {
    const top = cats[0];
    const share = Math.round((top.count / classified) * 100);
    a.findings.push(`Dominant cause: "${top.cat}" (${top.count} events, ${share}% of classified). Fix the process, not the symptom.`);
  }
  if (A.recurringDepartments.length) a.findings.push(`${A.recurringDepartments[0].dept} carries ${A.recurringDepartments[0].count} event(s) — check whether its actions close the same failure mode repeatedly.`);
  a.recommendations.push('Pick the top category and test one control change on it for 30 days, then re-run this same scan.');
  a.recommendations.push('Close the loop: for each repeated category, verify the linked actions actually reduced recurrence.');
  if (A.recurringSuppliers.length) a.recommendations.push(`Ask "compare ${(A.recurringSuppliers[0].supplier.name || '').split(' ')[0]}" to see whether that supplier is improving or degrading.`);
  a.actions.push({ kind: 'navigate', label: 'Open NC & Incidents', link: '/nonconformances', primary: true, auto: false });
  a.evidence = [
    { type: 'categories', data: cats.map(g => ({ cat: g.cat, count: g.count })) },
    { type: 'departments', data: A.recurringDepartments.map(g => ({ dept: g.dept, count: g.count, open: g.openCount })) },
    { type: 'suppliers', data: A.recurringSuppliers.map(g => ({ supplier: g.supplier.name, count: g.count, open: g.openCount })) }
  ];
  return a;
}

/* Meeting prep: "prep me for tomorrow's management review" — one page:
 * headline, numbers, decisions, Q&A cheat sheet, talking points. */
function answerMeetingPrep(c, A, user, question) {
  const a = baseAnswer('meeting_prep', user);
  a.scope = 'one-page meeting brief (live data)';
  const T = new Date().toISOString().slice(0, 10);
  const n = x => (x || []).length;
  const tomorrow = /tomorrow/i.test(question);
  const day = new Date();
  let when = 'today';
  const wd = /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.exec(question);
  if (wd) {
    const target = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(wd[1].toLowerCase());
    const diff = (target - day.getDay() + 7) % 7 || 7;
    day.setDate(day.getDate() + diff);
    when = `${wd[1][0].toUpperCase() + wd[1].slice(1).toLowerCase()} (${day.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })})`;
  } else if (tomorrow) {
    day.setDate(day.getDate() + 1);
    when = `tomorrow (${day.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })})`;
  }
  const overdue = A.overdueActions, crit = overdue.filter(x => x.priority === 'critical');
  const nonComp = A.complianceGaps.filter(g => g.status === 'non_compliant');
  const calOver = A.calibrationDue.filter(e => e.next_calibration && e.next_calibration < T);
  const docsOver = A.docsForReview.filter(d => d.review_date && d.review_date < T);
  const readiness = answerAuditReadiness(c, A, user).facts[0].replace('Audit-readiness score: ', '');
  a.facts.push(`Meeting prep — ${when}. Suggested run time: 30 minutes. One page, live numbers.`);
  a.facts.push(`1) Headline: ${readiness}`);
  a.facts.push(`2) Numbers: ${n(overdue)} overdue action(s) (${crit.length} critical) · ${n(A.dueSoonActions)} due ≤7d · ${n(A.openNCs)} open NC(s) · ${n(A.highResidualRisks)} high-residual risk(s).`);
  a.facts.push(`3) Controls: ${n(docsOver)} document review(s) overdue · ${n(A.policiesForReview)} policy due · ${n(calOver)} calibration(s) overdue · ${n(nonComp)} non-compliant · ${n(A.kpisOffTarget)}/${n(A.kpis)} KPI(s) off target.`);
  const inReviewPolicies = q("SELECT code FROM policies WHERE status = 'in_review'");
  const inReviewDocs = q("SELECT code FROM documents WHERE status = 'in_review'");
  const dec = [];
  if (inReviewPolicies.length) dec.push(`${inReviewPolicies.map(x => x.code).join(', ')} awaiting approval (policies)`);
  if (inReviewDocs.length) dec.push(`${inReviewDocs.map(x => x.code).join(', ')} awaiting approval (documents)`);
  if (crit.length) dec.push(`escalation on ${crit.slice(0, 2).map(x => x.code).join(', ')}`);
  if (nonComp.length) dec.push(`gap-closure owners for ${nonComp.slice(0, 2).map(g => g.code).join(', ')}`);
  a.facts.push('4) Decisions needed: ' + (dec.length ? dec.join(' · ') : 'none pending — use the slot for prevention work') + '.');
  const rc = (A.recurringRootCauses && A.recurringRootCauses[0]) || null;
  const qa = [
    ['How many overdue actions?', `${n(overdue)} (${crit.length} critical, ${overdue.filter(x => x.owner_id === user.id).length} mine)`],
    ['Are we audit-ready?', readiness],
    ['Where do repeat problems come from?', rc ? `${rc.cat} — ${rc.count} event(s)` : 'no repeat category identified'],
    ['First thing to slip?', A.attention[0] ? `${A.attention[0].code} — ${A.attention[0].title}` : 'nothing flagged']
  ];
  a.facts.push('5) Questions you will be asked — answers ready:');
  qa.forEach(([q, ans]) => a.facts.push(`• "${q}" → ${ans}`));
  const top = A.attention.slice(0, 4);
  if (top.length) {
    a.facts.push('6) Talking points (top 4 by risk score):');
    for (const it of top) { a.facts.push(`• ${it.code} "${it.title}" — ${it.why}`); cite(a, it.type, it.code, it.title); }
    a.evidence = A.attention.slice(0, 10);
  }
  a.findings.push(`Bring one evidence pack per talking point — say "evidence pack ${top[0] ? top[0].code : 'RSK-0001'}" to print one.`);
  a.recommendations.push('Open with the audit-readiness line, then ask for the decisions listed above.');
  a.recommendations.push('End with owners and dates for every open item — no meeting without assignments.');
  a.actions.push({ kind: 'navigate', label: 'Open management review draft', link: '/mgmt-reviews', primary: true, auto: false });
  a.actions.push({ kind: 'navigate', label: 'Open actions board', link: '/actions?status=open', primary: false, auto: false });
  return a;
}

/* Competency radar: "who isn't qualified?" — coverage, below-level assessments,
 * expiries, missing files and training gaps, filtered for employee self-view. */
function answerCompetency(c, A, user) {
  const a = baseAnswer('competency', user);
  const T = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const active = (c.employees || []).filter(e => (e.status || 'active') === 'active');
  const asmts = c.assessments || [];
  const nameOf = id => (active.find(e => e.id === id) || {}).name || `employee ${id}`;
  const citeOne = x => cite(a, 'Competency', x.code, `${x.employee_name} — ${x.competency_name}`);

  const selfEmp = user.role === 'employee'
    ? active.find(e => e.user_id === user.id || (e.email && user.email && e.email.toLowerCase() === String(user.email).toLowerCase()) || e.name === user.name)
    : null;
  if (user.role === 'employee') {
    if (!selfEmp) {
      a.facts.push('No employee record is linked to your account, so there is no competency file to show.');
      a.findings.push('Ask your quality manager to link your user account to your employee record.');
      a.actions.push({ kind: 'navigate', label: 'Open competencies', link: '/competencies', primary: true, auto: false });
      return a;
    }
    const mine = asmts.filter(x => x.employee_id === selfEmp.id);
    a.facts.push(`Your competency record — ${selfEmp.name} (${selfEmp.code}, ${selfEmp.department || 'no department'}) · ${mine.length} assessment(s) on file.`);
    for (const x of mine.slice(0, 10)) {
      const flag = x.expiry_date && x.expiry_date < T ? ' (EXPIRED)' : (x.level != null && x.required_level != null && x.level < x.required_level ? ' (BELOW LEVEL)' : '');
      a.facts.push(`• ${x.competency_name}: level ${x.level ?? '?'}${x.required_level != null ? ` / required ${x.required_level}` : ''}${x.expiry_date ? ` · expires ${x.expiry_date}` : ''}${flag}`);
      citeOne(x);
    }
    const below = mine.filter(x => x.level != null && x.required_level != null && x.level < x.required_level);
    const expired = mine.filter(x => x.expiry_date && x.expiry_date < T);
    if (expired.length) a.findings.push(`${expired.length} of your qualification(s) are expired — do not sign off independent work until renewed.`);
    if (below.length) a.findings.push(`${below.length} competency(ies) are below the required level — ask for a development plan.`);
    if (!mine.length) a.findings.push('No assessments on file — your training evidence is missing.');
    if (!expired.length && !below.length && mine.length) a.findings.push('Everything current and at level — nothing to fix.');
    a.actions.push({ kind: 'navigate', label: 'Open competencies', link: '/competencies', primary: true, auto: false });
    return a;
  }

  const people = active;
  const expired = asmts.filter(x => x.expiry_date && x.expiry_date < T);
  const soon = asmts.filter(x => x.expiry_date && x.expiry_date >= T && x.expiry_date <= in30);
  const under = asmts.filter(x => x.level != null && x.required_level != null && x.level < x.required_level);
  const covered = people.filter(e => asmts.some(x => x.employee_id === e.id && (!x.expiry_date || x.expiry_date >= T)));
  const noEv = people.filter(e => !asmts.some(x => x.employee_id === e.id));
  const coverage = people.length ? Math.round((covered.length / people.length) * 100) : 100;

  a.facts.push(`Competency radar — ${people.length} active employee(s), ${asmts.length} assessment(s), ${under.length} below required level, ${expired.length} expired.`);
  a.facts.push(`Coverage: ${coverage}% (${covered.length}/${people.length} people have at least one current assessment).`);
  if (under.length) {
    a.facts.push('Below required level:');
    for (const x of under.slice(0, 5)) {
      a.facts.push(`• ${x.employee_name} — ${x.competency_name}: level ${x.level} vs required ${x.required_level}`);
      citeOne(x);
    }
  }
  if (expired.length) {
    a.facts.push('Expired:');
    for (const x of expired.slice(0, 5)) { a.facts.push(`• ${x.employee_name} — ${x.competency_name}, expired ${x.expiry_date}`); citeOne(x); }
  }
  if (soon.length) {
    a.facts.push('Expiring within 30 days:');
    for (const x of soon.slice(0, 5)) { a.facts.push(`• ${x.employee_name} — ${x.competency_name}, expires ${x.expiry_date}`); citeOne(x); }
  }
  if (noEv.length) a.facts.push(`No competency evidence on file: ${noEv.slice(0, 5).map(e => `${e.name} (${e.code}, ${e.department || 'no department'})`).join(' · ')}.`);

  const tr = c.trainings || [];
  const tp = c.training_participants || [];
  const overdueTr = tr.filter(t => t.status === 'scheduled' && t.scheduled_date && t.scheduled_date < T);
  const invited = tp.filter(p => p.status === 'invited');
  if (overdueTr.length || invited.length) {
    const invNames = [...new Set(invited.map(p => nameOf(p.employee_id)))].slice(0, 3);
    a.facts.push(`Training gaps: ${overdueTr.length} session(s) past their scheduled date${overdueTr.length ? ` (${overdueTr.slice(0, 2).map(t => t.code).join(', ')})` : ''} · ${invited.length} booking(s) still invited${invNames.length ? ` (${invNames.join(', ')})` : ''}.`);
  }

  const gapIds = new Set([...under.map(x => x.employee_id), ...expired.map(x => x.employee_id), ...noEv.map(e => e.id)]);
  const byDept = {};
  for (const e of people.filter(e => gapIds.has(e.id))) byDept[e.department || 'Unassigned'] = (byDept[e.department || 'Unassigned'] || 0) + 1;
  const deptRows = Object.entries(byDept).sort((x, y) => y[1] - x[1]).slice(0, 3);
  if (deptRows.length) a.facts.push(`Department lens: ${deptRows.map(([d, n]) => `${d} ${n}`).join(' · ')}.`);

  if (expired.length) a.findings.push(`${expired.length} expired qualification(s) — suspend independent work until renewed.`);
  if (under.length) a.findings.push(`${under.length} assessment(s) below the required level — development plans needed before sign-off.`);
  if (noEv.length) a.findings.push(`${noEv.length} active employee(s) have no competency evidence — an auditor will ask for their training file.`);
  if (overdueTr.length) a.findings.push(`${overdueTr.length} training session(s) are past their date — attendance cannot be proven.`);
  if (!expired.length && !under.length && !noEv.length && !overdueTr.length) a.findings.push('No competency gaps found — all active staff are current and at level.');

  if (under.length) a.recommendations.push(`Raise the below-level assessments first: ${under.slice(0, 3).map(x => `${x.employee_name} (${x.competency_name})`).join(', ')}.`);
  if (overdueTr.length || invited.length) a.recommendations.push(`Close out the ${overdueTr.length} overdue session(s) and confirm the ${invited.length} invited participant(s).`);
  if (noEv.length) a.recommendations.push(`Create evidence for ${noEv.slice(0, 2).map(e => e.name).join(', ')} — say "create an action to assess ${noEv[0].name}".`);

  a.actions.push({ kind: 'navigate', label: 'Open competencies', link: '/competencies', primary: true, auto: false });
  a.actions.push({ kind: 'navigate', label: 'Open training', link: '/trainings', primary: false, auto: false });
  a.evidence = [...under, ...expired, ...soon].slice(0, 20).map(x => ({
    type: 'Assessment', code: x.code, employee: x.employee_name, competency: x.competency_name,
    level: x.level, required: x.required_level, expires: x.expiry_date || null
  }));
  if (!a.evidence.length) a.evidence = noEv.slice(0, 10).map(e => ({ type: 'Employee', code: e.code, employee: e.name, gap: 'no competency evidence' }));
  return a;
}

/* Data-health check: "what's missing from our records?" — grouped gaps. */
function answerDataHealth(c, A, user) {
  const a = baseAnswer('data_health', user);
  const missing = A.missingInfo || [];
  const gapCount = missing.reduce((t, m) => t + m.gaps.length, 0);
  const byType = {};
  for (const m of missing) (byType[m.type] = byType[m.type] || []).push(m);
  const types = Object.entries(byType).sort((x, y) => y[1].length - x[1].length);
  a.facts.push(`Data-health check — ${missing.length} record(s) with ${gapCount} missing field(s), across ${types.length} module(s).`);
  const gapTotals = {};
  for (const m of missing) for (const g of m.gaps) gapTotals[g] = (gapTotals[g] || 0) + 1;
  for (const [type, list] of types) {
    const own = {};
    for (const m of list) for (const g of m.gaps) own[g] = (own[g] || 0) + 1;
    const topGap = Object.entries(own).sort((x, y) => y[1] - x[1])[0];
    a.facts.push(`• ${typeLabel(type)} — ${list.length} record(s), mostly "${topGap[0]}" (${topGap[1]})`);
  }
  const topGaps = Object.entries(gapTotals).sort((x, y) => y[1] - x[1]).slice(0, 3);
  if (topGaps.length) a.facts.push(`Top gaps: ${topGaps.map(([g, n]) => `${g} (${n})`).join(' · ')}.`);
  const worst = [...missing].sort((x, y) => y.gaps.length - x.gaps.length).slice(0, 5);
  if (worst.length) {
    a.facts.push('Worst records:');
    for (const m of worst) { a.facts.push(`• ${m.code} "${m.title}" — ${m.gaps.join('; ')}`); cite(a, typeLabel(m.type), m.code, m.title); }
  }
  const actMissing = byType.actions || [];
  const supMissing = byType.suppliers || [];
  const docMissing = byType.documents || [];
  const ncMissing = byType.nonconformances || [];
  const riskMissing = byType.risks || [];
  if (actMissing.length) a.findings.push(`${actMissing.length} open action(s) have no due date — they can slip silently until someone asks.`);
  if (supMissing.length) a.findings.push(`${supMissing.length} supplier record(s) are approved without evidence (never evaluated or no qualification date) — a supplier-control finding.`);
  if (docMissing.length) a.findings.push(`${docMissing.length} approved document(s) have no review date — auditors treat them as uncontrolled.`);
  if (ncMissing.length) a.findings.push(`${ncMissing.length} open quality event(s) miss root cause or containment — the investigation cannot be audited yet.`);
  if (riskMissing.length) a.findings.push(`${riskMissing.length} risk(s) lack controls or a review date — risk treatment is unproven.`);
  if (!missing.length) a.findings.push('No missing fields found — data hygiene is clean.');
  if (actMissing.length) a.recommendations.push('Clear the biggest bucket first: open the actions board and set due dates on every open action.');
  if (supMissing.length || docMissing.length) a.recommendations.push('Then close the approval-evidence gaps: supplier evaluations and document review dates.');
  if (ncMissing.length || riskMissing.length) a.recommendations.push(`Write the missing root cause/containment (${ncMissing.length}) and risk controls (${riskMissing.length}) before the next audit.`);
  a.recommendations.push('Re-run this same check after cleanup — the count should drop to zero.');
  a.actions.push({ kind: 'navigate', label: 'Open actions board', link: '/actions?status=open', primary: true, auto: false });
  if (docMissing.length) a.actions.push({ kind: 'navigate', label: 'Open documents', link: '/documents', primary: false, auto: false });
  else if (supMissing.length) a.actions.push({ kind: 'navigate', label: 'Open suppliers', link: '/suppliers', primary: false, auto: false });
  a.evidence = worst.map(m => ({ type: typeLabel(m.type), code: m.code, title: m.title, gaps: m.gaps }));
  return a;
}

/* Supplier dependency radar: "are we too dependent on one supplier?" */
function answerSupplierDependency(c, A, user) {
  const a = baseAnswer('supplier_dependency', user);
  const T = new Date().toISOString().slice(0, 10);
  const sup = (c.suppliers || []).filter(s => ['approved', 'conditional'].includes(s.status));
  const byCat = {};
  for (const s of sup) { const cat = s.category || 'Uncategorised'; (byCat[cat] = byCat[cat] || []).push(s); }
  const cats = Object.entries(byCat);
  const solo = cats.filter(([, list]) => list.length === 1).map(([cat, list]) => ({ cat, s: list[0] }));
  const openNCs = id => (c.nonconformances || []).filter(n => n.supplier_id === id && n.status !== 'closed');
  const openInc = id => (c.supplier_incidents || []).filter(i => i.supplier_id === id && i.status !== 'closed');
  const evalsFor = id => (c.supplier_evals || []).filter(e => e.supplier_id === id).sort((x, y) => (y.period || '').localeCompare(x.period || ''));
  const auditsFor = id => (c.audits || []).filter(x => x.supplier_id === id);
  const rank = sup.map(s => {
    const ncs = openNCs(s.id), inc = openInc(s.id), ev = evalsFor(s.id), au = auditsFor(s.id);
    let score = 0; const why = [];
    if (['high', 'critical'].includes(s.risk_level)) { score += 5; why.push(`${s.risk_level} risk`); }
    if (s.status === 'conditional') { score += 4; why.push('conditional status'); }
    if (ncs.length) { score += ncs.length * 2; why.push(`${ncs.length} open NC`); }
    if (inc.length) { score += inc.length * 2; why.push(`${inc.length} open incident`); }
    if (!ev.length) { score += 3; why.push('never evaluated'); }
    if (!s.qualification_date) { score += 2; why.push('no qualification date'); }
    if (!au.length) { score += 1; why.push('never audited'); }
    if (solo.some(x => x.s.id === s.id)) { score += 3; why.push('sole source'); }
    if (s.next_audit && s.next_audit < T) { score += 2; why.push(`audit overdue ${s.next_audit}`); }
    return { s, ncs, inc, ev, au, score, why, lastScore: ev[0] ? ev[0].total_score : null };
  }).sort((x, y) => y.score - x.score);

  a.facts.push(`Supplier dependency radar — ${sup.length} active supplier(s) across ${cats.length} categor(ies); ${solo.length} categor(ies) have only one supplier.`);
  if (solo.length) {
    a.facts.push('Sole-source categories (no qualified backup):');
    for (const x of solo.slice(0, 6)) a.facts.push(`• ${x.cat} — ${x.s.name} (${x.s.code}, ${x.s.status}, ${x.s.risk_level || 'n/a'} risk)`);
  }
  a.facts.push('Highest exposure:');
  for (const x of rank.slice(0, 4)) {
    a.facts.push(`• ${x.s.name} (${x.s.code}) — exposure ${x.score} pts · ${x.why.join(', ') || 'no flags'}${x.lastScore != null ? ` · last evaluation ${x.lastScore}/100` : ''}`);
    cite(a, 'Supplier', x.s.code, x.s.name);
  }
  const ncAll = (c.nonconformances || []).filter(n => n.supplier_id && n.status !== 'closed');
  const incAll = (c.supplier_incidents || []).filter(i => i.status !== 'closed');
  a.facts.push(`Supplier events: ${ncAll.length} open NC(s) · ${incAll.length} open incident(s).`);
  const top = rank[0];
  if (solo.length === cats.length && cats.length) a.findings.push(`Every active category has exactly one supplier — a single failure stops that supply line.`);
  if (top && top.score >= 8) a.findings.push(`Weakest link: ${top.s.name} — ${top.why.join(', ')}.`);
  if (sup.filter(s => s.status === 'conditional').length) a.findings.push(`${sup.filter(s => s.status === 'conditional').length} supplier(s) are already conditional — the dependency is degraded today.`);
  if (sup.filter(s => !evalsFor(s.id).length).length) a.findings.push(`${sup.filter(s => !evalsFor(s.id).length).length} active supplier(s) have never been evaluated.`);
  if (!sup.length) a.findings.push('No approved or conditional suppliers on file.');
  if (solo.length) a.recommendations.push(`Qualify a second source for ${solo[0].cat}: say "create an action to qualify a backup supplier for ${solo[0].cat}".`);
  if (top) a.recommendations.push(`Ask "what if ${top.s.code} fails?" for the blast radius, and "compare ${(top.s.name || '').split(' ')[0]}" for the trend.`);
  a.actions.push({ kind: 'navigate', label: 'Open suppliers', link: '/suppliers', primary: true, auto: false });
  a.actions.push({ kind: 'navigate', label: 'Open risk register', link: '/risks', primary: false, auto: false });
  a.evidence = rank.slice(0, 12).map(x => ({
    type: 'Supplier', code: x.s.code, name: x.s.name, category: x.s.category, status: x.s.status,
    risk: x.s.risk_level, exposure: x.score, openNCs: x.ncs.length, openIncidents: x.inc.length,
    lastEvaluation: x.lastScore, flags: x.why
  }));
  return a;
}

function answerMgmtDraft(c, A, user) {
  const d = managementReviewDraft(c, A, user);
  const a = baseAnswer('management_review_draft', user);
  a.facts.push(...d.sections.map(s => `## ${s.heading}\n` + s.items.map(i => `• ${i}`).join('\n')));
  a.findings.push(...d.keyFindings);
  a.recommendations.push(...d.decisions);
  a.citations = d.citations;
  return a;
}

function answerCompliance(c, A, user) {
  const a = baseAnswer('compliance_gaps', user);
  for (const g of A.complianceGaps) { a.facts.push(`• ${g.code} ${g.framework} ${g.clause} "${g.title}" — ${g.status.replace('_', ' ')}`); cite(a, 'Compliance', g.code, g.title); }
  for (const g of A.unassessed) a.facts.push(`• ${g.code} ${g.framework} ${g.clause} — NOT YET ASSESSED`);
  a.evidence = [...A.complianceGaps, ...A.unassessed].map(g => ({ code: g.code, framework: g.framework, clause: g.clause, status: g.status }));
  a.findings.push(`${A.complianceGaps.length} gap(s) and ${A.unassessed.length} unassessed requirement(s).`);
  a.recommendations.push('Assign owners and gap-closure actions for non-compliant items before the next external audit.');
  return a;
}

function answerMissing(c, A, user) {
  const a = baseAnswer('missing_information', user);
  a.facts.push(`${A.missingInfo.length} record(s) with missing information detected:`);
  for (const x of A.missingInfo.slice(0, 12)) { a.facts.push(`• ${x.code} "${x.title}" — missing: ${x.gaps.join(', ')}`); cite(a, typeLabel(CODE_TO_MODULE[x.code.split('-')[0]] || 'records'), x.code, x.title); }
  a.evidence = A.missingInfo;
  a.findings.push('Incomplete records are a data-integrity risk and common audit finding.');
  a.recommendations.push('Assign completion tasks to owners; prioritize open NCs without root cause.');
  return a;
}

/* Audit-readiness: "are we ready for an audit?" — transparent rule-based
 * score computed from live data; every lost point names real records. */
function answerAuditReadiness(c, A, user) {
  const a = baseAnswer('audit_readiness', user);
  a.scope = 'audit readiness score (rule-based, from live data)';
  const T = new Date().toISOString().slice(0, 10);
  const n = x => (x || []).length;
  const docsOver = A.docsForReview.filter(d => d.review_date && d.review_date < T);
  const calOver = A.calibrationDue.filter(e => e.next_calibration && e.next_calibration < T);
  const nonComp = A.complianceGaps.filter(g => g.status === 'non_compliant');
  const secs = [
    { name: 'Corrective actions', items: A.overdueActions, per: 4, cap: 24, citeType: 'Action', desc: 'overdue' },
    { name: 'Non-conformances >30 days', items: A.overdueNCs, per: 5, cap: 20, citeType: 'NC', desc: 'open over 30 days' },
    { name: 'Document control', items: docsOver, per: 3, cap: 15, citeType: 'Document', desc: 'review overdue' },
    { name: 'Policy control', items: A.policiesForReview, per: 2, cap: 6, citeType: 'Policy', desc: 'review due' },
    { name: 'Risk reviews', items: A.overdueRiskReviews, per: 3, cap: 12, citeType: 'Risk', desc: 'review overdue' },
    { name: 'High residual risks', items: A.highResidualRisks, per: 3, cap: 12, citeType: 'Risk', desc: 'high residual rating' },
    { name: 'Equipment calibration', items: calOver, per: 4, cap: 12, citeType: 'Equipment', desc: 'calibration overdue' },
    { name: 'Compliance register', items: nonComp, per: 6, cap: 18, citeType: 'Compliance', desc: 'non-compliant' },
    { name: 'Internal audit findings', items: A.openAuditFindings, per: 3, cap: 12, citeType: 'Audit', desc: 'finding still open' },
    { name: 'Supplier control', items: A.pendingSuppliers, per: 2, cap: 6, citeType: 'Supplier', desc: 'pending qualification' },
    { name: 'Data integrity', items: A.missingInfo, per: 1, cap: 10, desc: 'record missing fields' }
  ];
  const rows = secs.map(s => ({ ...s, loss: Math.min(s.cap, n(s.items) * s.per) })).filter(s => n(s.items));
  const loss = rows.reduce((t, s) => t + s.loss, 0);
  const score = Math.max(0, 100 - loss);
  const verdict = score >= 85 ? 'READY — green across the board'
    : score >= 70 ? 'MOSTLY READY — pre-empt a few findings'
    : score >= 55 ? 'PATCHY — an auditor will find these fast'
    : 'NOT READY — fix the worst sections first';
  a.facts.push(`Audit-readiness score: ${score}/100 — ${verdict}.`);
  a.facts.push('Rule-based score from your live database — every lost point is a real record named below.');
  for (const s of rows) {
    const ex = s.items.filter(x => x.code).slice(0, 3).map(x => x.code).join(', ');
    a.facts.push(`• ${s.name}: ${n(s.items)} × ${s.desc} → −${s.loss} pts${ex ? ` (e.g. ${ex})` : ''}`);
    s.items.slice(0, 3).forEach(x => {
      const type = s.citeType || typeLabel(CODE_TO_MODULE[(x.code || '').split('-')[0]] || 'records');
      cite(a, type, x.code, x.title);
    });
  }
  if (!rows.length) a.facts.push('Nothing flagged in any section — spotless.');
  const worst = [...rows].sort((x, y) => y.loss - x.loss).slice(0, 3);
  a.findings.push(`Auditors probe these first: ${worst.length ? worst.map(s => s.name.toLowerCase()).join(', ') : 'nothing — keep it that way'}. Have owners and dispositions ready.`);
  worst.forEach(s => a.recommendations.push(`Close out ${s.name.toLowerCase()}: ${n(s.items)} open item(s) in your live data right now.`));
  a.recommendations.push('Print this answer (Ctrl+P) a week before the audit and walk every bullet to its owner.');
  a.recommendations.push('Ask "escalate all overdue actions" to pre-draft the whole escalation in one Confirm.');
  a.actions.push({ kind: 'navigate', label: 'Open Actions', link: '/actions', primary: true, auto: false });
  a.actions.push({ kind: 'navigate', label: 'Open Audits', link: '/audits', primary: false, auto: false });
  a.evidence = secs.map(s => ({ section: s.name, count: n(s.items), loss: s.loss }));
  return a;
}

const INTENTS = [
  { id: 'month_pulse', match: /better than last|versus|month over month|this month|last month|are we (better|worse|improving)|month vs|vs\.? month/i, run: answerMonthPulse },
  { id: 'briefing', match: /brief(ing)?|morning briefing|daily (brief|summary|report)|what( is|'s)? (happening|new|going on)|today'?s priorit|rundown|catch me up|how is the company|company status/i, run: answerBriefing },
  { id: 'mgmt_review', match: /management review|mgmt review|review draft/i, run: answerMgmtDraft },
  { id: 'worsening', match: /worse|worsen|deteriorat|getting bad|increasing risk/i, run: answerWorseningRisks },
  { id: 'suppliers', match: /supplier|vendor/i, run: answerSupplierProblems },
  { id: 'docs_review', match: /document|doc\b|policy|policies|review due|needs review/i, run: answerDocsReview },
  { id: 'calibration', match: /calibrat/i, run: (c, A, u) => answerOverdue(c, A, u, 'calibration') },
  { id: 'expiry', match: /expir|certificat|competenc|training/i, run: (c, A, u) => answerOverdue(c, A, u, 'expiry') },
  { id: 'related', match: /connected|related|linked|everything about|graph|this incident|this (nc|risk|supplier|document)/i, run: null },
  { id: 'trend', match: /trend|how.*(doing|performing)|forecast|direction|kpi/i, run: null },
  { id: 'missing', match: /missing|incomplete|gaps in data|data quality/i, run: answerMissing },
  { id: 'compliance', match: /complian|conformity|regulat|iso|mdr|fda|gdpr/i, run: answerCompliance },
  { id: 'overdue', match: /overdue|late|past due/i, run: (c, A, u) => answerOverdue(c, A, u, 'actions') },
  { id: 'attention', match: /attention|priorit|important|focus|what should|top items|status|overview|summary of everything/i, run: answerAttention }
];

/* Multi-job paragraphs: "open risks, brief me, and watch RSK-0001".
 * Long messages split into jobs; each runs the full pipeline (depth-guarded).
 * Only combined when 2+ jobs give real answers. */
function splitTasks(q) {
  const verbLook = '(?:open|create|brief|watch|approve|close|submit|show|take|go|find|turn|compare|complete|escalate|tell|give|list|add|log|monitor)';
  const parts = String(q || '')
    .replace(/(\d+)[.)]\s*/g, '\n$1. ')
    .split(new RegExp('\\n+|;\\s+|\\s+and then\\s+|\\s+then\\s+(?=' + verbLook + '\\b)|\\s+and\\s+(?=' + verbLook + '\\b)', 'i'))
    .flatMap(s => s.split(/(?<=[.?!])\s+(?=[A-Z0-9"'])/))
    .map(s => (s || '').trim().replace(/^(and|then|also|plus|after that|finally)\b[,\s]*/i, '').trim())
    .filter(s => s.length >= 12 || /^(open|create|brief|watch|approve|close|submit|show|take|go|find|turn|compare|complete|escalate|tell|give|list|add|log|monitor)\b/i.test(s));
  return parts;
}

const SKIP_INTENTS = new Set(['general_guidance', 'off_topic']);

function tryMulti(question, user) {
  const parts = splitTasks(question);
  if (parts.length < 2) return null;
  const runs = [];
  for (const seg of parts.slice(0, 4)) {
    let ans = null;
    try { ans = ask(seg, user, null, 1); } catch { ans = null; }
    if (ans && !SKIP_INTENTS.has(ans.intent)) runs.push({ seg, ans });
  }
  if (runs.length < 2) return null;
  const a = baseAnswer('multi_task', user);
  a.scope = 'multi-task (one message, several jobs)';
  a.facts.push(`Big message — I split it into ${runs.length} jobs and did them all:`);
  runs.forEach((r, i) => {
    a.facts.push(`Job ${i + 1} — "${r.seg.slice(0, 80)}":`);
    (r.ans.facts || []).slice(0, 8).forEach(f => a.facts.push('• ' + f));
    (r.ans.actions || []).forEach(x => a.actions.push(x));
    (r.ans.citations || []).forEach(c => {
      if (c && c.code && !a.citations.some(e => e.code === c.code)) a.citations.push(c);
    });
  });
  // One automatic jump max — the rest stay tappable buttons.
  let jumped = false;
  a.actions.forEach(x => {
    if (x.kind === 'navigate' && x.auto) {
      if (!jumped) jumped = true;
      else x.auto = false;
    }
  });
  a.recommendations.push('All jobs done above — tap any button to jump, Confirm to approve drafts.');
  return { ...a, question };
}

function askInner(question, user, ctx, depth) {
  // Memory first: "open the second one" resolves against the previous answer.
  if (ctx) {
    try {
      const mem = memory.resolve(question, ctx);
      if (mem) {
        const cites = (ctx.citations || []).filter(c => c && c.code);
        const hit = memory.pick(cites, mem.index);
        if (!hit && cites.length) {
          const a = baseAnswer('clarify', user);
          a.facts.push(`I see ${cites.length} items — which one? Say "the first one", "the second one", or "the last one".`);
          cites.slice(0, 6).forEach((c, i) => a.actions.push({ kind: 'navigate', label: `${c.code}`, link: c.link, primary: false, auto: false }));
          return { ...a, question };
        }
        if (hit && mem.type === 'open' && hit.link) {
          const a = baseAnswer('do_action', user);
          a.scope = 'memory (previous answer)';
          a.facts.push(`Opening ${hit.code}${hit.title ? ` "${hit.title}"` : ''} — taking you there now.`);
          a.actions.push({ kind: 'navigate', label: `Open ${hit.code}`, link: hit.link, primary: true, auto: true });
          a.citations.push(hit);
          return { ...a, question };
        }
        if (hit && mem.type === 'more' && hit.code) {
          return ask(`summarize ${hit.code}`, user, null);
        }
        if (hit && mem.type === 'watch' && hit.code) {
          return ask(`watch ${hit.code}`, user, null);
        }
      }
    } catch {}
  }
  // Big paragraphs: split into jobs (depth-guarded, top level only).
  if (!depth) {
    try {
      const multi = tryMulti(question, user);
      if (multi) return multi;
    } catch {}
  }
  // Collect once for everything below.
  const c = collect(user);
  const A = analyze(c, user);

  // Supplier trend & comparison pre-guide ("compare Nordic", "SUP-0004 trend last quarter")
  // (skipped when another module is clearly meant: "compare documents")
  if (/compar|trend|improv|declin|better\b|worse\b|history|over time|quarter/i.test(question)
    && !/\b(documents?|risks?|audits?|actions?|polic(y|ies)|goals?|kpis?|objectives?|equipment|nc\b|incidents?|compliance|trainings?|competenc\w*|employees?|people)\b/i.test(question)
    && (/supplier|vendor|\bSUP-\d/i.test(question) || /\b[A-Z][a-z]{2,}\b/.test(question))) {
    return { ...answerSupplierTrend(c, A, user, question), question };
  }
  // KPI trend pre-guide ("how are the KPIs trending?")
  if (/trend|forecast|direction/i.test(question) && /kpi|goal|objective/i.test(question)) {
    return { ...answerTrend(c, A, user, null), question };
  }
  // Month-over-month pulse pre-guide ("are we better than last month?")
  if (/better than last month|worse than last month|month over month|vs\.? last month|versus last month|are we (better|worse|improving)/i.test(question)) {
    return { ...answerMonthPulse(c, A, user), question };
  }
  // Audit-readiness pre-guide ("are we ready for an audit?", "ISO 9001 ready?")
  if (/ready|readiness|prepared|prepar/i.test(question) && /audit|iso|9001|inspection/i.test(question)) {
    return { ...answerAuditReadiness(c, A, user), question };
  }
  // Change diary pre-guide ("what changed this week?", "what happened today?")
  if (/what(?:'s| is| has)? (?:changed|happened)|change ?(?:log|diary)|recent (?:changes|activity)|activity (?:this|last|today)|who changed|timeline/i.test(question)) {
    return { ...answerWhatChanged(question, user), question };
  }
  // Workload pre-guide ("who is overloaded?", "my workload")
  if (/workload|overload|too much work|who(?:'s| is) (?:busy|swamped|overloaded|loaded)|(?:work|load) balance|who has the most (?:open|work)|my workload/i.test(question)) {
    return { ...answerWorkload(question, user), question };
  }
  // Slippage pre-guide ("what is at risk of slipping?", "what will be late?")
  if (/at risk of (?:slipping|missing|being late)|likely to slip|slip(?:ping)? risk|what will (?:slip|be late)|risk of (?:delay|slippage)|what('s| is) at risk/i.test(question)) {
    return { ...answerSlippage(question, user), question };
  }
  // What-if pre-guide ("what if EQ-0007 fails?", "impact of NC-0002")
  if (/what if|what happens if|impact (?:of|if)|if .*(?:fails|goes down|is rejected|is closed|lost|stops)|simulate/i.test(question)) {
    const impacted = entityMentions(question);
    if (impacted.length) return { ...answerWhatIf(c, A, user, impacted[0]), question };
  }
  // Root-cause pre-guide ("why does this keep happening?", "root cause analysis")
  if (/why (?:does|do|is|are|did).*(?:keep (?:having|repeating|happening)|repeat|recur)|root[ -]?cause|fishbone|recur(?:ring)? (?:problem|issue|nc)|why again|what(?:'s| is) causing/i.test(question)) {
    return { ...answerRootCause(c, A, user), question };
  }
  // Meeting prep pre-guide ("prep me for tomorrow's management review")
  if (/(?:prep|prepare) (?:me|us) for|meeting (?:prep|brief|agenda)|agenda for|what should (?:i|we) (?:say|present|raise)|management review (?:prep|brief)/i.test(question)) {
    return { ...answerMeetingPrep(c, A, user, question), question };
  }
  // Calibration due pre-guide ("what calibration is due?", "what is overdue for calibration?")
  if (/calibrat\w*/i.test(question) && /due|overdue|expir|schedule|when|coming up/i.test(question)) {
    return { ...answerOverdue(c, A, user, 'calibration'), question };
  }
  // Competency radar pre-guide ("who isn't qualified?", "training gaps")
  if (/who(?:'s| is| are)?\s+(?:not\s+)?(?:qualified|competent|trained)\b|who (?:isn't|aren't) (?:qualified|competent|trained)|who needs training|competenc\w*|skills? gap|training gap|qualification gap|(?:expired|expiring) (?:training|certificat\w*|qualification\w*)|(?:training|competenc\w*|qualification\w*|certificat\w*) [^?.]*expir\w*|\bnot qualified\b|\bnot competent\b/i.test(question)) {
    return { ...answerCompetency(c, A, user), question };
  }
  // Data-health pre-guide ("what's missing from our records?")
  if (/data (?:health|quality|hygiene|completeness)|missing (?:fields?|data|info|information)|incomplete (?:records?|data)|what(?:'s| is) missing (?:from|in) (?:our|the) (?:records?|data|files?|qms)|records? (?:missing|without|incomplete)|clean ?up (?:the )?(?:data|records)|audit file/i.test(question)) {
    return { ...answerDataHealth(c, A, user), question };
  }
  // Supplier dependency pre-guide ("are we too dependent on one supplier?")
  if (/supplier (?:dependenc|concentration|exposure|risk|redundan)|sole[- ]source|single[- ]source|too dependent on|only one supplier|backup supplier|supply risk|which suppliers? (?:are|is)? ?(?:risky|single)/i.test(question)) {
    return { ...answerSupplierDependency(c, A, user), question };
  }
  // Ownership pre-guide ("who owns RSK-0001?", "owner of NC-0002")
  if (/who (?:owns|is responsible for|is the owner of)|owner of|who(?:'s| is) in charge/i.test(question)) {
    const owners = entityMentions(question);
    if (owners.length) return { ...answerOwnership(c, A, user, owners[0]), question };
  }

  // Do-actions first: "open / take me to / find ..." executes navigation + record opening.
  try {
    const acted = doer.interpret(question, user);
    if (acted) return { ...acted, question };
  } catch {}
  // Make-actions second: "create / add / log ..." drafts a record, human confirms.
  try {
    const made = maker.interpret(question, user);
    if (made) return { ...made, question };
  } catch {}
  // Flow-actions third: "approve / submit / close / complete ..." prepares the move, human confirms.
  try {
    const moved = flow.interpret(question, user);
    if (moved) return { ...moved, question };
  } catch {}
  // Bulk moves fourth: "escalate all overdue ..." drafts N changes, one Confirm.
  try {
    const batched = bulk.interpret(question, user);
    if (batched) return { ...batched, question };
  } catch {}
  // Watchdog fifth: "watch RSK-0001 ..." guards a record, human confirms.
  try {
    const watched = watcher.interpret(question, user);
    if (watched) return { ...watched, question };
  } catch {}
  // Site-guide questions: built-in knowledge, no database trip.
  const guided = guide.answerSiteGuide(question, user);
  if (guided) return { ...guided, question };
  const mentions = entityMentions(question);

  // Evidence pack: "evidence pack RSK-0001", "flashcard NC-0002", "print pack".
  const wantsPack = /flash.?card|evidence pack|one[- ]pager|print(able)? (summary|pack|card|sheet)|audit pack|evidence (for|on)|dossier/i.test(question);
  if (mentions.length && wantsPack) return { ...answerEvidencePack(c, A, user, mentions[0]), question };

  // entity-specific intents take priority
  const wantsRelated = /connected|related|linked|everything about|graph|show all/i.test(question);
  const wantsSummary = /summar|explain|tell me about|what is|describe/i.test(question);
  if (mentions.length && (wantsRelated || wantsSummary || mentions.length === 1 && !/trend/i.test(question))) {
    const hit = mentions[0];
    if (wantsRelated) return { ...answerRelated(c, A, user, hit), question };
    if (/trend/i.test(question) && CODE_TO_MODULE[hit.row.code.split('-')[0]] === 'goals') return { ...answerTrend(c, A, user, hit.row.code), question };
    return { ...answerSummarize(c, A, user, hit), question };
  }

  // KPI trend intent with explicit KPI mention
  if (/trend|perform/i.test(question) && mentions.length) {
    const kpi = mentions.find(m => m.module === 'goals');
    if (kpi) return { ...answerTrend(c, A, user, kpi.row.code), question };
  }

  for (const it of INTENTS) {
    if (it.match.test(question)) {
      if (it.run) return { ...it.run(c, A, user), question };
    }
  }
  if (/trend|kpi|performance/i.test(question)) return { ...answerTrend(c, A, user, null), question };

  // Off-topic: refuse politely instead of guessing.
  if (guide.isOffTopic(question)) return { ...guide.offTopicAnswer(user), question };

  // fallback: attention + guidance
  const a = answerAttention(c, A, user);
  a.intent = 'general_guidance';
  a.facts.unshift(`I matched your question to a general system scan. Try asking more specifically:`);
  a.recommendations.push('Examples: "Which risks are getting worse?", "Which suppliers have repeated problems?", "Show everything connected to NC-0005", "Which documents need review?", "Prepare a management review summary", "Summarize RSK-0001", "What information is missing?"');
  return { ...a, question };
}

/* Arabic wrapper: detect Arabic, answer quick ones directly, normalize the
 * rest to English for the full pipeline, then arabize the scaffolding. */
function ask(question, user, ctx, depth) {
  if (!ctx && ar.isArabic(question)) {
    try {
      const aquick = ar.quick(question, user);
      if (aquick) return { ...aquick, question };
      const norm = ar.normalize(question);
      if (norm === question) return { ...ar.offTopicAr(user), question };
      const a = askInner(norm, user, null, depth || 0);
      if (!a || a.intent === 'off_topic') return { ...ar.offTopicAr(user), question };
      return ar.arabize(a, user);
    } catch {}
  }
  return askInner(question, user, ctx, depth);
}

/* ------------------------------------------------------------------ *
 * Proactive insights
 * ------------------------------------------------------------------ */
function insights(user) {
  const c = collect(user);
  const A = analyze(c, user);
  const out = [];
  const add = (severity, title, body, link) => out.push({ severity, title, body, link, generatedAt: new Date().toISOString() });
  if (A.overdueActions.length) add('warning', 'Overdue actions detected', `${A.overdueActions.length} actions past due date across ${new Set(A.overdueActions.map(a => a.source_type)).size} source modules.`, '/actions');
  if (A.complianceGaps.some(g => g.status === 'non_compliant')) add('critical', 'Compliance exposure', `${A.complianceGaps.filter(g => g.status === 'non_compliant').length} requirement(s) assessed non-compliant.`, '/compliance');
  if (A.recurringSuppliers.length) add('warning', 'Recurring supplier problems', `${A.recurringSuppliers[0].supplier.name}: ${A.recurringSuppliers[0].count} quality events detected — pattern, not isolated.`, `/suppliers/${A.recurringSuppliers[0].supplier.id}`);
  const det = A.kpis.filter(k => k.trend === 'deteriorating');
  if (det.length) add('warning', 'Deteriorating KPIs', `${det.map(k => `${k.code} (${k.lastValue}${k.target_unit})`).join(', ')} trending down.`, '/goals');
  if (A.ineffectiveControls.length) add('warning', 'Risk controls ineffective', `${A.ineffectiveControls.length} mitigated risk(s) where residual ≈ inherent — controls not reducing exposure.`, '/risks');
  if (A.missingInfo.length) add('info', 'Data quality gaps', `${A.missingInfo.length} records missing required information (root causes, dates, controls).`, null);
  if (A.expiringAssessments.filter(x => x.expiry_date < new Date().toISOString().slice(0, 10)).length) add('warning', 'Expired certifications', `${A.expiringAssessments.filter(x => x.expiry_date < new Date().toISOString().slice(0, 10)).length} competency assessment(s) expired.`, '/competencies');
  if (!out.length) add('info', 'All clear', 'No significant anomalies detected in this scan.', '/dashboard');
  return out;
}

/* ------------------------------------------------------------------ *
 * Management review draft (auto-collected inputs)
 * ------------------------------------------------------------------ */
function managementReviewDraft(c, A, user) {
  const T = new Date().toISOString().slice(0, 10);
  const citations = [];
  const cite0 = (type, code, title) => code && citations.push({ type, code, title, link: linkFor(type, code) });
  const sections = [];
  const sec = (heading, items) => sections.push({ heading, items });

  sec('1. KPI & Objective Performance', [
    ...A.kpis.map(k => `${k.code} ${k.title}: ${k.lastValue}${k.target_unit} vs target ${k.target_value}${k.target_unit} — ${k.onTarget ? 'ON TARGET' : `OFF TARGET (${k.offTargetPct}%)`}, trend ${k.trend}.`)
  ]);
  A.kpis.forEach(k => cite0('KPI', k.code, k.title));

  sec('2. Risk Profile', [
    `Total open risks: ${c.risks.filter(r => r.status !== 'closed').length}; high residual: ${A.highResidualRisks.length}.`,
    ...A.highResidualRisks.slice(0, 5).map(r => `${r.code} "${r.title}" residual ${r.residual_score} (${r.residual_rating}) — ${r.treatment}.`),
    ...A.worseningRisks.slice(0, 3).map(r => `Worsening: ${r.code} — controls not reducing exposure / review overdue.`)
  ]);
  A.highResidualRisks.forEach(r => cite0('Risk', r.code, r.title));

  sec('3. Non-conformities, Incidents & CAPA', [
    `Open NC/incidents: ${A.openNCs.length}; open >30 days: ${A.overdueNCs.length}; closed in period: ${c.nonconformances.filter(n => n.status === 'closed').length}.`,
    ...A.overdueNCs.slice(0, 4).map(n => `${n.code} "${n.title}" (${n.severity}) open since ${n.occurred_at}.`)
  ]);
  A.overdueNCs.forEach(n => cite0('NC', n.code, n.title));

  sec('4. Actions Status', [
    `Open: ${c.actions.filter(a => ['open', 'in_progress'].includes(a.status)).length}, overdue: ${A.overdueActions.length}, critical open: ${A.criticalActions.length}.`,
    ...A.overdueActions.slice(0, 5).map(a => `${a.code} "${a.title}" due ${a.due_date} (${a.priority}).`)
  ]);
  A.overdueActions.forEach(a => cite0('Action', a.code, a.title));

  sec('5. Supplier Performance', [
    ...A.recurringSuppliers.slice(0, 4).map(g => `${g.supplier.name}: ${g.count} quality events (${g.openCount} open), status ${g.supplier.status}.`),
    ...A.decliningSuppliers.slice(0, 3).map(d => `${d.supplier.name}: last score ${d.lastScore}/100, trend ${d.trend}.`),
    A.pendingSuppliers.length ? `${A.pendingSuppliers.length} supplier(s) pending qualification.` : 'No suppliers pending qualification.'
  ]);
  A.recurringSuppliers.forEach(g => cite0('Supplier', g.supplier.code, g.supplier.name));

  sec('6. Audits & Compliance', [
    ...c.audits.slice(0, 3).map(a => `${a.code} ${a.title}: ${a.status}${a.result ? ', result: ' + a.result : ''}.`),
    `Open audit findings: ${A.openAuditFindings.length}.`,
    ...A.complianceGaps.map(g => `${g.code} ${g.framework} ${g.clause}: ${g.status.replace('_', ' ')}.`)
  ]);
  c.audits.forEach(a => cite0('Audit', a.code, a.title));
  A.complianceGaps.forEach(g => cite0('Compliance', g.code, g.title));

  sec('7. Documents, Training & Equipment', [
    `Document reviews overdue: ${A.docsForReview.filter(d => d.review_date < T).length}; policies due: ${A.policiesForReview.length}.`,
    `Expiring/expired competencies: ${A.expiringAssessments.length}; trainings scheduled: ${c.trainings.filter(t => t.status === 'scheduled').length}.`,
    `Calibrations due/overdue: ${A.calibrationDue.length}; equipment down: ${A.equipmentDown.length}; pending qualifications: ${A.pendingQuals.length}.`,
    ...A.calibrationDue.filter(e => e.next_calibration < T).slice(0, 3).map(e => `${e.code} ${e.name} calibration overdue (${e.next_calibration}).`)
  ]);
  A.docsForReview.forEach(d => cite0('Document', d.code, d.title));

  sec('8. Design & Development', [
    `Upcoming reviews: ${A.upcomingDesignReviews.map(r => r.code).join(', ') || 'none'}.`,
    `Open design findings: ${A.openDesignFindings.length}; failed requirements: ${A.failedRequirements.length}.`
  ]);
  A.openDesignFindings.forEach(f => cite0('Design review', f.review_code, (f.description || '').slice(0, 60)));

  const keyFindings = [];
  if (A.complianceGaps.some(g => g.status === 'non_compliant')) keyFindings.push('Regulatory non-compliance exists and requires prioritized closure.');
  if (A.recurringSuppliers.length) keyFindings.push(`${A.recurringSuppliers[0].supplier.name} shows a repeat quality event pattern requiring supplier development intervention.`);
  if (A.overdueActions.length) keyFindings.push(`${A.overdueActions.length} overdue actions indicate capacity or priority issues in action management.`);
  if (A.kpisOffTarget.length) keyFindings.push(`${A.kpisOffTarget.length} KPI(s) off target: ${A.kpisOffTarget.map(k => k.code).join(', ')}.`);
  if (A.ineffectiveControls.length) keyFindings.push('Several risk controls are not reducing residual exposure as intended.');

  const decisions = [
    'Approve resource allocation for compliance gap closure.',
    'Decide on conditional status for repeat-offender suppliers.',
    'Re-baseline overdue actions with committed dates.',
    'Confirm next management review date and owners for follow-up items.'
  ];

  return { generatedAt: new Date().toISOString(), sections, keyFindings, decisions, citations, stats: { modulesScanned: Object.keys(MODULES).length } };
}

/* ------------------------------------------------------------------ *
 * Optional LLM phrasing layer (only rephrases provided facts)
 * ------------------------------------------------------------------ */
async function llmPhrase(question, answer, user) {
  if (!config.ai.openaiKey) return null;
  const context = JSON.stringify({
    intent: answer.intent,
    facts: answer.facts.slice(0, 40),
    findings: answer.findings,
    recommendations: answer.recommendations,
    citations: answer.citations.slice(0, 20)
  });
  const sys = `You are the AI Brain of a Quality Management System. You will receive a user question and VERIFIED SYSTEM DATA (JSON) produced by deterministic database queries.
RULES:
1. Use ONLY the provided data. Never invent entities, numbers, codes or dates.
2. If the data does not answer the question, say so explicitly.
3. Structure the reply in markdown with four sections: Facts, Evidence, Possible findings, Recommendations.
4. Cite entity codes (e.g. NC-0005) inline wherever a claim is made.
5. Be concise and professional.`;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.ai.openaiKey}` },
      body: JSON.stringify({
        model: config.ai.model,
        messages: [{ role: 'system', content: sys }, { role: 'user', content: `QUESTION: ${question}\n\nVERIFIED SYSTEM DATA:\n${context}` }],
        temperature: 0.2, max_tokens: 900
      })
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j.choices && j.choices[0] ? j.choices[0].message.content : null;
  } catch { return null; }
}

/* ------------------------------------------------------------------ *
 * Full-system connection map: every verified cross-module relationship.
 * ------------------------------------------------------------------ */
function buildNetwork(user) {
  const nodes = [], edges = [];
  const nodeById = new Map();
  const addNode = (id, type, code, label, link) => {
    if (nodeById.has(id)) return nodeById.get(id);
    const n = { id, type, code: code || null, label: String(label || code || id).slice(0, 70), link: link || null };
    nodeById.set(id, n); nodes.push(n);
    return n;
  };
  const link = (aId, bId, rel) => {
    if (!nodeById.has(aId) || !nodeById.has(bId)) return;
    if (aId === bId) return;
    const a = nodeById.get(aId), b = nodeById.get(bId);
    edges.push({ from: aId, to: bId, fromType: a.type, fromLabel: a.code || a.label, toType: b.type, toLabel: b.code || b.label, rel });
  };

  const T = new Date().toISOString().slice(0, 10);
  const suppliers = q('SELECT * FROM suppliers');
  for (const s of suppliers) addNode(`sup:${s.id}`, 'Supplier', s.code, s.name, `/suppliers/${s.id}`);

  // Non-conformances / incidents / CAPA → supplier, owner
  for (const n of q('SELECT * FROM nonconformances')) {
    const id = `nc:${n.id}`;
    addNode(id, n.type === 'capa' ? 'CAPA' : n.type === 'incident' ? 'Incident' : 'NC', n.code, n.title, `/nonconformances/${n.id}`);
    if (n.supplier_id) link(`sup:${n.supplier_id}`, id, 'quality event');
    if (n.owner_id) {
      const o = addNode(`usr:${n.owner_id}`, 'Person', null, userNameOf(n.owner_id));
      link(id, o.id, 'owned by');
    }
  }
  // Supplier evaluations & incidents
  for (const e of q('SELECT * FROM supplier_evaluations')) {
    const id = `sev:${e.id}`;
    addNode(id, 'Evaluation', null, `${e.period} · score ${e.total_score}`);
    link(`sup:${e.supplier_id}`, id, 'evaluated');
  }
  for (const i of q('SELECT * FROM supplier_incidents')) {
    const id = `sinc:${i.id}`;
    addNode(id, 'Incident', null, (i.description || '').slice(0, 60), null);
    link(`sup:${i.supplier_id}`, id, 'incident');
  }
  // Actions → their source record (any module)
  const codeIndex = new Map();
  for (const [key, m] of Object.entries(MODULES)) {
    if (!m.search) continue;
    for (const row of q(`SELECT * FROM ${m.table}`)) {
      if (row.code) codeIndex.set(row.code, { key, id: row.id, code: row.code, title: row.title || row.name || row.code, status: row.status });
    }
  }
  const routeFor = key => ({ policies: 'policies', goals: 'goals', risks: 'risks', suppliers: 'suppliers', employees: 'employees', competencies: 'competencies', trainings: 'trainings', records: 'records', documents: 'documents', design: 'design', equipment: 'equipment', nonconformances: 'nonconformances', audits: 'audits', compliance: 'compliance', mgmt_reviews: 'mgmt-reviews' }[key] || null);
  for (const a of q('SELECT * FROM actions')) {
    const id = `act:${a.id}`;
    addNode(id, 'Action', a.code, a.title, `/actions?focus=${a.id}`);
    if (a.source_code && codeIndex.has(a.source_code)) {
      const src = codeIndex.get(a.source_code);
      const sid = `${src.key}:${src.id}`;
      if (!nodeById.has(sid)) {
        const typeKey = MODULES[src.key];
        addNode(sid, typeKey ? typeKey.title.replace(/s$/, '').replace('NC & Incident', 'NC') : src.key, src.code, src.title, routeFor(src.key) ? `/${routeFor(src.key)}/${src.id}` : null);
      }
      link(sid, id, 'raised action');
    }
    if (a.owner_id) {
      const o = addNode(`usr:${a.owner_id}`, 'Person', null, userNameOf(a.owner_id));
      link(o.id, id, 'responsible for');
    }
  }
  // Risks → department docs & linked actions already via actions; add risk → policy
  for (const g of q('SELECT * FROM goals WHERE policy_id IS NOT NULL')) {
    const gid = `goal:${g.id}`;
    addNode(gid, 'KPI', g.code, g.title, `/goals/${g.id}`);
    const p = q1('SELECT * FROM policies WHERE id = ?', g.policy_id);
    if (p) { const pid = `pol:${p.id}`; addNode(pid, 'Policy', p.code, p.title, `/policies/${p.id}`); link(pid, gid, 'measured by'); }
  }
  // Documents → owner person
  for (const d of q('SELECT * FROM documents WHERE status = \'approved\'')) {
    const id = `doc:${d.id}`;
    addNode(id, 'Document', d.code, d.title, `/documents/${d.id}`);
    if (d.owner_id) { const o = addNode(`usr:${d.owner_id}`, 'Person', null, userNameOf(d.owner_id)); link(id, o.id, 'owned by'); }
  }
  // Audits → supplier, findings
  for (const a of q('SELECT * FROM audits')) {
    const id = `aud:${a.id}`;
    addNode(id, 'Audit', a.code, a.title, `/audits/${a.id}`);
    if (a.supplier_id) link(`sup:${a.supplier_id}`, id, 'audited');
    for (const it of q('SELECT * FROM audit_items WHERE audit_id = ? AND finding_type != \'ok\'', a.id)) {
      const iid = `ai:${it.id}`;
      addNode(iid, 'Finding', null, `${it.clause || ''} ${it.finding_type}: ${(it.description || '').slice(0, 50)}`);
      link(id, iid, 'finding');
    }
  }
  // Equipment → qualifications & owner
  for (const e of q('SELECT * FROM equipment')) {
    const id = `eq:${e.id}`;
    addNode(id, 'Equipment', e.code, e.name, `/equipment/${e.id}`);
    if (e.owner_id) { const o = addNode(`usr:${e.owner_id}`, 'Person', null, userNameOf(e.owner_id)); link(id, o.id, 'owned by'); }
    for (const x of q('SELECT * FROM equipment_qualifications WHERE equipment_id = ?', e.id)) {
      const xid = `eqq:${x.id}`;
      addNode(xid, 'Qualification', null, `${x.type} ${x.status}`);
      link(id, xid, 'qualified by');
    }
  }
  // Design reviews → requirements & findings
  for (const dr of q('SELECT * FROM design_reviews')) {
    const id = `dr:${dr.id}`;
    addNode(id, 'Design review', dr.code, dr.title, `/design/${dr.id}`);
    for (const x of q('SELECT * FROM design_requirements WHERE review_id = ?', dr.id)) {
      const xid = `dreq:${x.id}`;
      addNode(xid, 'Requirement', null, (x.requirement || '').slice(0, 60));
      link(id, xid, 'requires');
    }
  }
  // Training → participants → employees
  for (const t of q('SELECT * FROM trainings')) {
    const id = `trn:${t.id}`;
    addNode(id, 'Training', t.code, t.title, `/trainings/${t.id}`);
    for (const tp of q('SELECT * FROM training_participants WHERE training_id = ?', t.id)) {
      const eid = `emp:${tp.employee_id}`;
      const e = q1('SELECT * FROM employees WHERE id = ?', tp.employee_id);
      if (e) addNode(eid, 'Employee', e.code, e.name, `/employees/${e.id}`);
      link(id, eid, 'attended by');
    }
  }
  // Assessments → employee + competency
  for (const a of q('SELECT * FROM assessments')) {
    const id = `asm:${a.id}`;
    const c = q1('SELECT * FROM competencies WHERE id = ?', a.competency_id);
    addNode(id, 'Assessment', a.code, c ? `${c.name} · level ${a.level}` : `level ${a.level}`, `/competencies/${a.competency_id}`);
    const eid = `emp:${a.employee_id}`;
    const e = q1('SELECT * FROM employees WHERE id = ?', a.employee_id);
    if (e) addNode(eid, 'Employee', e.code, e.name, `/employees/${e.id}`);
    link(eid, id, 'assessed');
    const cid = `cmp:${a.competency_id}`;
    if (c) { addNode(cid, 'Competency', c.code, c.name, `/competencies/${c.id}`); link(cid, id, 'assessed by'); }
  }
  // Management reviews → chair
  for (const mr of q('SELECT * FROM management_reviews ORDER BY review_date DESC LIMIT 4')) {
    const id = `mr:${mr.id}`;
    addNode(id, 'Mgmt review', mr.code, mr.title, `/mgmt-reviews/${mr.id}`);
    if (mr.chair_id) { const o = addNode(`usr:${mr.chair_id}`, 'Person', null, userNameOf(mr.chair_id)); link(o.id, id, 'chairs'); }
  }

  // Manual user-made links (universal connector)
  try {
    for (const l of q('SELECT * FROM links')) {
      const a = resolveAny(l.from_type, l.from_id);
      const b = resolveAny(l.to_type, l.to_id);
      if (!a || !b) continue;
      const routeA = routeForKey(l.from_type), routeB = routeForKey(l.to_type);
      const aid = `ml:${l.from_type}:${l.from_id}`;
      const bid = `ml:${l.to_type}:${l.to_id}`;
      addNode(aid, typeTitle(l.from_type), a.code, a.title, routeA ? `/${routeA}/${a.id}` : null);
      addNode(bid, typeTitle(l.to_type), b.code, b.title, routeB ? `/${routeB}/${b.id}` : null);
      link(aid, bid, l.rel || 'linked');
    }
  } catch {}

  // Manual user-made links (universal connections)
  for (const l of q('SELECT * FROM links')) {
    const a = resolveGeneric(l.from_type, l.from_id);
    const b = resolveGeneric(l.to_type, l.to_id);
    if (!a || !b) continue;
    const aid = `${a.key}:${a.id}`, bid = `${b.key}:${b.id}`;
    addNode(aid, a.typeLabel, a.code, a.title, a.link);
    addNode(bid, b.typeLabel, b.code, b.title, b.link);
    link(aid, bid, l.rel || 'linked');
  }

  // Trim to a readable size: keep nodes with the most connections first
  const degree = new Map();
  for (const e of edges) { degree.set(e.from, (degree.get(e.from) || 0) + 1); degree.set(e.to, (degree.get(e.to) || 0) + 1); }
  let finalNodes = nodes;
  if (nodes.length > 160) {
    const sorted = [...nodes].sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0));
    const keep = new Set(sorted.slice(0, 160).map(n => n.id));
    finalNodes = nodes.filter(n => keep.has(n.id));
  }
  const ids = new Set(finalNodes.map(n => n.id));
  const finalEdges = edges.filter(e => ids.has(e.from) && ids.has(e.to));
  return { nodes: finalNodes, edges: finalEdges, generatedAt: new Date().toISOString() };
}

function typeTitle(key) {
  const m = MODULES[normKey(key)];
  return m ? m.title.replace(/s$/, '').replace('NC & Incidents', 'NC') : key;
}
function normKey(key) { return (key || '').includes('-') ? key.replace(/-/g, '_') : key; }
function routeForKey(key) {
  return ({ policies: 'policies', goals: 'goals', risks: 'risks', suppliers: 'suppliers', employees: 'employees', competencies: 'competencies', trainings: 'trainings', records: 'records', documents: 'documents', design: 'design', equipment: 'equipment', nonconformances: 'nonconformances', audits: 'audits', compliance: 'compliance', mgmt_reviews: 'mgmt-reviews', actions: 'actions' })[normKey(key)] || null;
}
function resolveAny(key, id) {
  const m = MODULES[normKey(key)];
  if (!m) return null;
  const row = q1(`SELECT * FROM ${m.table} WHERE id = ?`, Number(id));
  if (!row) return null;
  return { id: row.id, code: row.code, title: row.title || row.name || row.code, status: row.status };
}

function userNameOf(id) {
  return (q1('SELECT name FROM users WHERE id = ?', id) || {}).name || `User ${id}`;
}

// Generic record resolver used by the network builder (works for every module)
function resolveGeneric(typeKey, id) {
  const key = normKey(typeKey);
  const m = MODULES[key];
  if (!m) return null;
  const row = q1(`SELECT * FROM ${m.table} WHERE id = ?`, Number(id));
  if (!row) return null;
  const route = routeForKey(key);
  return {
    key, id: row.id, code: row.code || null,
    title: row.title || row.name || row.code || m.title,
    typeLabel: m.title.replace(/s$/, ''),
    link: route ? `/${route}/${row.id}` : null,
    status: row.status
  };
}

module.exports = { collect, analyze, ask, insights, graph, managementReviewDraft, llmPhrase, entityMentions, buildNetwork };
