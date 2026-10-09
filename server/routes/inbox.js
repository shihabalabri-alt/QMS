// Universal QMS Inbox — central workspace for everything requiring the logged-in user's attention.
// Derived live from the database (no stored duplicates), respects role-based permissions.
const express = require('express');
const db = require('../db');
const { MODULES } = require('../modules');
const { authRequired } = require('../middleware/auth');
const { daysUntil, today } = require('../utils');

const r = express.Router();
r.use(authRequired);

const T = () => today();

function ownerName(id) {
  if (!id) return null;
  try { return (db.prepare('SELECT name FROM users WHERE id = ?').get(id) || {}).name || null; } catch { return null; }
}

function canRead(user, key) {
  const m = MODULES[key];
  if (!m) return false;
  if (m.perms.read === 'all') return true;
  return Array.isArray(m.perms.read) && m.perms.read.includes(user.role);
}

function approverRolesFor(moduleKey) {
  const m = MODULES[moduleKey];
  if (!m || !m.approveRole) return [];
  return m.approveRole;
}

function isOverdue(due) {
  if (!due) return false;
  return due < T();
}

function isDueSoon(due) {
  if (!due) return false;
  const d = daysUntil(due);
  return d >= 0 && d <= 7;
}

function isDueToday(due) {
  if (!due) return false;
  return due === T();
}

function isDueThisWeek(due) {
  if (!due) return false;
  const d = daysUntil(due);
  return d >= 0 && d <= 7;
}

function priorityRank(p) {
  const map = { critical: 4, high: 3, medium: 2, low: 1, info: 1 };
  return map[String(p || 'medium').toLowerCase()] || 2;
}

function buildInbox(user) {
  const items = [];
  const seen = new Set();
  const add = (rec) => {
    const key = `${rec.recordType}:${rec.recordId}:${rec.taskType}`;
    if (seen.has(key)) return;
    seen.add(key);
    // enrich overdue/dueToday/dueThisWeek flags for filtering
    rec.overdue = isOverdue(rec.dueDate);
    rec.dueToday = isDueToday(rec.dueDate);
    rec.dueThisWeek = isDueThisWeek(rec.dueDate);
    rec.upcoming = !rec.overdue && rec.dueDate && daysUntil(rec.dueDate) > 7;
    items.push(rec);
  };

  const uid = user.id;
  const role = user.role;

  // Helper to get employee id linked to user
  let employeeId = null;
  try {
    const emp = db.prepare('SELECT id FROM employees WHERE user_id = ?').get(uid);
    if (emp) employeeId = emp.id;
  } catch {}

  // 1. Actions assigned to user — Requires Action / Overdue / Due Soon
  try {
    const actions = db.prepare("SELECT * FROM actions WHERE owner_id = ? AND status IN ('open','in_progress')").all(uid);
    for (const a of actions) {
      add({
        id: `actions:${a.id}:action`,
        recordType: 'actions', recordId: String(a.id), code: a.code, title: a.title,
        moduleLabel: 'Actions', taskType: 'action',
        priority: a.priority || 'medium', status: a.status, dueDate: a.due_date,
        owner: ownerName(a.owner_id), createdAt: a.created_at, completedAt: null,
        link: `/actions?focus=${a.id}`, sourceModule: a.source_type,
        requiredNextStep: a.status === 'open' ? 'Start work and move to In Progress' : 'Complete the action and submit for verification',
        rawStatus: a.status
      });
    }
    // Completed recently (last 14 days) — for Completed section
    const completed = db.prepare("SELECT * FROM actions WHERE owner_id = ? AND status IN ('completed','verified','cancelled') AND (completed_at >= date('now','-14 day') OR datetime(created_at) >= datetime('now','-14 day'))").all(uid);
    for (const a of completed) {
      add({
        id: `actions:${a.id}:completed`,
        recordType: 'actions', recordId: String(a.id), code: a.code, title: a.title,
        moduleLabel: 'Actions', taskType: 'action',
        priority: a.priority || 'medium', status: a.status, dueDate: a.due_date,
        owner: ownerName(a.owner_id), createdAt: a.created_at, completedAt: a.completed_at || a.created_at,
        link: `/actions?focus=${a.id}`,
        requiredNextStep: a.status === 'completed' ? 'Verified — no action needed' : 'Completed',
        isCompleted: true
      });
    }
  } catch {}

  // 2. Approvals waiting for user (role-based)
  const approvalConfigs = [
    { key: 'documents', statuses: ['in_review'], taskType: 'approval', nextStep: 'Review and approve or reject the document' },
    { key: 'policies', statuses: ['in_review'], taskType: 'approval', nextStep: 'Review and approve or reject the policy' },
    { key: 'nonconformances', statuses: ['verification'], taskType: 'approval', nextStep: 'Verify effectiveness and close the NC' },
    { key: 'mgmt_reviews', statuses: ['draft','in_review'], taskType: 'approval', nextStep: 'Review and issue the management review' }
  ];
  for (const cfg of approvalConfigs) {
    const m = MODULES[cfg.key];
    if (!m || !m.approveRole || !m.approveRole.includes(role)) continue;
    if (!canRead(user, cfg.key)) continue;
    try {
      const placeholders = cfg.statuses.map(() => '?').join(',');
      const rows = db.prepare(`SELECT * FROM ${m.table} WHERE status IN (${placeholders})`).all(...cfg.statuses);
      for (const row of rows) {
        // Don't show user's own drafts needing their own approval if they are the owner? Include but mark.
        const code = row.code || `${cfg.key}:${row.id}`;
        const title = row.title || row.name || code;
        const due = row.review_date || row.effective_date || null;
        // Determine priority
        let prio = 'medium';
        if (row.severity === 'critical' || row.priority === 'critical') prio = 'critical';
        else if (row.severity === 'major' || row.priority === 'high') prio = 'high';
        add({
          id: `${cfg.key}:${row.id}:approval`,
          recordType: cfg.key, recordId: String(row.id), code, title,
          moduleLabel: m.title, taskType: 'approval',
          priority: prio, status: row.status, dueDate: due,
          owner: ownerName(row.owner_id || row.chair_id),
          createdAt: row.created_at, link: `/${cfg.key === 'mgmt_reviews' ? 'mgmt-reviews' : cfg.key}/${row.id}`,
          requiredNextStep: cfg.nextStep
        });
      }
    } catch {}
  }

  // 3. Documents requiring review (approved, review_date within 30 days) — for owners/reviewers
  if (canRead(user, 'documents')) {
    try {
      const docs = db.prepare("SELECT * FROM documents WHERE status='approved' AND review_date IS NOT NULL AND review_date <= date('now','+30 day')").all();
      for (const d of docs) {
        // Only show if user is owner or has doc controller/management role
        const relevant = d.owner_id === uid || ['admin','quality_manager','doc_controller','compliance_manager','management'].includes(role);
        if (!relevant) continue;
        const overdue = d.review_date < T();
        add({
          id: `documents:${d.id}:review`,
          recordType: 'documents', recordId: String(d.id), code: d.code, title: d.title,
          moduleLabel: 'Documents', taskType: 'review',
          priority: overdue ? 'high' : 'medium', status: d.status, dueDate: d.review_date,
          owner: ownerName(d.owner_id), createdAt: d.created_at,
          link: `/documents/${d.id}`,
          requiredNextStep: overdue ? 'Review is overdue — review and update the document' : 'Review the document for continued suitability'
        });
      }
      // Controlled doc acknowledgement (approved docs not yet acknowledged by this user)
      const ackDocs = db.prepare(`
        SELECT d.* FROM documents d
        LEFT JOIN doc_acknowledgments da ON da.document_id = d.id AND da.user_id = ?
        WHERE d.status='approved' AND da.id IS NULL
        ORDER BY d.effective_date DESC LIMIT 5
      `).all(uid);
      for (const d of ackDocs) {
        add({
          id: `documents:${d.id}:acknowledge`,
          recordType: 'documents', recordId: String(d.id), code: d.code, title: d.title,
          moduleLabel: 'Documents', taskType: 'review',
          priority: 'medium', status: d.status, dueDate: d.review_date,
          owner: ownerName(d.owner_id), createdAt: d.created_at,
          link: `/documents/${d.id}`,
          requiredNextStep: 'Acknowledge that you have read and understood the document'
        });
      }
    } catch {}
  }

  // 4. Risks owned by user
  if (canRead(user, 'risks')) {
    try {
      const risks = db.prepare("SELECT * FROM risks WHERE owner_id = ? AND status != 'closed'").all(uid);
      for (const r of risks) {
        const score = (r.inherent_likelihood || 0) * (r.inherent_severity || 0);
        const resScore = (r.residual_likelihood || 0) * (r.residual_severity || 0);
        let prio = 'medium';
        if (resScore >= 20 || score >= 20) prio = 'critical';
        else if (resScore >= 15 || score >= 15) prio = 'high';
        add({
          id: `risks:${r.id}:risk`,
          recordType: 'risks', recordId: String(r.id), code: r.code, title: r.title,
          moduleLabel: 'Risks', taskType: 'risk',
          priority: prio, status: r.status, dueDate: r.review_date,
          owner: ownerName(r.owner_id), createdAt: r.created_at,
          link: `/risks/${r.id}`,
          requiredNextStep: r.status === 'open' ? 'Assess risk and define controls' : 'Review and update residual risk'
        });
      }
    } catch {}
  }

  // 5. Non-Conformances requiring input (owner or raised)
  if (canRead(user, 'nonconformances')) {
    try {
      const ncs = db.prepare("SELECT * FROM nonconformances WHERE (owner_id = ? OR raised_by = ?) AND status != 'closed'").all(uid, uid);
      for (const n of ncs) {
        let prio = 'medium';
        if (n.severity === 'critical') prio = 'critical';
        else if (n.severity === 'major') prio = 'high';
        let nextStep = 'Provide input on the NC';
        if (n.status === 'open') nextStep = 'Start investigation — determine immediate containment';
        else if (n.status === 'investigation') nextStep = 'Complete root-cause investigation';
        else if (n.status === 'action_plan') nextStep = 'Define corrective actions';
        else if (n.status === 'verification') nextStep = 'Verify effectiveness';
        add({
          id: `nonconformances:${n.id}:nc`,
          recordType: 'nonconformances', recordId: String(n.id), code: n.code, title: n.title,
          moduleLabel: 'Non-Conformances', taskType: 'nc',
          priority: prio, status: n.status, dueDate: null,
          owner: ownerName(n.owner_id), createdAt: n.created_at,
          link: `/nonconformances/${n.id}`,
          requiredNextStep: nextStep
        });
      }
    } catch {}
  }

  // 6. Audit findings requiring action
  if (canRead(user, 'audits')) {
    try {
      const audits = db.prepare("SELECT * FROM audits WHERE lead_auditor_id = ? AND status != 'closed'").all(uid);
      for (const a of audits) {
        add({
          id: `audits:${a.id}:audit`,
          recordType: 'audits', recordId: String(a.id), code: a.code, title: a.title,
          moduleLabel: 'Audits', taskType: 'audit',
          priority: 'medium', status: a.status, dueDate: a.planned_date,
          owner: ownerName(a.lead_auditor_id), createdAt: a.created_at,
          link: `/audits/${a.id}`,
          requiredNextStep: a.status === 'planned' ? 'Conduct the audit' : 'Complete findings and close the audit'
        });
      }
    } catch {}
  }

  // 7. Supplier tasks (for supplier managers / quality)
  if (['admin','quality_manager','supplier_manager','management'].includes(role)) {
    try {
      const sups = db.prepare("SELECT * FROM suppliers WHERE status IN ('conditional','pending') OR next_audit <= date('now','+45 day') OR (status='approved' AND next_audit IS NOT NULL AND next_audit <= date('now','+30 day'))").all();
      // Also suppliers needing evaluation
      const needEval = db.prepare(`
        SELECT s.* FROM suppliers s
        WHERE s.status='approved'
        AND NOT EXISTS (SELECT 1 FROM supplier_evaluations se WHERE se.supplier_id=s.id AND se.period >= date('now','-180 day'))
      `).all();
      const allSups = [...sups, ...needEval];
      const seenSup = new Set();
      for (const s of allSups) {
        if (seenSup.has(s.id)) continue;
        seenSup.add(s.id);
        let prio = 'medium';
        if (s.risk_level === 'critical') prio = 'critical';
        else if (s.risk_level === 'high') prio = 'high';
        let nextStep = 'Evaluate supplier performance';
        if (s.status === 'conditional') nextStep = 'Follow up on conditional supplier';
        else if (s.next_audit && s.next_audit < T()) nextStep = 'Supplier audit is overdue';
        add({
          id: `suppliers:${s.id}:supplier`,
          recordType: 'suppliers', recordId: String(s.id), code: s.code, title: s.name,
          moduleLabel: 'Suppliers', taskType: 'supplier',
          priority: prio, status: s.status, dueDate: s.next_audit,
          owner: s.contact_name || null, createdAt: s.created_at,
          link: `/suppliers/${s.id}`,
          requiredNextStep: nextStep
        });
      }
    } catch {}
  }

  // 8. Equipment tasks
  if (canRead(user, 'equipment')) {
    try {
      const eqs = db.prepare(`
        SELECT * FROM equipment
        WHERE owner_id = ? AND (status IN ('under_maintenance','under_qualification','out_of_service') OR next_calibration <= date('now','+14 day') OR next_maintenance <= date('now','+14 day'))
      `).all(uid);
      // Also for equipment managers, show all equipment needing attention regardless of owner
      let extra = [];
      if (['admin','quality_manager','equipment_manager','management'].includes(role)) {
        extra = db.prepare(`
          SELECT * FROM equipment
          WHERE status IN ('under_maintenance','under_qualification','failed','expired')
          OR next_calibration <= date('now','+14 day')
        `).all();
      }
      const allEq = [...eqs, ...extra.filter(e => !eqs.find(x => x.id === e.id))];
      for (const e of allEq) {
        let prio = 'medium';
        if (e.status === 'out_of_service' || e.status === 'failed') prio = 'critical';
        else if (e.status === 'expired' || (e.next_calibration && e.next_calibration < T())) prio = 'high';
        let nextStep = 'Perform maintenance or calibration';
        if (e.status === 'under_qualification') nextStep = 'Complete qualification activities';
        else if (e.status === 'under_maintenance') nextStep = 'Complete maintenance';
        else if (e.next_calibration && e.next_calibration <= T()) nextStep = 'Calibration is due — schedule now';
        add({
          id: `equipment:${e.id}:equipment`,
          recordType: 'equipment', recordId: String(e.id), code: e.code, title: e.name,
          moduleLabel: 'Equipment', taskType: 'equipment',
          priority: prio, status: e.status, dueDate: e.next_calibration || e.next_maintenance,
          owner: ownerName(e.owner_id), createdAt: e.created_at,
          link: `/equipment/${e.id}`,
          requiredNextStep: nextStep
        });
      }
    } catch {}
  }

  // 9. Competency & training
  if (employeeId) {
    try {
      const trainings = db.prepare(`
        SELECT t.*, tp.status as tp_status FROM trainings t
        JOIN training_participants tp ON tp.training_id = t.id
        WHERE tp.employee_id = ? AND t.status IN ('scheduled','in_progress') AND tp.status IN ('invited','attending')
      `).all(employeeId);
      for (const t of trainings) {
        add({
          id: `trainings:${t.id}:training`,
          recordType: 'trainings', recordId: String(t.id), code: t.code, title: t.title,
          moduleLabel: 'Training', taskType: 'training',
          priority: 'medium', status: t.status, dueDate: t.scheduled_date,
          owner: ownerName(uid), createdAt: t.created_at,
          link: `/trainings/${t.id}`,
          requiredNextStep: 'Attend the scheduled training'
        });
      }
      // Competency gaps
      const gaps = db.prepare(`
        SELECT c.*, a.level as current_level, a.expiry_date FROM competencies c
        LEFT JOIN assessments a ON a.competency_id = c.id AND a.employee_id = ?
        WHERE (a.level IS NULL OR a.level < c.required_level OR a.expiry_date <= date('now','+30 day'))
        AND c.required_level > 0
        LIMIT 10
      `).all(employeeId);
      for (const g of gaps) {
        const expired = g.expiry_date && g.expiry_date < T();
        const gap = g.current_level === null || g.current_level < g.required_level;
        if (!gap && !expired) continue;
        add({
          id: `competencies:${g.id}:competency`,
          recordType: 'competencies', recordId: String(g.id), code: g.code, title: g.name,
          moduleLabel: 'Competency', taskType: 'training',
          priority: expired ? 'high' : 'medium', status: expired ? 'expired' : 'gap',
          dueDate: g.expiry_date, owner: ownerName(uid), createdAt: g.expiry_date || null,
          link: `/competencies/${g.id}`,
          requiredNextStep: expired ? 'Renew the competency certification' : `Achieve required level ${g.required_level} (current: ${g.current_level ?? 'not assessed'})`
        });
      }
    } catch {}
  }

  // 10. Compliance tasks
  if (canRead(user, 'compliance')) {
    try {
      const comps = db.prepare("SELECT * FROM compliance_requirements WHERE owner_id = ? AND status IN ('non_compliant','partially','not_assessed')").all(uid);
      for (const c of comps) {
        let prio = 'medium';
        if (c.status === 'non_compliant') prio = 'critical';
        else if (c.status === 'partially') prio = 'high';
        add({
          id: `compliance:${c.id}:compliance`,
          recordType: 'compliance', recordId: String(c.id), code: c.code, title: c.title,
          moduleLabel: 'Compliance', taskType: 'compliance',
          priority: prio, status: c.status, dueDate: c.next_review,
          owner: ownerName(c.owner_id), createdAt: c.created_at,
          link: `/compliance/${c.id}`,
          requiredNextStep: c.status === 'non_compliant' ? 'Close the compliance gap and provide evidence' : 'Complete the compliance assessment'
        });
      }
      // Compliance deadlines
      const deadlines = db.prepare("SELECT * FROM compliance_requirements WHERE next_review IS NOT NULL AND next_review <= date('now','+30 day') AND (owner_id = ? OR ? IN ('admin','quality_manager','compliance_manager','management'))").all(uid, role);
      for (const c of deadlines) {
        const key = `compliance:${c.id}:deadline`;
        if (seen.has(key)) continue;
        add({
          id: key,
          recordType: 'compliance', recordId: String(c.id), code: c.code, title: c.title,
          moduleLabel: 'Compliance', taskType: 'compliance',
          priority: c.next_review < T() ? 'high' : 'medium', status: c.status, dueDate: c.next_review,
          owner: ownerName(c.owner_id), createdAt: c.created_at,
          link: `/compliance/${c.id}`,
          requiredNextStep: 'Compliance review is due — review and provide evidence'
        });
      }
    } catch {}
  }

  // 11. Design Review tasks
  if (canRead(user, 'design')) {
    try {
      const drs = db.prepare("SELECT * FROM design_reviews WHERE chair_id = ? AND status != 'closed'").all(uid);
      for (const d of drs) {
        add({
          id: `design:${d.id}:review`,
          recordType: 'design', recordId: String(d.id), code: d.code, title: d.title,
          moduleLabel: 'Design Reviews', taskType: 'review',
          priority: 'medium', status: d.status, dueDate: d.review_date,
          owner: ownerName(d.chair_id), createdAt: d.created_at,
          link: `/design/${d.id}`,
          requiredNextStep: d.status === 'planned' ? 'Conduct the design review' : 'Complete review findings and close'
        });
      }
    } catch {}
  }

  // 12. Management Review tasks
  if (canRead(user, 'mgmt_reviews')) {
    try {
      const mrs = db.prepare("SELECT * FROM management_reviews WHERE chair_id = ? AND status != 'issued'").all(uid);
      for (const m of mrs) {
        add({
          id: `mgmt_reviews:${m.id}:review`,
          recordType: 'mgmt_reviews', recordId: String(m.id), code: m.code, title: m.title,
          moduleLabel: 'Management Review', taskType: 'review',
          priority: 'high', status: m.status, dueDate: m.review_date,
          owner: ownerName(m.chair_id), createdAt: m.created_at,
          link: `/mgmt-reviews/${m.id}`,
          requiredNextStep: m.status === 'draft' ? 'Prepare the management review and collect inputs' : 'Review and issue the management review'
        });
      }
    } catch {}
  }

  // 13. Workflow tasks assigned to user (from workflow engine actions already covered via actions)
  // No separate table — actions cover this.

  // Enrich with recentlyUpdated flag (audit in last 7 days for this user's owned records)
  const recentlyUpdatedIds = new Set();
  try {
    const recentAudits = db.prepare(`
      SELECT DISTINCT entity_type, entity_id FROM audit_log
      WHERE datetime(created_at) >= datetime('now','-7 day')
      AND action IN ('update','status_change','complete','verify')
      LIMIT 100
    `).all();
    for (const r of recentAudits) {
      // Check if this entity is in the user's inbox (owned by user)
      const key = `${r.entity_type}:${r.entity_id}:`;
      for (const item of items) {
        if (item.recordType === r.entity_type && item.recordId === String(r.entity_id)) {
          recentlyUpdatedIds.add(item.id);
        }
      }
    }
  } catch {}
  for (const item of items) {
    if (recentlyUpdatedIds.has(item.id)) item.recentlyUpdated = true;
  }

  return items;
}

function categorize(items) {
  const overdue = items.filter(i => i.overdue && !i.isCompleted);
  const dueSoon = items.filter(i => !i.overdue && i.dueSoon && !i.isCompleted && i.taskType !== 'approval');
  const waiting = items.filter(i => i.taskType === 'approval' && !i.isCompleted);
  const completed = items.filter(i => i.isCompleted);
  const recentlyUpdated = items.filter(i => i.recentlyUpdated && !i.isCompleted && !i.overdue && i.taskType !== 'approval');
  const requiresAction = items.filter(i =>
    !i.overdue && !i.dueSoon && i.taskType !== 'approval' && !i.isCompleted && !i.recentlyUpdated
  );
  return { overdue, dueSoon, waiting, requiresAction, completed, recentlyUpdated };
}

r.get('/', (req, res) => {
  const items = buildInbox(req.user);
  const cats = categorize(items);

  // Sorting
  const sort = req.query.sort || 'priority';
  const sortFns = {
    priority: (a, b) => priorityRank(b.priority) - priorityRank(a.priority) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'),
    dueDate: (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'),
    createdDate: (a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''),
    module: (a, b) => a.moduleLabel.localeCompare(b.moduleLabel),
    status: (a, b) => String(a.status).localeCompare(String(b.status))
  };
  const sorter = sortFns[sort] || sortFns.priority;
  for (const k of Object.keys(cats)) cats[k] = [...cats[k]].sort(sorter);
  const sortedItems = [...items].sort(sorter);

  const attentionCount = cats.overdue.length + cats.dueSoon.length + cats.waiting.length + cats.requiresAction.length;
  const counts = {
    all: items.length, requiresAction: cats.requiresAction.length, waiting: cats.waiting.length,
    overdue: cats.overdue.length, dueSoon: cats.dueSoon.length, completed: cats.completed.length,
    recentlyUpdated: cats.recentlyUpdated.length, attention: attentionCount
  };

  // Filters
  const taskFilter = req.query.taskType || 'all';
  const dueFilter = req.query.dueFilter || 'all';
  const priorityFilter = req.query.priority || 'all';
  let filtered = sortedItems;
  if (taskFilter !== 'all') {
    const map = {
      action: ['action'], approval: ['approval'], review: ['review'],
      training: ['training'], risk: ['risk'], nc: ['nc'],
      audit: ['audit'], supplier: ['supplier'], equipment: ['equipment'],
      compliance: ['compliance'], document: ['document']
    };
    const allowed = map[taskFilter] || [taskFilter];
    filtered = filtered.filter(i => allowed.includes(i.taskType));
  }
  if (dueFilter !== 'all') {
    if (dueFilter === 'overdue') filtered = filtered.filter(i => i.overdue);
    else if (dueFilter === 'dueToday') filtered = filtered.filter(i => i.dueToday);
    else if (dueFilter === 'dueThisWeek') filtered = filtered.filter(i => i.dueThisWeek);
    else if (dueFilter === 'upcoming') filtered = filtered.filter(i => i.upcoming);
  }
  if (priorityFilter !== 'all') filtered = filtered.filter(i => String(i.priority).toLowerCase() === priorityFilter);

  res.json({
    items: filtered, allItems: sortedItems, sections: cats, counts, attentionCount,
    attention: attentionCount, total: items.length, filteredTotal: filtered.length
  });
});

r.get('/count', (req, res) => {
  const items = buildInbox(req.user);
  const cats = categorize(items);
  const attentionCount = cats.overdue.length + cats.dueSoon.length + cats.waiting.length + cats.requiresAction.length;
  res.json({ count: attentionCount, attention: attentionCount, total: items.length, breakdown: {
    requiresAction: cats.requiresAction.length, waiting: cats.waiting.length,
    overdue: cats.overdue.length, dueSoon: cats.dueSoon.length,
    completed: cats.completed.length, recentlyUpdated: cats.recentlyUpdated.length
  }});
});

module.exports = r;
module.exports.buildInbox = buildInbox;
module.exports.categorize = categorize;
