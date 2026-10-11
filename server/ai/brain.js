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
const doer = require('./do');
const maker = require('./make');

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

function typeLabel(moduleKey) {
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
  return { intent, role: user.role, scope: 'authorized live database', generatedAt: new Date().toISOString(), facts: [], findings: [], recommendations: [], citations: [], evidence: [] };
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

const INTENTS = [
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

function ask(question, user) {
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
  // Site-guide questions: built-in knowledge, no database trip.
  const guided = guide.answerSiteGuide(question, user);
  if (guided) return { ...guided, question };
  const c = collect(user);
  const A = analyze(c, user);
  const mentions = entityMentions(question);

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
