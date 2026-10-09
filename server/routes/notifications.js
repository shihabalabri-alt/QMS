// Smart Notifications API — filters, facets, record enrichment, history.
const express = require('express');
const db = require('../db');
const { MODULES } = require('../modules');
const { authRequired } = require('../middleware/auth');

const r = express.Router();
r.use(authRequired);

const ROUTE_TO_KEY = { risks: 'risks', actions: 'actions', documents: 'documents', policies: 'policies', equipment: 'equipment', suppliers: 'suppliers', compliance: 'compliance', competencies: 'competencies', trainings: 'trainings', 'mgmt-reviews': 'mgmt_reviews', nonconformances: 'nonconformances', goals: 'goals', design: 'design', employees: 'employees', audits: 'audits', records: 'records' };

// Resolve the linked record's live status so every notification shows current state
function enrich(row) {
  let refType = row.ref_type, refId = row.ref_id;
  if ((!refType || !refId) && row.link) {
    const m = row.link.match(/^\/([a-z-]+)\/(\d+)/) || row.link.match(/^\/([a-z-]+)\?focus=(\d+)/);
    if (m && ROUTE_TO_KEY[m[1]]) { refType = ROUTE_TO_KEY[m[1]]; refId = m[2]; }
  }
  if (refType && refId && MODULES[refType]) {
    try {
      const rec = db.prepare(`SELECT code, title, name, status FROM ${MODULES[refType].table} WHERE id = ?`).get(Number(refId));
      if (rec) {
        row.recordCode = row.record_code || rec.code;
        row.recordStatus = rec.status;
        row.recordTitle = rec.title || rec.name;
      }
    } catch {}
  }
  return row;
}

// GET / — filtered list + facet counts
r.get('/', (req, res) => {
  const uid = req.user.id;
  const { filter = 'all', limit = 100, offset = 0 } = req.query;
  let sql = 'SELECT * FROM notifications WHERE user_id = ?';
  const args = [uid];
  if (filter === 'unread') sql += ' AND read = 0';
  else if (filter === 'critical') sql += " AND priority = 'critical'";
  else if (filter === 'high') sql += " AND priority IN ('high','critical')";
  else if (filter !== 'all') sql += ' AND category = ?', args.push(filter);
  const total = db.prepare(`SELECT COUNT(*) c FROM (${sql})`).get(...args).c;
  sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
  args.push(Math.min(Number(limit) || 100, 300), Number(offset) || 0);
  const rows = db.prepare(sql).all(...args).map(enrich);
  const unread = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0').get(uid).c;
  res.json({ rows, total, unread });
});

// GET /facets — counts per filter for the tab badges
r.get('/facets', (req, res) => {
  const uid = req.user.id;
  const all = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ?').get(uid).c;
  const unread = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0').get(uid).c;
  const critical = db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND priority = 'critical'").get(uid).c;
  const high = db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND priority = 'high'").get(uid).c;
  const byCat = db.prepare(`SELECT category, COUNT(*) c, SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) unread FROM notifications WHERE user_id = ? GROUP BY category`).all(uid);
  res.json({ all, unread, critical, high, byCategory: byCat });
});

r.get('/unread-count', (req, res) => {
  res.json({ unread: db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0').get(req.user.id).c });
});

r.post('/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

r.post('/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

module.exports = r;
