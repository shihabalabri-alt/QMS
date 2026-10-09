// Administration: users, settings, audit log, webhooks, API keys, job control.
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { ROLES, ROLE_LABELS } = require('../modules');
const { nowIso } = require('../utils');
const mailer = require('../mailer');
const sec = require('../security');

const r = express.Router();
r.use(authRequired);

const ADMIN = ['admin'];
const ADMIN_VIEW = ['admin', 'quality_manager', 'management', 'compliance_manager'];

/* ---------- Users ---------- */
r.get('/users', (req, res) => {
  if (!ADMIN_VIEW.includes(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
  const rows = db.prepare('SELECT id, name, email, role, department, job_title, phone, active, last_login, created_at, COALESCE(email_verified,0) AS email_verified, locked_until, failed_attempts FROM users ORDER BY name').all();
  res.json({ rows, roles: ROLES.map(x => ({ id: x, label: ROLE_LABELS[x] })), canEdit: ADMIN.includes(req.user.role) });
});

r.post('/users', async (req, res) => {
  if (!ADMIN.includes(req.user.role)) return res.status(403).json({ error: 'Only administrators can create users' });
  const { name, email, password, role, department, job_title, phone } = req.body || {};
  if (!name || !email || !password || password.length < 8) return res.status(400).json({ error: 'Name, email and password (8+ chars) required' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  // Email validation bot: format + disposable domains + live MX lookup
  const check = await mailer.checkEmail(email);
  if (!check.ok) return res.status(400).json({ error: 'Email rejected: ' + check.reason });
  const pwOk = sec.passwordOk(password);
  if (!pwOk) return res.status(400).json({ error: sec.PASSWORD_RULES });
  try {
    const bcrypt = require('bcryptjs');
    const token = require('crypto').randomBytes(24).toString('hex');
    const id = db.prepare('INSERT INTO users (name, email, password_hash, role, department, job_title, phone, email_verified, email_verify_token, email_verify_sent_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(name, check.email || String(email).toLowerCase().trim(), bcrypt.hashSync(password, 10), role, department || 'Quality', job_title || '', phone || '', 0, token, new Date().toISOString()).lastInsertRowid;
    audit(req, 'create', 'users', id, name, { role });
    const delivery = await mailer.sendVerificationEmail({ id, name, email: check.email || email }, token);
    audit(req, 'verification_sent', 'users', id, email, { delivered: delivery.delivered });
    res.status(201).json({ id, email_verified: false, delivered: delivery.delivered, devLink: delivery.link || null });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: 'Email already in use' });
    res.status(400).json({ error: e.message });
  }
});

r.put('/users/:id', (req, res) => {
  if (!ADMIN.includes(req.user.role)) return res.status(403).json({ error: 'Only administrators can edit users' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'User not found' });
  const { name, email, role, department, job_title, phone } = req.body || {};
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  db.prepare('UPDATE users SET name = ?, email = ?, role = ?, department = ?, job_title = ?, phone = ? WHERE id = ?')
    .run(name ?? u.name, email ? email.toLowerCase().trim() : u.email, role ?? u.role, department ?? u.department, job_title ?? u.job_title, phone ?? u.phone, u.id);
  audit(req, 'update', 'users', u.id, name || u.name, { role: role ?? u.role });
  res.json({ ok: true });
});

r.post('/users/:id/toggle', (req, res) => {
  if (!ADMIN.includes(req.user.role)) return res.status(403).json({ error: 'Only administrators can disable users' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (u.id === req.user.id) return res.status(400).json({ error: 'You cannot disable your own account' });
  db.prepare('UPDATE users SET active = ? WHERE id = ?').run(u.active ? 0 : 1, u.id);
  if (u.active) sec.bumpTokenVersion(u.id); // kill sessions of disabled accounts
  audit(req, 'toggle', 'users', u.id, u.name, { active: !u.active });
  res.json({ ok: true, active: !u.active });
});

r.post('/users/:id/reset-password', (req, res) => {
  if (!ADMIN.includes(req.user.role)) return res.status(403).json({ error: 'Only administrators can reset passwords' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'User not found' });
  const password = (req.body || {}).password;
  const pwOk = sec.passwordOk(password);
  if (!pwOk) return res.status(400).json({ error: sec.PASSWORD_RULES });
  const bcrypt = require('bcryptjs');
  db.prepare('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(bcrypt.hashSync(password, 10), u.id);
  sec.bumpTokenVersion(u.id); // sign out everywhere
  audit(req, 'reset_password', 'users', u.id, u.name);
  res.json({ ok: true });
});

/* ---------- Settings ---------- */
r.get('/settings', (req, res) => {
  if (!ADMIN_VIEW.includes(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
  const rows = db.prepare('SELECT key, value FROM settings').all();
  res.json({ settings: Object.fromEntries(rows.map(x => [x.key, x.value])), canEdit: ADMIN.includes(req.user.role) });
});
r.put('/settings', (req, res) => {
  if (!ADMIN.includes(req.user.role)) return res.status(403).json({ error: 'Only administrators can change settings' });
  const allowed = ['org_name', 'alert_days', 'escalate_days'];
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!allowed.includes(k)) continue;
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));
  }
  audit(req, 'update', 'settings', null, 'System settings', req.body);
  res.json({ ok: true });
});

/* ---------- Audit log ---------- */
r.get('/audit-log', (req, res) => {
  if (!ADMIN_VIEW.includes(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
  const { user, action, entity, q, limit } = req.query;
  let sql = 'SELECT a.*, u.name AS user_name2 FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE 1=1';
  const args = [];
  if (user) { sql += ' AND (a.user_name LIKE ? OR u.name LIKE ?)'; args.push(`%${user}%`, `%${user}%`); }
  if (action && action !== 'all') { sql += ' AND a.action = ?'; args.push(action); }
  if (entity) { sql += ' AND (a.entity_type LIKE ? OR a.entity_label LIKE ? OR a.entity_id = ?)'; args.push(`%${entity}%`, `%${entity}%`, entity); }
  if (q) { sql += ' AND (a.details LIKE ? OR a.entity_label LIKE ?)'; args.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY a.id DESC LIMIT ?';
  args.push(Math.min(Number(limit) || 200, 1000));
  const rows = db.prepare(sql).all(...args).map(x => ({ ...x, user_name: x.user_name || x.user_name2, user_name2: undefined }));
  res.json({ rows, actions: db.prepare('SELECT DISTINCT action FROM audit_log ORDER BY action').all().map(x => x.action) });
});

/* ---------- Webhooks ---------- */
r.get('/webhooks', (req, res) => {
  if (!ADMIN.includes(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
  const rows = db.prepare('SELECT * FROM webhooks ORDER BY id').all().map(w => ({ ...w, events: w.events ? w.events.split(',') : [] }));
  const log = db.prepare('SELECT * FROM webhook_log ORDER BY id DESC LIMIT 30').all();
  res.json({ rows, log });
});
r.post('/webhooks', (req, res) => {
  if (!ADMIN.includes(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
  const { url, events, description, secret } = req.body || {};
  if (!url || !/^https?:\/\//.test(url)) return res.status(400).json({ error: 'Valid URL required' });
  const id = db.prepare('INSERT INTO webhooks (url, events, description, secret) VALUES (?,?,?,?)')
    .run(url, (events || []).join(','), description || '', secret || '').lastInsertRowid;
  audit(req, 'create', 'webhooks', id, url);
  res.status(201).json({ id });
});
r.delete('/webhooks/:id', (req, res) => {
  if (!ADMIN.includes(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
  db.prepare('DELETE FROM webhooks WHERE id = ?').run(Number(req.params.id));
  audit(req, 'delete', 'webhooks', Number(req.params.id));
  res.json({ ok: true });
});
r.post('/webhooks/:id/test', async (req, res) => {
  if (!ADMIN.includes(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
  const w = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(Number(req.params.id));
  if (!w) return res.status(404).json({ error: 'Webhook not found' });
  try {
    const resp = await fetch(w.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'test', at: nowIso() }) });
    db.prepare('INSERT INTO webhook_log (webhook_id, event, status_code, ok) VALUES (?,?,?,?)').run(w.id, 'test', resp.status, resp.ok ? 1 : 0);
    res.json({ ok: resp.ok, status: resp.status });
  } catch (e) {
    db.prepare('INSERT INTO webhook_log (webhook_id, event, status_code, ok) VALUES (?,?,?,?)').run(w.id, 'test', 0, 0);
    res.json({ ok: false, error: e.message });
  }
});

/* ---------- API keys ---------- */
r.get('/api-keys', (req, res) => {
  if (!ADMIN.includes(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
  const rows = db.prepare('SELECT id, name, prefix, scopes, active, last_used, created_at FROM api_keys ORDER BY id DESC').all();
  res.json({ rows });
});
r.post('/api-keys', (req, res) => {
  if (!ADMIN.includes(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
  const { name, scopes } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name required' });
  const raw = 'qk_' + crypto.randomBytes(24).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const prefix = raw.slice(0, 10);
  const id = db.prepare('INSERT INTO api_keys (name, key_hash, prefix, scopes, created_by) VALUES (?,?,?,?,?)')
    .run(name, hash, prefix, scopes || 'read', req.user.id).lastInsertRowid;
  audit(req, 'create', 'api_keys', id, name);
  res.status(201).json({ id, key: raw, note: 'Store this key now — it cannot be retrieved again' });
});
r.post('/api-keys/:id/revoke', (req, res) => {
  if (!ADMIN.includes(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
  db.prepare('UPDATE api_keys SET active = 0 WHERE id = ?').run(Number(req.params.id));
  audit(req, 'revoke', 'api_keys', Number(req.params.id));
  res.json({ ok: true });
});

/* ---------- System overview + jobs ---------- */
r.get('/overview', (req, res) => {
  if (!ADMIN_VIEW.includes(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
  const one = (sql, ...a) => db.prepare(sql).get(...a).c;
  res.json({
    users: one('SELECT COUNT(*) FROM users WHERE active = 1'),
    disabledUsers: one('SELECT COUNT(*) FROM users WHERE active = 0'),
    records: one('SELECT COUNT(*) FROM records'),
    documents: one('SELECT COUNT(*) FROM documents'),
    files: one('SELECT COUNT(*) FROM files'),
    storageBytes: (db.prepare('SELECT COALESCE(SUM(size),0) s FROM files').get().s),
    auditEntries: one('SELECT COUNT(*) FROM audit_log'),
    notifications: one('SELECT COUNT(*) FROM notifications'),
    aiRecommendations: one('SELECT COUNT(*) FROM ai_recommendations'),
    openActions: one("SELECT COUNT(*) FROM actions WHERE status IN ('open','in_progress')"),
    lastJobRun: (db.prepare("SELECT value FROM settings WHERE key = 'last_job_run'").get() || {}).value || null,
    jobIntervalMinutes: require('../config').jobIntervalMinutes
  });
});

// Admin unlock of a brute-force-locked account + clear failed counters
r.post('/users/:id/unlock', (req, res) => {
  if (!ADMIN.includes(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'User not found' });
  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(u.id);
  audit(req, 'unlock_account', 'users', u.id, u.name);
  res.json({ ok: true });
});

r.post('/users/:id/send-verification', async (req, res) => {
  if (!ADMIN.includes(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (u.email_verified) return res.status(400).json({ error: 'Email is already verified' });
  const check = await mailer.checkEmail(u.email);
  if (!check.ok) return res.status(400).json({ error: 'This email cannot receive mail: ' + check.reason });
  const token = require('crypto').randomBytes(24).toString('hex');
  db.prepare('UPDATE users SET email_verify_token = ?, email_verify_sent_at = ? WHERE id = ?').run(token, new Date().toISOString(), u.id);
  const delivery = await mailer.sendVerificationEmail(u, token);
  audit(req, 'verification_sent', 'users', u.id, u.email, { delivered: delivery.delivered });
  res.json({ ok: true, delivered: delivery.delivered, devLink: delivery.link || null });
});

/* ---------- Security monitoring + backups ---------- */
r.get('/security/events', (req, res) => {
  if (!ADMIN_VIEW.includes(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
  const rows = db.prepare(`SELECT a.*, u.name AS user_name2 FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.action IN ('login','login_failed','account_locked','login_blocked_locked','login_blocked_unverified','rate_limited','rate_limited_login','unlock_account','reset_password','change_password','email_verified','file_download','file_upload_rejected','ai_recommendation_approved','ai_recommendation_rejected','export')
    ORDER BY a.id DESC LIMIT 150`).all()
    .map(x => ({ ...x, user_name: x.user_name || x.user_name2 }));
  const lockedNow = db.prepare("SELECT COUNT(*) c FROM users WHERE locked_until IS NOT NULL AND datetime(locked_until) > datetime('now')").get().c;
  const failedToday = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action IN ('login_failed','rate_limited_login') AND date(created_at) = date('now')").get().c;
  const unverified = db.prepare('SELECT COUNT(*) c FROM users WHERE COALESCE(email_verified,0) = 0 AND active = 1').get().c;
  res.json({ rows, stats: { lockedNow, failedToday, unverified } });
});

r.post('/security/backup-now', (req, res) => {
  if (!ADMIN.includes(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
  const result = require('../backup').createBackup();
  audit(req, 'backup_created', 'security', null, result.file);
  res.json({ ok: true, ...result });
});

r.get('/security/backups', (req, res) => {
  if (!ADMIN.includes(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
  res.json({ rows: require('../backup').listBackups() });
});

module.exports = r;
