// Unified calendar/deadlines across all modules.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { daysUntil } = require('../utils');

const r = express.Router();
r.use(authRequired);

r.get('/', (req, res) => {
  const from = req.query.from || new Date().toISOString().slice(0, 10);
  const to = req.query.to || new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
  const inRange = d => d && d >= from && d <= to;
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const items = [];
  const push = (date, type, label, link, extra) => { if (inRange(date)) items.push({ date, type, label, link, days: daysUntil(date), ...extra }); };

  for (const a of all(`SELECT * FROM actions WHERE due_date IS NOT NULL`)) push(a.due_date, 'Action due', `${a.code} ${a.title}`, `/actions?focus=${a.id}`, { status: a.status, meta: a.priority + ' priority' });
  for (const d of all(`SELECT * FROM documents WHERE review_date IS NOT NULL`)) push(d.review_date, 'Document review', `${d.code} ${d.title}`, `/documents/${d.id}`, { status: d.status });
  for (const p of all(`SELECT * FROM policies WHERE review_date IS NOT NULL`)) push(p.review_date, 'Policy review', `${p.code} ${p.title}`, `/policies/${p.id}`, { status: p.status });
  for (const x of all(`SELECT * FROM risks WHERE review_date IS NOT NULL`)) push(x.review_date, 'Risk review', `${x.code} ${x.title}`, `/risks/${x.id}`, { status: x.status });
  for (const x of all(`SELECT * FROM compliance_requirements WHERE next_review IS NOT NULL`)) push(x.next_review, 'Compliance review', `${x.code} ${x.title}`, `/compliance/${x.id}`, { status: x.status });
  for (const g of all(`SELECT * FROM goals WHERE review_date IS NOT NULL`)) push(g.review_date, 'KPI review', `${g.code} ${g.title}`, `/goals/${g.id}`, { status: g.status });
  for (const e of all(`SELECT * FROM equipment WHERE next_calibration IS NOT NULL`)) push(e.next_calibration, 'Calibration', `${e.code} ${e.name}`, `/equipment/${e.id}`, { status: e.status });
  for (const e of all(`SELECT * FROM equipment WHERE next_maintenance IS NOT NULL`)) push(e.next_maintenance, 'Maintenance', `${e.code} ${e.name}`, `/equipment/${e.id}`, { status: e.status });
  for (const a of all(`SELECT * FROM audits WHERE planned_date IS NOT NULL`)) push(a.planned_date, 'Audit', `${a.code} ${a.title}`, `/audits/${a.id}`, { status: a.status });
  for (const t of all(`SELECT * FROM trainings WHERE scheduled_date IS NOT NULL`)) push(t.scheduled_date, 'Training', `${t.code} ${t.title}`, `/trainings/${t.id}`, { status: t.status });
  for (const a of all(`SELECT a.code, a.expiry_date, e.name employee, c.name competency, c.id cid FROM assessments a JOIN employees e ON e.id = a.employee_id JOIN competencies c ON c.id = a.competency_id WHERE a.expiry_date IS NOT NULL`)) push(a.expiry_date, 'Certification expiry', `${a.employee} · ${a.competency}`, `/competencies/${a.cid}`, { status: 'expiry' });
  for (const s of all(`SELECT * FROM suppliers WHERE next_audit IS NOT NULL`)) push(s.next_audit, 'Supplier audit', `${s.code} ${s.name}`, `/suppliers/${s.id}`, { status: s.status });
  for (const m of all(`SELECT * FROM management_reviews WHERE review_date IS NOT NULL`)) push(m.review_date, 'Management review', `${m.code} ${m.title}`, `/mgmt-reviews/${m.id}`, { status: m.status });
  for (const d of all(`SELECT * FROM design_reviews WHERE review_date IS NOT NULL`)) push(d.review_date, 'Design review', `${d.code} ${d.title}`, `/design/${d.id}`, { status: d.status });
  for (const n of all(`SELECT * FROM nonconformances WHERE status = 'verification'`)) push(n.occurred_at ? undefined : undefined, 'NC verification', `${n.code} ${n.title}`, `/nonconformances/${n.id}`, { status: n.status });

  items.sort((a, b) => a.date.localeCompare(b.date));
  res.json({ from, to, items });
});

module.exports = r;
