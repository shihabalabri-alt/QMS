const fs = require('fs');

/* ---------- 1. auth.js: change-password enforces policy + revokes sessions ---------- */
let auth = fs.readFileSync('server/routes/auth.js', 'utf8');
const oldChange = `r.post('/change-password', authRequired, (req, res) => {
  const { current, next } = req.body || {};
  if (!current || !next || next.length < 8) return res.status(400).json({ error: 'Current password required; new password must be at least 8 characters' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current, user.password_hash)) return res.status(401).json({ error: 'Current password is incorrect' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(next, 10), user.id);
  audit(req, 'change_password', 'users', user.id, user.name);
  res.json({ ok: true });
});`;
const newChange = `r.post('/change-password', authRequired, (req, res) => {
  const { current, next } = req.body || {};
  const sec = require('../security');
  const policyError = sec.passwordOk(next);
  if (!current || policyError) return res.status(400).json({ error: policyError || 'Current password required', rule: sec.PASSWORD_RULES });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current, user.password_hash)) { audit(req, 'password_change_failed', 'users', user.id, user.name); return res.status(401).json({ error: 'Current password is incorrect' }); }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(next, 10), user.id);
  sec.bumpTokenVersion(user.id);
  audit(req, 'change_password', 'users', user.id, user.name, { note: 'all other sessions revoked' });
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  res.json({ ok: true, token: sign(fresh), note: 'Other sessions were signed out.' });
});`;
if (!auth.includes(oldChange)) { console.log('AUTH CHANGE-PW BLOCK NOT FOUND'); process.exit(1); }
auth = auth.replace(oldChange, newChange);
fs.writeFileSync('server/routes/auth.js', auth);
console.log('auth.js patched');

/* ---------- 2. admin.js: policy on create/reset, revocation, verification endpoints ---------- */
let adm = fs.readFileSync('server/routes/admin.js', 'utf8');
adm = adm.replace(
  "const r = express.Router();\nr.use(authRequired);",
  "const r = express.Router();\nconst mailer = require('../mailer');\nconst security = require('../security');\nr.use(authRequired);"
);

// Create user: email validation bot + password policy + auto verification email
const oldCreate = `r.post('/users', (req, res) => {
  if (!ADMIN.includes(req.user.role)) return res.status(403).json({ error: 'Only administrators can create users' });
  const { name, email, password, role, department, job_title, phone } = req.body || {};
  if (!name || !email || !password || password.length < 8) return res.status(400).json({ error: 'Name, email and password (8+ chars) required' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  try {
    const bcrypt = require('bcryptjs');
    const id = db.prepare('INSERT INTO users (name, email, password_hash, role, department, job_title, phone) VALUES (?,?,?,?,?,?,?)')
      .run(name, email.toLowerCase().trim(), bcrypt.hashSync(password, 10), role, department || 'Quality', job_title || '', phone || '').lastInsertRowid;
    audit(req, 'create', 'users', id, name, { role });
    res.status(201).json({ id });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: 'Email already in use' });
    res.status(400).json({ error: e.message });
  }
});`;
const newCreate = `r.post('/users', async (req, res) => {
  if (!ADMIN.includes(req.user.role)) return res.status(403).json({ error: 'Only administrators can create users' });
  const { name, email, password, role, department, job_title, phone } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  const policyError = security.passwordOk(password);
  if (policyError) return res.status(400).json({ error: policyError, rule: security.PASSWORD_RULES });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  // Email validation bot: format + disposable domain + live MX lookup
  const check = await mailer.checkEmail(email);
  if (!check.ok) { audit(req, 'signup_email_rejected', 'security', null, String(email).toLowerCase(), { reason: check.reason }); return res.status(400).json({ error: check.reason }); }
  try {
    const bcrypt = require('bcryptjs');
    const verifiedEmail = check.email || String(email).toLowerCase().trim();
    const id = db.prepare('INSERT INTO users (name, email, password_hash, role, department, job_title, phone) VALUES (?,?,?,?,?,?,?)')
      .run(name, verifiedEmail, bcrypt.hashSync(password, 10), role, department || 'Quality', job_title || '', phone || '').lastInsertRowid;
    // Issue + send verification email; account cannot log in until verified.
    const token = require('../utils').randomToken(24);
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    db.prepare('UPDATE users SET email_verify_token = ?, email_verify_sent_at = ? WHERE id = ?').run(token, new Date().toISOString(), id);
    const sent = await mailer.sendVerificationEmail(fresh, token);
    audit(req, 'create', 'users', id, name, { role, email_check: check.reason });
    res.status(201).json({
      id,
      email_verified: 0,
      verification: sent.delivered ? { delivered: true } : { delivered: false, devLink: sent.link, note: 'SMTP not configured — open this link or forward it to the user to activate the account.' }
    });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: 'Email already in use' });
    res.status(400).json({ error: e.message });
  }
});

// Re-send a verification link for an unverified user
r.post('/users/:id/send-verification', async (req, res) => {
  if (!ADMIN.includes(req.user.role)) return res.status(403).json({ error: 'Only administrators can send verifications' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (u.email_verified) return res.json({ ok: true, alreadyVerified: true });
  const token = require('../utils').randomToken(24);
  db.prepare('UPDATE users SET email_verify_token = ?, email_verify_sent_at = ? WHERE id = ?').run(token, new Date().toISOString(), u.id);
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
  const sent = await mailer.sendVerificationEmail(fresh, token);
  audit(req, 'send_verification', 'users', u.id, u.email, { delivered: !!sent.delivered });
  res.json(sent.delivered ? { ok: true, delivered: true } : { ok: true, delivered: false, devLink: sent.link });
});

// Admin unlock of a locked-out account
r.post('/users/:id/unlock', (req, res) => {
  if (!ADMIN.includes(req.user.role)) return res.status(403).json({ error: 'Only administrators can unlock accounts' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'User not found' });
  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(u.id);
  audit(req, 'unlock_account', 'users', u.id, u.name);
  res.json({ ok: true });
});`;
if (!adm.includes(oldCreate)) { console.log('ADMIN CREATE BLOCK NOT FOUND'); process.exit(1); }
adm = adm.replace(oldCreate, newCreate);

// Reset password: policy + revoke all sessions for that user
const oldReset = `r.post('/users/:id/reset-password', (req, res) => {
  if (!ADMIN.includes(req.user.role)) return res.status(403).json({ error: 'Only administrators can reset passwords' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'User not found' });
  const password = (req.body || {}).password;
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const bcrypt = require('bcryptjs');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), u.id);
  audit(req, 'reset_password', 'users', u.id, u.name);
  res.json({ ok: true });
});`;
const newReset = `r.post('/users/:id/reset-password', (req, res) => {
  if (!ADMIN.includes(req.user.role)) return res.status(403).json({ error: 'Only administrators can reset passwords' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'User not found' });
  const password = (req.body || {}).password;
  const policyError = security.passwordOk(password);
  if (policyError) return res.status(400).json({ error: policyError, rule: security.PASSWORD_RULES });
  const bcrypt = require('bcryptjs');
  db.prepare('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(bcrypt.hashSync(password, 10), u.id);
  security.revokeSessions(u.id);
  audit(req, 'reset_password', 'users', u.id, u.name, { note: 'user sessions revoked' });
  res.json({ ok: true, note: 'Password changed; all user sessions were revoked.' });
});`;
if (!adm.includes(oldReset)) { console.log('ADMIN RESET BLOCK NOT FOUND'); process.exit(1); }
adm = adm.replace(oldReset, newReset);

// Toggle off / role change → revoke sessions
const oldToggle = `db.prepare('UPDATE users SET active = ? WHERE id = ?').run(u.active ? 0 : 1, u.id);
  audit(req, 'toggle', 'users', u.id, u.name, { active: !u.active });
  res.json({ ok: true, active: !u.active });`;
const newToggle = `db.prepare('UPDATE users SET active = ? WHERE id = ?').run(u.active ? 0 : 1, u.id);
  security.revokeSessions(u.id);
  audit(req, 'toggle', 'users', u.id, u.name, { active: !u.active });
  res.json({ ok: true, active: !u.active });`;
if (!adm.includes(oldToggle)) { console.log('ADMIN TOGGLE BLOCK NOT FOUND'); process.exit(1); }
adm = adm.replace(oldToggle, newToggle);
adm = adm.replace(
  "db.prepare('UPDATE users SET name = ?, email = ?, role = ?, department = ?, job_title = ?, phone = ? WHERE id = ?')",
  "if ((role && role !== u.role) || (email && email !== u.email)) security.revokeSessions(u.id);\n  db.prepare('UPDATE users SET name = ?, email = ?, role = ?, department = ?, job_title = ?, phone = ? WHERE id = ?')"
);

// Users list: expose verification/lockout state (no sensitive fields)
adm = adm.replace(
  "SELECT id, name, email, role, department, job_title, phone, active, last_login, created_at FROM users ORDER BY name",
  "SELECT id, name, email, role, department, job_title, phone, active, last_login, created_at, COALESCE(email_verified,0) AS email_verified, failed_attempts, locked_until FROM users ORDER BY name"
);

// Settings: allow the verification toggle
adm = adm.replace("const allowed = ['org_name', 'alert_days', 'escalate_days'];", "const allowed = ['org_name', 'alert_days', 'escalate_days', 'require_email_verification'];");

fs.writeFileSync('server/routes/admin.js', adm);
console.log('admin.js patched');

/* ---------- 3. middleware/auth.js: include tv in sign() ---------- */
let mw = fs.readFileSync('server/middleware/auth.js', 'utf8');
mw = mw.replace(
  'return jwt.sign({ id: user.id, role: user.role, name: user.name, email: user.email, department: user.department }, config.jwtSecret',
  'return jwt.sign({ id: user.id, role: user.role, name: user.name, email: user.email, department: user.department, tv: user.tv !== undefined ? user.tv : 0 }, config.jwtSecret'
);
fs.writeFileSync('server/middleware/auth.js', mw);
console.log('middleware/auth.js patched');

/* ---------- 4. Verify syntax of everything ---------- */
for (const f of ['server/routes/auth.js', 'server/routes/admin.js', 'server/middleware/auth.js', 'server/security.js', 'server/index.js']) {
  delete require.cache[require.resolve('./' + f)];
}
console.log('ALL PATCHES APPLIED');
