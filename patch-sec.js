const fs = require('fs');
let s = fs.readFileSync('server/routes/admin.js', 'utf8');

// 1. Require mailer + security at top (after existing requires)
if (!s.includes("require('../mailer')")) {
  s = s.replace("const { nowIso } = require('../utils');",
    "const { nowIso } = require('../utils');\nconst mailer = require('../mailer');\nconst sec = require('../security');");
}

// 2. Users list: include verification + lockout status
s = s.replace(
  "SELECT id, name, email, role, department, job_title, phone, active, last_login, created_at FROM users ORDER BY name",
  "SELECT id, name, email, role, department, job_title, phone, active, last_login, created_at, COALESCE(email_verified,0) AS email_verified, locked_until, failed_attempts FROM users ORDER BY name"
);

// 3. Create user: validate email bot + password policy + send verification
const oldCreate = `  try {
    const bcrypt = require('bcryptjs');
    const id = db.prepare('INSERT INTO users (name, email, password_hash, role, department, job_title, phone) VALUES (?,?,?,?,?,?,?)')
      .run(name, email.toLowerCase().trim(), bcrypt.hashSync(password, 10), role, department || 'Quality', job_title || '', phone || '').lastInsertRowid;
    audit(req, 'create', 'users', id, name, { role });
    res.status(201).json({ id });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: 'Email already in use' });
    res.status(400).json({ error: e.message });
  }`;
const newCreate = `  // Email validation bot: format + disposable domains + live MX lookup
  const check = await mailer.checkEmail(email);
  if (!check.ok) return res.status(400).json({ error: 'Email rejected: ' + check.reason });
  const pwFail = sec.passwordOk(password);
  if (pwFail) return res.status(400).json({ error: pwFail + ' (' + sec.PASSWORD_RULES + ')' });
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
  }`;
if (!s.includes(oldCreate)) { console.log('CREATE BLOCK NOT FOUND'); process.exit(1); }
s = s.replace(oldCreate, newCreate);

// 4. Make the create handler async
s = s.replace("r.post('/users', (req, res) => {", "r.post('/users', async (req, res) => {");

// 5. Reset password: policy + revoke sessions + clear lockout
s = s.replace(
  "  const password = (req.body || {}).password;\n  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });\n  const bcrypt = require('bcryptjs');\n  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), u.id);\n  audit(req, 'reset_password', 'users', u.id, u.name);\n  res.json({ ok: true });",
  "  const password = (req.body || {}).password;\n  const pwFail = sec.passwordOk(password);\n  if (pwFail) return res.status(400).json({ error: pwFail + ' (' + sec.PASSWORD_RULES + ')' });\n  const bcrypt = require('bcryptjs');\n  db.prepare('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(bcrypt.hashSync(password, 10), u.id);\n  sec.bumpTokenVersion(u.id); // sign out everywhere\n  audit(req, 'reset_password', 'users', u.id, u.name);\n  res.json({ ok: true });"
);

// 6. Toggle: revoking sessions when disabling an account
s = s.replace(
  "  db.prepare('UPDATE users SET active = ? WHERE id = ?').run(u.active ? 0 : 1, u.id);\n  audit(req, 'toggle', 'users', u.id, u.name, { active: !u.active });",
  "  db.prepare('UPDATE users SET active = ? WHERE id = ?').run(u.active ? 0 : 1, u.id);\n  if (u.active) sec.bumpTokenVersion(u.id); // kill sessions of disabled accounts\n  audit(req, 'toggle', 'users', u.id, u.name, { active: !u.active });"
);

// 7. Send-verification endpoint (before module.exports)
if (!s.includes('send-verification')) {
  s = s.replace("module.exports = r;", `r.post('/users/:id/send-verification', async (req, res) => {
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

module.exports = r;`);
}

fs.writeFileSync('server/routes/admin.js', s);
console.log('admin.js hardened OK');
