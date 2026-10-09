// QMS Command Center — global search across every module.
// Supports exact IDs, free text, people, suppliers, and intent words.
const express = require('express');
const db = require('../db');
const { MODULES } = require('../modules');
const { authRequired } = require('../middleware/auth');
const { audit } = require('../middleware/audit');

const r = express.Router();
r.use(authRequired);

function canRead(user, key) {
  if (key === 'records') return ['admin', 'quality_manager', 'management', 'manager', 'compliance_manager', 'doc_controller'].includes(user.role);
  if (key === 'mgmt_reviews') return ['admin', 'quality_manager', 'management', 'manager', 'qa', 'investigator', 'auditor', 'compliance_manager', 'risk_manager'].includes(user.role);
  return true;
}

const ROUTE = { policies: 'policies', goals: 'goals', risks: 'risks', suppliers: 'suppliers', employees: 'employees', competencies: 'competencies', trainings: 'trainings', records: 'records', documents: 'documents', design: 'design', equipment: 'equipment', nonconformances: 'nonconformances', audits: 'audits', compliance: 'compliance', mgmt_reviews: 'mgmt-reviews', actions: 'actions' };
const ICON = { policies: 'policy', goals: 'goal', risks: 'risk', suppliers: 'supplier', employees: 'people', competencies: 'competency', trainings: 'training', records: 'record', documents: 'document', design: 'design', equipment: 'equipment', nonconformances: 'nc', audits: 'audit', compliance: 'compliance', mgmt_reviews: 'review', actions: 'action' };
const TITLE_COL = { suppliers: 'name', equipment: 'name', competencies: 'name', employees: 'name' };
const RESTRICTED = ['records'];
const MGMT = ['admin', 'quality_manager', 'management', 'manager', 'qa', 'investigator', 'auditor', 'compliance_manager', 'risk_manager'];

r.get('/', (req, res) => {
  const user = req.user;
  const rawQ = String(req.query.q || '').trim();
  const modFilter = req.query.module || '';
  const statusFilter = req.query.status || '';
  const priorityFilter = req.query.priority || '';
  const ownerFilter = req.query.owner || '';

  const hasAny = rawQ || modFilter || statusFilter || priorityFilter || ownerFilter;
  if (!hasAny) return res.json({ parsed: null, groups: [], direct: null, total: 0 });

  // Intent detection
  let text = rawQ;
  const intents = { overdue: false, critical: false, high: false };
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  const keep = [];
  for (const t of tokens) {
    if (t === 'overdue') intents.overdue = true;
    else if (t === 'critical' || t === 'urgent') intents.critical = true;
    else if (t === 'high') intents.high = true;
    else keep.push(t);
  }
  text = keep.join(' ');

  // Direct exact-ID hit
  let direct = null;
  if (/^[A-Z]{2,4}-\d{1,6}$/i.test(rawQ)) {
    for (const [key, m] of Object.entries(MODULES)) {
      if (!canRead(user, key)) continue;
      const row = db.prepare('SELECT * FROM ' + m.table + ' WHERE code = ?').get(rawQ.toUpperCase());
      if (row) {
        const tCol = row.title !== undefined ? 'title' : 'name';
        direct = { module: key, moduleTitle: m.title, id: row.id, code: row.code, title: row[tCol], status: row.status, link: '/' + (ROUTE[key] || key) + '/' + row.id };
        break;
      }
    }
  }

  // People resolution
  const ownerIds = new Set();
  let peopleRows = [];
  if (text.length >= 3) {
    const like = '%' + text + '%';
    const users = db.prepare('SELECT id, name, role, department, job_title FROM users WHERE (name LIKE ? OR email LIKE ?) AND active = 1 LIMIT 6').all(like, like);
    const emps = db.prepare('SELECT id, code, name, department, job_title, status FROM employees WHERE name LIKE ? LIMIT 6').all(like);
    users.forEach(u => ownerIds.add(u.id));
    emps.forEach(e => { const u2 = db.prepare('SELECT id FROM users WHERE name = ?').get(e.name); if (u2) ownerIds.add(u2.id); });
    if (users.length || emps.length) {
      peopleRows = [
        ...users.map(u => ({ id: u.id, code: null, title: u.name, status: String(u.role).replace(/_/g, ' '), owner: u.job_title || u.department, due: null, priority: null, link: null })),
        ...emps.map(e => ({ id: e.id, code: e.code, title: e.name, status: e.status, owner: e.job_title || e.department, due: null, priority: null, link: '/employees/' + e.id }))
      ];
    }
  }

  // Supplier resolution
  const supplierIds = new Set();
  let supplierRows = [];
  if (text.length >= 3) {
    const like = '%' + text + '%';
    const sups = db.prepare('SELECT id, code, name, status, category, risk_level, contact_name FROM suppliers WHERE name LIKE ? OR contact_name LIKE ? OR code LIKE ? LIMIT 6').all(like, like, like);
    sups.forEach(s => supplierIds.add(s.id));
    if (sups.length) supplierRows = sups.map(s => ({ id: s.id, code: s.code, title: s.name, status: s.status, owner: s.contact_name, due: s.next_audit, priority: s.risk_level, link: '/suppliers/' + s.id }));
  }

  // Supplier-related action codes
  let supplierActionCodes = [];
  if (supplierIds.size) {
    const ncCodes = db.prepare('SELECT code FROM nonconformances WHERE supplier_id IN (' + [...supplierIds].map(() => '?').join(',') + ')').all(...supplierIds).map(x => x.code);
    const audCodes = db.prepare('SELECT code FROM audits WHERE supplier_id IN (' + [...supplierIds].map(() => '?').join(',') + ')').all(...supplierIds).map(x => x.code);
    const allCodes = [...ncCodes, ...audCodes];
    if (allCodes.length) supplierActionCodes = db.prepare('SELECT code FROM actions WHERE source_code IN (' + allCodes.map(() => '?').join(',') + ')').all(...allCodes).map(x => x.code);
  }

  const ownerNameCache = new Map();
  const ownerNameOf = id => {
    if (!id) return null;
    if (!ownerNameCache.has(id)) ownerNameCache.set(id, (db.prepare('SELECT name FROM users WHERE id = ?').get(id) || {}).name || null);
    return ownerNameCache.get(id);
  };

  const groups = [];
  for (const [key, m] of Object.entries(MODULES)) {
    if (modFilter && modFilter !== key) continue;
    if (!canRead(user, key)) continue;
    const searchFields = m.search;
    if (!searchFields || !searchFields.length) continue;

    const where = [];
    const args = [];
    if (text) {
      where.push('(' + searchFields.map(f => f + ' LIKE ?').join(' OR ') + ')');
      searchFields.forEach(() => args.push('%' + text + '%'));
    }
    if (ownerIds.size && (m.owner_id || key === 'audits' || key === 'design')) {
      const oc = key === 'audits' ? 'lead_auditor_id' : key === 'design' ? 'chair_id' : 'owner_id';
      where.push(oc + ' IN (' + [...ownerIds].map(() => '?').join(',') + ')');
      ownerIds.forEach(o => args.push(o));
    }
    if (intents.critical || intents.high) {
      const pc = key === 'nonconformances' ? 'severity' : key === 'actions' ? 'priority' : key === 'risks' ? null : null;
      if (pc) {
        if (intents.critical) { where.push(pc + " IN ('critical')"); args.push('critical'); }
        else { where.push(pc + " IN ('high','major')"); args.push('high'); args.push('major'); }
      }
      if (key === 'risks' && (intents.critical || intents.high)) {
        where.push('(residual_likelihood * residual_severity) >= 15');
      }
    }
    if (intents.overdue) {
      const dueCol = key === 'actions' ? 'due_date' : key === 'nonconformances' ? 'occurred_at' : key === 'audits' ? 'planned_date' : key === 'documents' ? 'review_date' : key === 'policies' ? 'review_date' : key === 'risks' ? 'review_date' : key === 'compliance_requirements' ? 'next_review' : key === 'equipment' ? 'next_calibration' : key === 'suppliers' ? 'next_audit' : key === 'trainings' ? 'scheduled_date' : key === 'design_reviews' ? 'review_date' : key === 'management_reviews' ? 'review_date' : key === 'goals' ? 'review_date' : null;
      if (dueCol) where.push(dueCol + " < date('now')");
    }
    if (key === 'nonconformances' && supplierIds.size) { where.push('supplier_id IN (' + [...supplierIds].map(() => '?').join(',') + ')'); supplierIds.forEach(s => args.push(s)); }
    if (key === 'audits' && supplierIds.size) { where.push('supplier_id IN (' + [...supplierIds].map(() => '?').join(',') + ')'); supplierIds.forEach(s => args.push(s)); }
    if (key === 'actions' && supplierActionCodes.length) { where.push('source_code IN (' + supplierActionCodes.map(() => '?').join(',') + ')'); supplierActionCodes.forEach(c => args.push(c)); }
    if (RESTRICTED.includes(key) && !MGMT.includes(user.role) && user.role !== 'doc_controller')
      where.push("confidentiality != 'restricted'");
    if (key === 'mgmt_reviews' && !MGMT.includes(user.role)) continue;
    if (key === 'employees' && !peopleRows.length && text.length < 3) continue;

    if (!where.length) continue;
    const sql = 'SELECT * FROM ' + m.table + ' WHERE ' + where.join(' AND ') + ' ORDER BY id DESC LIMIT 15';
    let rows;
    try { rows = db.prepare(sql).all(...args); } catch { continue; }
    if (!rows.length) continue;

    const tCol = rows[0].title !== undefined ? 'title' : 'name';
    groups.push({
      module: key, moduleTitle: m.title, icon: ICON[key] || 'search',
      rows: rows.map(row => ({
        id: row.id, code: row.code || null,
        title: row[tCol] || '',
        status: row.status || null,
        owner: m.owner_id ? ownerNameOf(row.owner_id) || null : null,
        priority: key === 'nonconformances' ? (row.severity || null) : key === 'actions' ? (row.priority || null) : key === 'risks' ? (row.residual_likelihood * row.residual_severity || null) : key === 'suppliers' ? (row.risk_level || null) : null,
        due: row.due_date || row.review_date || row.planned_date || row.occurred_at || row.next_review || row.next_calibration || row.next_audit || row.scheduled_date || null,
        link: '/' + (ROUTE[key] || key) + '/' + row.id
      }))
    });
  }

  const finalGroups = [];
  if (direct) finalGroups.push({ module: '__direct', moduleTitle: 'Exact match', icon: 'search', rows: [{ ...direct, owner: null, due: null, priority: null }] });
  if (peopleRows.length) finalGroups.push({ module: 'people', moduleTitle: 'People', icon: 'people', rows: peopleRows });
  if (supplierRows.length) finalGroups.push({ module: 'suppliers', moduleTitle: 'Suppliers', icon: 'supplier', rows: supplierRows });
  finalGroups.push(...groups);

  const total = finalGroups.reduce((a, g) => a + g.rows.length, 0);
  audit(req, 'command_search', 'search', null, rawQ.slice(0, 80), { results: total });
  res.json({
    parsed: { text, overdue: intents.overdue, critical: intents.critical, high: intents.high },
    groups: finalGroups, direct, total
  });
});

r.get('/owners', (req, res) => {
  res.json(db.prepare('SELECT id, name FROM users WHERE active = 1 ORDER BY name').all());
});

module.exports = r;
