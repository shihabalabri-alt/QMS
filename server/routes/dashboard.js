// Intelligent dashboard: metrics + AI attention list + insights (role-scoped).
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const ai = require('../ai/brain');
const { today, daysUntil } = require('../utils');

const r = express.Router();
r.use(authRequired);

r.get('/', (req, res) => {
  const T = today();
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const all = (sql, ...a) => db.prepare(sql).all(...a);

  const counts = {
    risksHigh: one(`SELECT COUNT(*) c FROM risks WHERE (residual_likelihood * residual_severity) >= 15 AND status != 'closed'`).c,
    risksTotal: one(`SELECT COUNT(*) c FROM risks WHERE status != 'closed'`).c,
    overdueActions: one(`SELECT COUNT(*) c FROM actions WHERE due_date < ? AND status IN ('open','in_progress')`, T).c,
    myActions: one(`SELECT COUNT(*) c FROM actions WHERE owner_id = ? AND status IN ('open','in_progress')`, req.user.id).c,
    myOverdueActions: one(`SELECT COUNT(*) c FROM actions WHERE owner_id = ? AND due_date < ? AND status IN ('open','in_progress')`, req.user.id, T).c,
    openIncidents: one(`SELECT COUNT(*) c FROM nonconformances WHERE type = 'incident' AND status != 'closed'`).c,
    openNCs: one(`SELECT COUNT(*) c FROM nonconformances WHERE type = 'nc' AND status != 'closed'`).c,
    openCAPA: one(`SELECT COUNT(*) c FROM nonconformances WHERE type = 'capa' AND status != 'closed'`).c,
    ncOverdue30: one(`SELECT COUNT(*) c FROM nonconformances WHERE status != 'closed' AND occurred_at < date('now','-30 day')`).c,
    supplierIssues: one(`SELECT COUNT(*) c FROM supplier_incidents WHERE status != 'closed'`).c,
    conditionalSuppliers: one(`SELECT COUNT(*) c FROM suppliers WHERE status = 'conditional'`).c,
    decliningSuppliers: one(`SELECT COUNT(DISTINCT supplier_id) c FROM supplier_evaluations WHERE total_score < 75`).c,
    expiringQuals: one(`SELECT COUNT(*) c FROM assessments WHERE expiry_date IS NOT NULL AND expiry_date <= date('now','+30 day')`).c,
    expiredQuals: one(`SELECT COUNT(*) c FROM assessments WHERE expiry_date IS NOT NULL AND expiry_date < ?`, T).c,
    docsForReview: one(`SELECT COUNT(*) c FROM documents WHERE status = 'approved' AND review_date <= date('now','+30 day')`).c,
    docsOverdue: one(`SELECT COUNT(*) c FROM documents WHERE status = 'approved' AND review_date < ?`, T).c,
    policiesForReview: one(`SELECT COUNT(*) c FROM policies WHERE status = 'approved' AND review_date <= date('now','+30 day')`).c,
    calibDue: one(`SELECT COUNT(*) c FROM equipment WHERE requires_calibration = 1 AND next_calibration <= date('now','+30 day')`).c,
    calibOverdue: one(`SELECT COUNT(*) c FROM equipment WHERE requires_calibration = 1 AND next_calibration < ?`, T).c,
    complianceGaps: one(`SELECT COUNT(*) c FROM compliance_requirements WHERE status IN ('non_compliant','partially')`).c,
    openAuditFindings: one(`SELECT COUNT(*) c FROM audit_items WHERE status != 'closed'`).c,
    upcomingAudits: one(`SELECT COUNT(*) c FROM audits WHERE status != 'closed' AND planned_date <= date('now','+30 day')`).c
  };

  // KPI performance with series
  const kpis = all(`SELECT g.id, g.code, g.title, g.target_value, g.target_unit, g.direction, g.frequency FROM goals g WHERE g.type IN ('kpi','objective') AND g.status = 'active' ORDER BY g.code`).map(g => {
    const entries = all('SELECT period, value FROM goal_entries WHERE goal_id = ? ORDER BY period', g.id);
    const last = entries[entries.length - 1] || {};
    const onTarget = last.value !== undefined ? (g.direction === 'higher' ? last.value >= g.target_value : last.value <= g.target_value) : null;
    const vals = entries.map(e => e.value);
    let trend = 'flat';
    if (vals.length >= 3) {
      const n = vals.length, half = Math.floor(n / 2);
      const a1 = vals.slice(0, half).reduce((x, y) => x + y, 0) / half;
      const a2 = vals.slice(half).reduce((x, y) => x + y, 0) / (n - half);
      const spread = Math.max(...vals) - Math.min(...vals) || 1;
      const rel = (a2 - a1) / spread;
      trend = rel > 0.05 ? 'up' : rel < -0.05 ? 'down' : 'flat';
    }
    const goodTrend = g.direction === 'higher' ? trend === 'up' : trend === 'down';
    return { id: g.id, code: g.code, title: g.title, target: g.target_value, unit: g.target_unit, direction: g.direction, last: last.value, period: last.period, onTarget, trend, goodTrend, series: vals.slice(-12) };
  });

  // Risk matrix distribution
  const riskMatrix = all(`SELECT residual_likelihood l, residual_severity s, COUNT(*) c FROM risks WHERE status != 'closed' GROUP BY l, s`);

  // NC by month (last 8 months)
  const ncByMonth = [];
  for (let i = 7; i >= 0; i--) {
    const m = new Date(); m.setUTCMonth(m.getUTCMonth() - i);
    const key = m.toISOString().slice(0, 7);
    ncByMonth.push({ month: key, count: one(`SELECT COUNT(*) c FROM nonconformances WHERE substr(occurred_at,1,7) = ?`, key).c });
  }

  // Upcoming reviews/deadlines (next 14 days)
  const upcoming = [];
  const push = (date, type, label, link, status) => { if (date && daysUntil(date) >= -2 && daysUntil(date) <= 14) upcoming.push({ date, type, label, link, status, days: daysUntil(date) }); };
  for (const a of all(`SELECT code, title, due_date, status, id FROM actions WHERE status IN ('open','in_progress') AND due_date IS NOT NULL ORDER BY due_date LIMIT 50`)) push(a.due_date, 'Action', `${a.code} ${a.title}`, `/actions?focus=${a.id}`, a.status);
  for (const d of all(`SELECT id, code, title, review_date FROM documents WHERE status = 'approved' AND review_date IS NOT NULL`)) push(d.review_date, 'Document review', `${d.code} ${d.title}`, `/documents/${d.id}`);
  for (const a of all(`SELECT id, code, title, planned_date FROM audits WHERE status != 'closed' AND planned_date IS NOT NULL`)) push(a.planned_date, 'Audit', `${a.code} ${a.title}`, `/audits/${a.id}`);
  for (const t of all(`SELECT id, code, title, scheduled_date FROM trainings WHERE status = 'scheduled' AND scheduled_date IS NOT NULL`)) push(t.scheduled_date, 'Training', `${t.code} ${t.title}`, `/trainings/${t.id}`);
  for (const e of all(`SELECT id, code, name, next_calibration FROM equipment WHERE next_calibration IS NOT NULL`)) push(e.next_calibration, 'Calibration', `${e.code} ${e.name}`, `/equipment/${e.id}`);
  for (const m of all(`SELECT id, code, title, review_date FROM management_reviews WHERE status != 'issued' AND review_date IS NOT NULL`)) push(m.review_date, 'Mgmt review', `${m.code} ${m.title}`, `/mgmt-reviews/${m.id}`);
  for (const d of all(`SELECT id, code, title, review_date FROM design_reviews WHERE status = 'planned' AND review_date IS NOT NULL`)) push(d.review_date, 'Design review', `${d.code} ${d.title}`, `/design/${d.id}`);
  for (const s of all(`SELECT id, code, name, next_audit FROM suppliers WHERE next_audit IS NOT NULL`)) push(s.next_audit, 'Supplier audit', `${s.code} ${s.name}`, `/suppliers/${s.id}`);
  upcoming.sort((a, b) => a.date.localeCompare(b.date));

  // AI layer (role-scoped)
  const c = ai.collect(req.user);
  const A = ai.analyze(c, req.user);
  const attention = A.attention.map(x => ({ ...x }));
  const insights = ai.insights(req.user);
  const recentActivity = all(`SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.action != 'login' ORDER BY a.id DESC LIMIT 12`);

  res.json({ counts, kpis, riskMatrix, ncByMonth, upcoming: upcoming.slice(0, 20), attention, insights, recentActivity });
});

module.exports = r;
