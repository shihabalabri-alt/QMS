// QMS Global Activity Feed — every recorded change across all modules, filterable.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');

const r = express.Router();
r.use(authRequired);

const ROUTE_MAP = {
  actions: 'actions', risks: 'risks', documents: 'documents', policies: 'policies',
  nonconformances: 'nonconformances', audits: 'audits', suppliers: 'suppliers',
  equipment: 'equipment', competencies: 'competencies', trainings: 'trainings',
  goals: 'goals', compliance_requirements: 'compliance', design_reviews: 'design',
  management_reviews: 'mgmt-reviews', records: 'records', employees: 'employees'
};
const CATEGORY_MAP = {
  actions: 'actions', risks: 'risks', documents: 'documents', policies: 'documents',
  nonconformances: 'nc', audits: 'audits', suppliers: 'suppliers', equipment: 'equipment',
  competencies: 'competency', trainings: 'competency', goals: 'goals',
  compliance_requirements: 'compliance', design_reviews: 'design', management_reviews: 'reviews',
  records: 'records', employees: 'users', users: 'users', files: 'files', links: 'links'
};

r.get('/', (req, res) => {
  const { filter = 'all', user = '', from = '', to = '', limit = 100, offset = 0 } = req.query;
  let sql = 'SELECT a.*, u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE 1=1';
  const args = [];
  if (filter !== 'all') {
    const types = Object.entries(CATEGORY_MAP).filter(([, cat]) => cat === filter).map(([t]) => t);
    if (types.length) { sql += ` AND a.entity_type IN (${types.map(() => '?').join(',')})`; args.push(...types); }
    else if (filter === 'approvals') { sql += ` AND a.action IN ('status_change','verify','2fa_enabled','2fa_disabled')`; }
  }
  if (user) { sql += ' AND a.user_name LIKE ?'; args.push(`%${user}%`); }
  if (from) { sql += ' AND date(a.created_at) >= date(?)'; args.push(from); }
  if (to) { sql += ' AND date(a.created_at) <= date(?)'; args.push(to); }
  const total = db.prepare(`SELECT COUNT(*) c FROM (${sql})`).get(...args).c;
  sql += ' ORDER BY a.id DESC LIMIT ? OFFSET ?';
  args.push(Math.min(Number(limit) || 100, 300), Number(offset) || 0);
  const rows = db.prepare(sql).all(...args).map(x => {
    // Parse previous → new values from the details JSON
    let changes = null;
    if (x.details) {
      try {
        const d = JSON.parse(x.details);
        if (d && typeof d === 'object') {
          if (d.from !== undefined && d.to !== undefined) changes = [{ field: 'status', from: d.from, to: d.to }];
          else changes = Object.entries(d).filter(([k, v]) => v && typeof v === 'object' && 'from' in v && 'to' in v).map(([k, v]) => ({ field: k, from: v.from, to: v.to }));
        }
      } catch {}
    }
    // Deep link to the affected record
    let link = null;
    if (x.entity_type && x.entity_id && /^\d+$/.test(String(x.entity_id)) && ROUTE_MAP[x.entity_type])
      link = `/${ROUTE_MAP[x.entity_type]}/${x.entity_id}`;
    return {
      id: x.id, actor: x.user_name || 'System', action: x.action,
      entityType: x.entity_type, entityLabel: x.entity_label, entityId: x.entity_id,
      changes, link, details: x.details, ip: x.ip, created_at: x.created_at
    };
  });
  const actors = db.prepare(`SELECT DISTINCT user_name FROM audit_log WHERE user_name IS NOT NULL ORDER BY user_name`).all().map(x => x.user_name);
  res.json({ rows, total, actors });
});

module.exports = r;
