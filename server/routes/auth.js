const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { sign, authRequired } = require('../middleware/auth');
const { MODULES, ROLES, ROLE_LABELS, can } = require('../modules');
const { audit, notify } = require('../middleware/audit');
const { nowIso } = require('../utils');

const r = express.Router();
const mailer = require('../mailer');
const sec = require('../security');
const totp = require('../totp');
const crypto = require('crypto');

r.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(String(email).trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    if (user) {
      const outcome = sec.registerFailedLogin(user.id);
      if (outcome.locked) audit(req, 'account_locked', 'users', user.id, user.email, { attempts: outcome.attempts });
    }
    audit(req, 'login_failed', 'security', user ? user.id : null, String(email).slice(0, 60), { reason: user ? 'wrong password' : 'unknown email' });
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (!user.active) return res.status(403).json({ error: 'Account is disabled. Contact your administrator.' });
  // Brute-force lockout
  if (sec.isLocked(user)) {
    const mins = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
    audit(req, 'login_blocked_locked', 'users', user.id, user.email);
    return res.status(423).json({ error: `Account temporarily locked after repeated failed logins. Try again in ${mins} minute(s), or ask an administrator to unlock it.` });
  }
  // Email verification gate (configurable; seeded/demo accounts are pre-verified)
  const requireVerif = ((db.prepare("SELECT value FROM settings WHERE key = 'require_email_verification'").get() || {}).value ?? '1') === '1';
  if (requireVerif && !user.email_verified) {
    audit(req, 'login_blocked_unverified', 'users', user.id, user.email);
    return res.status(403).json({ error: 'Your email address is not verified yet. Check your inbox for the verification link, or contact your administrator.', code: 'EMAIL_UNVERIFIED' });
  }
  // Two-factor authentication challenge
  if (user.totp_enabled) {
    const totp = require('../totp');
    const code = String((req.body || {}).totp || '').trim();
    if (!code) {
      return res.status(401).json({ error: 'Enter your 6-digit authenticator code (or a backup code).', code: 'TOTP_REQUIRED' });
    }
    let ok2fa = totp.verify(user.totp_secret, code);
    // Fallback: one-time backup codes (stored as SHA-256 hashes)
    if (!ok2fa && user.backup_codes) {
      try {
        const hashes = JSON.parse(user.backup_codes);
        const hash = crypto.createHash('sha256').update(code.toUpperCase()).digest('hex');
        const idx = hashes.indexOf(hash);
        if (idx >= 0) {
          hashes.splice(idx, 1);
          db.prepare('UPDATE users SET backup_codes = ? WHERE id = ?').run(JSON.stringify(hashes), user.id);
          ok2fa = true;
        }
      } catch {}
    }
    if (!ok2fa) {
      audit(req, 'login_failed', 'security', user.id, user.email, { reason: 'invalid 2FA code' });
      return res.status(401).json({ error: 'Invalid or expired 2FA code.', code: 'TOTP_INVALID' });
    }
  }

  db.prepare('UPDATE users SET last_login = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(nowIso(), user.id);
  const token = sign(user);
  audit(req, 'login', 'users', user.id, user.name, { role: user.role, ip: sec.clientIp ? undefined : undefined });
  notify(user.id, 'New sign-in detected', `${user.name} signed in from ${req.headers['x-forwarded-for'] || req.ip || 'local network'} at ${new Date().toLocaleString()}.`, null, 'info');
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, roleLabel: ROLE_LABELS[user.role] || user.role, department: user.department, job_title: user.job_title },
    permissions: permissionsFor(user)
  });
});

// Public: complete email verification
r.get('/verify-email/:token', (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE email_verify_token = ?').get(String(req.params.token));
  if (!row) return res.status(400).json({ ok: false, error: 'Invalid or already-used verification link' });
  db.prepare('UPDATE users SET email_verified = 1, email_verify_token = NULL WHERE id = ?').run(row.id);
  audit(req, 'email_verified', 'users', row.id, row.email);
  res.json({ ok: true, message: `Email verified for ${row.email}. You can sign in now.` });
});

// Public: resend verification (never reveals whether the account exists)
r.post('/resend-verification', async (req, res) => {
  const { email } = req.body || {};
  if (!email || !mailer.validSyntax(email)) return res.json({ ok: true });
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?) AND active = 1 AND COALESCE(email_verified,0) = 0').get(String(email).trim());
  if (!user) return res.json({ ok: true });
  const sentAt = user.email_verify_sent_at ? new Date(user.email_verify_sent_at).getTime() : 0;
  if (Date.now() - sentAt < 60000) return res.json({ ok: true });
  const token = require('../utils').randomToken(24);
  db.prepare('UPDATE users SET email_verify_token = ?, email_verify_sent_at = ? WHERE id = ?')
    .run(token, new Date().toISOString(), user.id);
  try { await mailer.sendVerificationEmail(user, token); } catch {}
  res.json({ ok: true });
});

function permissionsFor(user) {
  const perms = {};
  for (const [key, m] of Object.entries(MODULES)) {
    perms[key] = {
      title: m.title,
      read: m.perms.read === 'all' || (Array.isArray(m.perms.read) && m.perms.read.includes(user.role)),
      create: can(user, m, 'create'),
      update: can(user, m, 'update'),
      delete: can(user, m, 'delete'),
      approve: m.approveRole ? m.approveRole.includes(user.role) : false
    };
  }
  return perms;
}

r.get('/me', authRequired, (req, res) => {
  const user = db.prepare('SELECT id, name, email, role, department, job_title, phone, last_login, active FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: { ...user, roleLabel: ROLE_LABELS[user.role] || user.role }, permissions: permissionsFor(user), roles: ROLES.map(x => ({ id: x, label: ROLE_LABELS[x] })) });
});

r.post('/change-password', authRequired, (req, res) => {
  const { current, next } = req.body || {};
  if (!current || !next) return res.status(400).json({ error: 'Current and new password required' });
  const policyOk = sec.passwordOk(next);
  if (!policyOk) return res.status(400).json({ error: `Password policy not met (${sec.PASSWORD_RULES})` });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current, user.password_hash)) return res.status(401).json({ error: 'Current password is incorrect' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(next, 10), user.id);
  // Revoke every existing session, then keep the current device signed in with a fresh token.
  sec.bumpTokenVersion(user.id);
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  audit(req, 'change_password', 'users', user.id, user.name);
  res.json({ ok: true, token: sign(fresh) });
});

// Module metadata for the generic client (schema-as-a-service)
r.get('/meta', authRequired, (req, res) => {
  const out = {};
  for (const [key, m] of Object.entries(MODULES)) {
    if (key === 'actions') continue;
    const p = m.perms;
    const readable = p.read === 'all' || (Array.isArray(p.read) && p.read.includes(req.user.role));
    if (!readable) continue;
    const childCollections = [];
    const addChild = c => childCollections.push({ key: c.key || c.table, label: c.label, fields: c.fields, statuses: c.statuses || null, readOnly: !!c.readOnly });
    if (m.child) addChild(m.child);
    if (m.children) m.children.forEach(addChild);
    out[key] = {
      title: m.title, desc: m.desc, icon: m.icon, prefix: m.prefix,
      list: m.list, fields: m.fields, statuses: m.statuses,
      transitions: m.transitions || null, statusesWorkflow: !!m.transitions,
      dueField: m.dueField || null, dueFields: m.dueFields || null,
      childCollections,
      can: {
        create: can(req.user, m, 'create'), update: can(req.user, m, 'update'),
        delete: can(req.user, m, 'delete'), approve: m.approveRole ? m.approveRole.includes(req.user.role) : false
      }
    };
  }
  res.json({ modules: out, org: require('../config').org });
});

/* ---------------- Two-factor authentication (self-service) ---------------- */
r.get('/2fa/status', authRequired, (req, res) => {
  const u = db.prepare('SELECT COALESCE(totp_enabled,0) AS enabled FROM users WHERE id = ?').get(req.user.id);
  res.json({ enabled: !!u.enabled });
});

// Step 1: generate a secret for this account (not active until confirmed with a valid code)
r.post('/2fa/setup', authRequired, (req, res) => {
  const secret = totp.generateSecret();
  db.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?').run(secret, req.user.id);
  audit(req, '2fa_setup_started', 'users', req.user.id, req.user.email);
  res.json({ secret, uri: totp.otpauthUri(req.user.email, secret), instructions: 'Add this key in your authenticator app (Google Authenticator, Microsoft Authenticator, Authy…): choose "Enter a setup key", paste the secret, then confirm below with the 6-digit code it shows.' });
});

// Step 2: confirm a live code → activates 2FA and issues one-time backup codes
r.post('/2fa/enable', authRequired, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user.totp_secret) return res.status(400).json({ error: 'Run setup first' });
  if (user.totp_enabled) return res.status(400).json({ error: 'Two-factor authentication is already enabled' });
  if (!totp.verify(user.totp_secret, (req.body || {}).code)) {
    audit(req, '2fa_enable_failed', 'users', user.id, user.email);
    return res.status(400).json({ error: 'That code is not correct — check your authenticator app and try again.' });
  }
  const codes = totp.generateBackupCodes(8);
  const hashes = codes.map(c => crypto.createHash('sha256').update(c).digest('hex'));
  db.prepare('UPDATE users SET totp_enabled = 1, backup_codes = ? WHERE id = ?').run(JSON.stringify(hashes), user.id);
  audit(req, '2fa_enabled', 'users', user.id, user.email);
  res.json({ ok: true, backupCodes: codes, note: 'Store these backup codes somewhere safe. Each works once if you lose your authenticator device.' });
});

// Disable 2FA — requires password confirmation
r.post('/2fa/disable', authRequired, (req, res) => {
  const { password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!password || !bcrypt.compareSync(password, user.password_hash)) {
    audit(req, '2fa_disable_failed', 'users', user.id, user.email);
    return res.status(401).json({ error: 'Password confirmation failed' });
  }
  db.prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0, backup_codes = NULL WHERE id = ?').run(user.id);
  audit(req, '2fa_disabled', 'users', user.id, user.email);
  res.json({ ok: true });
});

// Reference pickers
const REF_TABLES = {
  users: { sql: 'SELECT id, name AS label FROM users WHERE active = 1 ORDER BY name', hint: 'user' },
  employees: { sql: 'SELECT id, name AS label FROM employees WHERE status = \'active\' ORDER BY name', hint: 'employee' },
  suppliers: { sql: 'SELECT id, name AS label FROM suppliers ORDER BY name', hint: 'supplier' },
  policies: { sql: 'SELECT id, code || \' · \' || title AS label FROM policies ORDER BY code', hint: 'policy' },
  documents: { sql: 'SELECT id, code || \' · \' || title AS label FROM documents ORDER BY code', hint: 'document' },
  equipment: { sql: 'SELECT id, code || \' · \' || name AS label FROM equipment ORDER BY code', hint: 'equipment' },
  trainings: { sql: 'SELECT id, code || \' · \' || title AS label FROM trainings ORDER BY code', hint: 'training' },
  competencies: { sql: 'SELECT id, code || \' · \' || name AS label FROM competencies ORDER BY code', hint: 'competency' },
  audits: { sql: 'SELECT id, code || \' · \' || title AS label FROM audits ORDER BY code', hint: 'audit' },
  nonconformances: { sql: 'SELECT id, code || \' · \' || title AS label FROM nonconformances ORDER BY code', hint: 'nc' }
};
r.get('/refs/:table', authRequired, (req, res) => {
  const t = REF_TABLES[req.params.table];
  if (!t) return res.status(404).json({ error: 'Unknown reference' });
  res.json(db.prepare(t.sql).all());
});

module.exports = r;
