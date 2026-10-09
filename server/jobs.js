// Automation & workflow scheduler.
// overdue action -> reminder -> escalation -> manager notification
// plus expiry sweeps (certifications, calibrations, reviews) with deduplication.
const db = require('./db');
const config = require('./config');
const { audit, notify } = require('./middleware/audit');
const { today, nowIso, daysUntil } = require('./utils');

const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);

function roleUsers(roles) {
  return all(`SELECT id FROM users WHERE role IN (${roles.map(() => '?').join(',')}) AND active = 1`, ...roles);
}

// meta: { category, priority, recordType, recordCode, recordId, dedupeKey }
function remind(userId, title, body, link, severity, meta = {}) {
  if (!userId) return;
  notify(userId, title, body, link, severity, meta.category || 'general', meta.dedupeKey || null, meta.recordType, meta.recordCode, meta.recordId);
}

function sweepActions() {
  const escalateDays = Number((one(`SELECT value FROM settings WHERE key = 'escalate_days'`) || {}).value || 7);
  let reminders = 0, escalations = 0;
  for (const a of all(`SELECT * FROM actions WHERE status IN ('open','in_progress') AND due_date IS NOT NULL`)) {
    const d = daysUntil(a.due_date);
    const meta = { category: 'actions', recordType: 'actions', recordCode: a.code, recordId: String(a.id), priority: a.priority === 'low' ? 'low' : a.priority === 'medium' ? 'medium' : a.priority };
    if (d < 0) {
      remind(a.owner_id, `Action overdue: ${a.code}`, `"${a.title}" was due ${a.due_date}. Status: ${a.status}. Please complete or re-plan.`, `/actions?focus=${a.id}`, 'warning', { ...meta, dedupeKey: `action-overdue:${a.code}:${a.due_date}` });
      reminders++;
      if (d <= -escalateDays) {
        for (const u of roleUsers(['quality_manager', 'management', 'manager'])) {
          remind(u.id, `ESCALATION: ${a.code} overdue ${Math.abs(d)} days`, `"${a.title}" (owner: ${(one('SELECT name FROM users WHERE id = ?', a.owner_id) || {}).name || 'unassigned'}) is ${Math.abs(d)} days overdue.`, `/actions?focus=${a.id}`, 'critical', { ...meta, priority: 'critical', dedupeKey: `action-escalated:${a.code}:${a.due_date}` });
        }
        escalations++;
      }
    } else if (d <= 3) {
      remind(a.owner_id, `Action due soon: ${a.code}`, `"${a.title}" is due ${a.due_date} (${d} day(s)). Status: ${a.status}.`, `/actions?focus=${a.id}`, 'info', { ...meta, dedupeKey: `action-due-soon:${a.code}:${a.due_date}` });
      reminders++;
    }
  }
  // Management-review actions still open
  for (const a of all(`SELECT * FROM actions WHERE source_type = 'review' AND status IN ('open','in_progress')`)) {
    remind(a.owner_id, `Management review action open: ${a.code}`, `"${a.title}" from a management review is still ${a.status.replace(/_/g, ' ')}. Due ${a.due_date || 'n/a'}.`, `/actions?focus=${a.id}`, 'warning', { category: 'reviews', recordType: 'actions', recordCode: a.code, recordId: String(a.id), dedupeKey: `mr-action-open:${a.code}` });
  }
  return { reminders, escalations };
}

function sweepExpiries() {
  const alertDays = Number((one(`SELECT value FROM settings WHERE key = 'alert_days'`) || {}).value || 30);
  let n = 0;
  // Certification expiries -> employee (if linked), competency managers
  for (const a of all(`SELECT a.code, a.expiry_date, e.name AS employee, e.user_id, c.name AS competency, c.id AS cid FROM assessments a JOIN employees e ON e.id = a.employee_id JOIN competencies c ON c.id = a.competency_id WHERE a.expiry_date IS NOT NULL AND a.expiry_date <= date('now', ?)`, `+${alertDays} day`)) {
    const d = daysUntil(a.expiry_date);
    const title = `Certification ${d < 0 ? 'expired' : 'expiring'}: ${a.competency}`;
    remind(a.user_id, title, `${a.employee} — ${a.competency} ${d < 0 ? 'expired' : 'expires'} ${a.expiry_date}.`, `/competencies/${a.cid}`, d < 0 ? 'critical' : 'warning', { category: 'competency', dedupeKey: `cert:${a.code}`, recordType: 'competencies', recordCode: a.competency, recordId: a.cid });
    for (const u of roleUsers(['competency_manager', 'quality_manager'])) remind(u.id, title, `${a.employee} — ${a.competency} ${d < 0 ? 'expired' : 'expires'} ${a.expiry_date}.`, `/competencies/${a.cid}`, 'warning', { category: 'competency', dedupeKey: `cert:${a.code}:${u.id}`, recordType: 'competencies', recordCode: a.competency, recordId: a.cid });
    n++;
  }
  // Calibration & maintenance -> equipment owners + equipment managers
  for (const e of all(`SELECT * FROM equipment WHERE (next_calibration IS NOT NULL AND next_calibration <= date('now', ?)) OR (next_maintenance IS NOT NULL AND next_maintenance <= date('now','+14 day'))`, `+${alertDays} day`)) {
    if (e.next_calibration && daysUntil(e.next_calibration) <= alertDays) {
      const title = `Calibration due: ${e.code}`;
      remind(e.owner_id, title, `${e.name} calibration due ${e.next_calibration}.`, `/equipment/${e.id}`, daysUntil(e.next_calibration) < 0 ? 'critical' : 'warning', { category: 'equipment', dedupeKey: `calib:${e.code}`, recordType: 'equipment', recordCode: e.code, recordId: e.id });
      for (const u of roleUsers(['equipment_manager'])) remind(u.id, title, `${e.name} — due ${e.next_calibration}.`, `/equipment/${e.id}`, 'warning', { category: 'equipment', dedupeKey: `calib:${e.code}:${u.id}`, recordType: 'equipment', recordCode: e.code, recordId: e.id });
      n++;
    }
    if (e.next_maintenance && daysUntil(e.next_maintenance) <= 14) {
      remind(e.owner_id, `Maintenance due: ${e.code}`, `${e.name} preventive maintenance due ${e.next_maintenance}.`, `/equipment/${e.id}`, 'info', { category: 'equipment', dedupeKey: `maint:${e.code}:${e.next_maintenance}`, recordType: 'equipment', recordCode: e.code, recordId: e.id });
      n++;
    }
  }
  // Document / policy / risk / compliance reviews
  for (const d of all(`SELECT * FROM documents WHERE status = 'approved' AND review_date IS NOT NULL AND review_date <= date('now', ?)`, `+${alertDays} day`)) {
    const title = `Document review ${daysUntil(d.review_date) < 0 ? 'overdue' : 'due'}: ${d.code}`;
    remind(d.owner_id, title, `${d.title} review due ${d.review_date}.`, `/documents/${d.id}`, 'warning', { category: 'documents', dedupeKey: `doc-review:${d.code}`, recordType: 'documents', recordCode: d.code, recordId: d.id });
    for (const u of roleUsers(['doc_controller'])) remind(u.id, title, `${d.title} — ${d.review_date}.`, `/documents/${d.id}`, 'warning', { category: 'documents', dedupeKey: `doc-review:${d.code}:${u.id}`, recordType: 'documents', recordCode: d.code, recordId: d.id });
    n++;
  }
  // Documents awaiting approval (in_review > 3 days)
  for (const d of all(`SELECT * FROM documents WHERE status = 'in_review' AND created_at <= datetime('now','-3 day')`)) {
    for (const u of roleUsers(['doc_controller', 'quality_manager'])) {
      remind(u.id, `Document awaiting approval: ${d.code}`, `"${d.title}" v${d.version} has been in review since ${String(d.created_at).slice(0, 10)}.`, `/documents/${d.id}`, 'warning', { category: 'documents', dedupeKey: `doc-approval:${d.code}:${u.id}`, recordType: 'documents', recordCode: d.code, recordId: d.id });
    }
    n++;
  }
  for (const p of all(`SELECT * FROM policies WHERE status = 'approved' AND review_date IS NOT NULL AND review_date <= date('now', ?)`, `+${alertDays} day`)) {
    remind(p.owner_id, `Policy review due: ${p.code}`, `${p.title} review due ${p.review_date}.`, `/policies/${p.id}`, 'warning', { category: 'documents', dedupeKey: `pol-review:${p.code}`, recordType: 'policies', recordCode: p.code, recordId: p.id });
    n++;
  }
  // High / critical residual risks
  for (const x of all(`SELECT * FROM risks WHERE status != 'closed' AND (residual_likelihood * residual_severity) >= 15`)) {
    const score = x.residual_likelihood * x.residual_severity;
    const prio = score >= 20 ? 'critical' : 'high';
    remind(x.owner_id, `High residual risk: ${x.code}`, `"${x.title}" — residual risk ${score}. Treatment: ${x.treatment}.`, `/risks/${x.id}`, prio, { category: 'risks', dedupeKey: `risk-high:${x.code}`, recordType: 'risks', recordCode: x.code, recordId: x.id });
    for (const u of roleUsers(['risk_manager', 'quality_manager'])) remind(u.id, `High residual risk: ${x.code}`, `"${x.title}" — residual ${score}.`, `/risks/${x.id}`, prio, { category: 'risks', dedupeKey: `risk-high:${x.code}:${u.id}`, recordType: 'risks', recordCode: x.code, recordId: x.id });
    n++;
  }
  for (const x of all(`SELECT * FROM risks WHERE status != 'closed' AND review_date IS NOT NULL AND review_date <= date('now', ?)`, `+${alertDays} day`)) {
    const title = `Risk review ${daysUntil(x.review_date) < 0 ? 'overdue' : 'due'}: ${x.code}`;
    remind(x.owner_id, title, `"${x.title}" review due ${x.review_date}.`, `/risks/${x.id}`, 'warning', { category: 'risks', dedupeKey: `risk-review:${x.code}`, recordType: 'risks', recordCode: x.code, recordId: x.id });
    for (const u of roleUsers(['risk_manager'])) remind(u.id, title, `${x.code} — ${x.review_date}.`, `/risks/${x.id}`, 'warning', { category: 'risks', dedupeKey: `risk-review:${x.code}:${u.id}`, recordType: 'risks', recordCode: x.code, recordId: x.id });
    n++;
  }
  for (const c of all(`SELECT * FROM compliance_requirements WHERE next_review IS NOT NULL AND next_review <= date('now', ?)`, `+${alertDays} day`)) {
    const title = `Compliance review ${daysUntil(c.next_review) < 0 ? 'overdue' : 'due'}: ${c.code}`;
    remind(c.owner_id, title, `${c.framework} ${c.clause} — ${c.title}.`, `/compliance/${c.id}`, 'warning', { category: 'compliance', dedupeKey: `comp-review:${c.code}`, recordType: 'compliance', recordCode: c.code, recordId: c.id });
    for (const u of roleUsers(['compliance_manager'])) remind(u.id, title, `${c.framework} ${c.clause} — ${c.next_review}.`, `/compliance/${c.id}`, 'warning', { category: 'compliance', dedupeKey: `comp-review:${c.code}:${u.id}`, recordType: 'compliance', recordCode: c.code, recordId: c.id });
    n++;
  }
  // Supplier audits upcoming
  for (const s of all(`SELECT * FROM suppliers WHERE next_audit IS NOT NULL AND next_audit <= date('now','+45 day')`)) {
    for (const u of roleUsers(['supplier_manager', 'quality_manager'])) remind(u.id, `Supplier audit upcoming: ${s.code}`, `${s.name} audit planned ${s.next_audit}.`, `/suppliers/${s.id}`, 'info', { category: 'suppliers', dedupeKey: `sup-audit:${s.code}:${u.id}`, recordType: 'suppliers', recordCode: s.code, recordId: s.id });
    n++;
  }
  // Suppliers requiring evaluation (approved but no eval in last 6 months)
  for (const s of all(`SELECT s.* FROM suppliers s WHERE s.status = 'approved' AND NOT EXISTS (SELECT 1 FROM supplier_evaluations se WHERE se.supplier_id = s.id AND se.period >= substr(date('now','-6 month'),1,7))`)) {
    for (const u of roleUsers(['supplier_manager', 'quality_manager'])) remind(u.id, `Supplier evaluation due: ${s.code}`, `${s.name} has no recent performance evaluation.`, `/suppliers/${s.id}`, 'warning', { category: 'suppliers', dedupeKey: `sup-eval:${s.code}:${u.id}`, recordType: 'suppliers', recordCode: s.code, recordId: s.id });
    n++;
  }
  // Open NC aging > 30 days
  for (const x of all(`SELECT * FROM nonconformances WHERE status != 'closed' AND occurred_at < date('now','-30 day')`)) {
    remind(x.owner_id, `Investigation aging: ${x.code}`, `"${x.title}" has been open more than 30 days.`, `/nonconformances/${x.id}`, 'warning', { category: 'nc', dedupeKey: `nc-aging:${x.code}`, recordType: 'nonconformances', recordCode: x.code, recordId: x.id });
    n++;
  }
  // Management reviews approaching (not yet issued)
  for (const m of all(`SELECT * FROM management_reviews WHERE status != 'issued' AND review_date IS NOT NULL AND review_date <= date('now','+14 day')`)) {
    const overdue = daysUntil(m.review_date) < 0;
    if (m.chair_id) remind(m.chair_id, `Management review ${overdue ? 'overdue' : 'upcoming'}: ${m.code}`, `"${m.title}" is scheduled for ${m.review_date}.`, `/mgmt-reviews/${m.id}`, overdue ? 'warning' : 'info', { category: 'reviews', dedupeKey: `mr-due:${m.code}:${m.chair_id}`, recordType: 'management_reviews', recordCode: m.code, recordId: m.id });
    for (const u of roleUsers(['quality_manager', 'management'])) remind(u.id, `Management review ${overdue ? 'overdue' : 'upcoming'}: ${m.code}`, `${m.title} — ${m.review_date}.`, `/mgmt-reviews/${m.id}`, overdue ? 'warning' : 'info', { category: 'reviews', dedupeKey: `mr-due:${m.code}:${u.id}`, recordType: 'management_reviews', recordCode: m.code, recordId: m.id });
    n++;
  }
  // Trainings starting within 7 days -> participants with linked users
  for (const t of all(`SELECT * FROM trainings WHERE status = 'scheduled' AND scheduled_date BETWEEN date('now') AND date('now','+7 day')`)) {
    for (const tp of all(`SELECT tp.employee_id, e.user_id, e.name FROM training_participants tp JOIN employees e ON e.id = tp.employee_id WHERE tp.training_id = ? AND tp.status = 'invited'`, t.id)) {
      if (!tp.user_id) continue;
      remind(tp.user_id, `Training upcoming: ${t.code}`, `${t.title} on ${t.scheduled_date} — you are registered.`, `/trainings/${t.id}`, 'info', { category: 'competency', dedupeKey: `training-due:${t.code}:${tp.employee_id}`, recordType: 'trainings', recordCode: t.code, recordId: t.id });
      n++;
    }
  }
  return { expiries: n };
}

function runJobs(trigger) {
  const started = Date.now();
  const a = sweepActions();
  const e = sweepExpiries();
  // Daily encrypted database backup
  let b = { skipped: true };
  try {
    const td = new Date().toISOString().slice(0, 10);
    const last = (one(`SELECT value FROM settings WHERE key = 'last_backup_date'`) || {}).value;
    if (last !== td) {
      b = require('./backup').createBackup();
      db.prepare(`INSERT INTO settings (key, value) VALUES ('last_backup_date', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(td);
      b = { backup: b.file };
    }
  } catch (err) { b = { backupError: err.message }; }

  db.prepare(`INSERT INTO settings (key, value) VALUES ('last_job_run', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(`${nowIso()} (${trigger})`);
  audit({ user: null, ip: 'system' }, 'job_run', 'system', null, 'Automation sweep', { ...a, ...e, ...b, ms: Date.now() - started, trigger });
  return { ...a, ...e, ...b, ms: Date.now() - started };
}

function start() {
  const ms = Math.max(1, config.jobIntervalMinutes) * 60000;
  setTimeout(() => {
    try { runJobs('startup'); } catch (e) { console.error('job error', e.message); }
    setInterval(() => { try { runJobs('interval'); } catch (e) { console.error('job error', e.message); } }, ms);
  }, 8000);
  console.log(`Scheduler armed: every ${config.jobIntervalMinutes} min (smart notifications active)`);
}

module.exports = { runJobs, start };

function sweepReviewActions() {
  let n = 0;
  for (const a of all(`SELECT * FROM actions WHERE source_type = 'review' AND status IN ('open','in_progress')`)) {
    remind(a.owner_id, `Management review action open: ${a.code}`, `"${a.title}" from a management review is still ${a.status}. Due ${a.due_date || 'n/a'}.`, `/actions?focus=${a.id}`, 'warning', { category: 'reviews', recordType: 'actions', recordCode: a.code, recordId: String(a.id), dedupeKey: `mr-action:${a.code}` });
    n++;
  }
  return { mrActions: n };
}
