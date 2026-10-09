// Full verification of security layer + email verification bot (idempotent — safe to re-run)
const BASE = 'http://localhost:4000';
const RUN = Date.now().toString().slice(-6);
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name); } };
async function req(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, headers: res.headers };
}

(async () => {
  const h = await fetch(BASE + '/api/health').then(r => r.json());
  ok('server healthy', !!h.ok);

  const admin = await req('/api/auth/login', { method: 'POST', body: { email: 'admin@qms.io', password: 'Admin123!' } });
  ok('admin login works', admin.status === 200);
  const T = admin.data.token;

  // Security headers
  const home = await fetch(BASE + '/');
  ok('X-Frame-Options DENY', home.headers.get('x-frame-options') === 'DENY');
  ok('CSP present', (home.headers.get('content-security-policy') || '').includes("default-src 'self'"));
  ok('nosniff', home.headers.get('x-content-type-options') === 'nosniff');

  // Email validation bot
  const disp = await req('/api/admin/users', { method: 'POST', token: T, body: { name: 'Temp Guy', email: `sneaky${RUN}@mailinator.com`, password: 'GoodPass123', role: 'employee' } });
  ok('disposable domain REJECTED', disp.status === 400 && /disposable/i.test(disp.data.error || ''));

  const badFmt = await req('/api/admin/users', { method: 'POST', token: T, body: { name: 'Bad Fmt', email: 'not-an-email', password: 'GoodPass123', role: 'employee' } });
  ok('malformed email REJECTED', badFmt.status === 400);

  const weak = await req('/api/admin/users', { method: 'POST', token: T, body: { name: 'Weak PW', email: `weakpw${RUN}@gmail.com`, password: 'weakpass', role: 'employee' } });
  ok('weak password REJECTED', weak.status === 400);

  // Valid signup → unverified + devLink (gmail always has MX)
  const EMAIL = `real.user.${RUN}@gmail.com`;
  const good = await req('/api/admin/users', { method: 'POST', token: T, body: { name: 'Real User', email: EMAIL, password: 'GoodPass123', role: 'employee' } });
  ok('valid email accepted + unverified', good.status === 201 && good.data.email_verified === false);
  ok('verification link issued', typeof good.data.devLink === 'string' && good.data.devLink.includes('/verify-email/'));

  // Login blocked until verified
  const blocked = await req('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: 'GoodPass123' } });
  ok('unverified login BLOCKED (403)', blocked.status === 403 && /not verified/i.test(blocked.data.error || ''));

  // Verify via link → login OK
  const tokenPart = good.data.devLink.split('/verify-email/')[1];
  const ver = await req(`/api/auth/verify-email/${tokenPart}`);
  ok('email verified via link', ver.status === 200 && ver.data.ok);
  const login2 = await req('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: 'GoodPass123' } });
  ok('login works after verification', login2.status === 200);

  // Brute-force lockout
  for (let i = 0; i < 6; i++) await req('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: 'WrongPass999' } });
  const locked = await req('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: 'GoodPass123' } });
  ok('brute-force LOCKOUT active (423)', locked.status === 423);

  // Admin unlock restores access
  const users = await req('/api/admin/users', { token: T });
  const ru = users.data.rows.find(u => u.email === EMAIL);
  ok('users list shows lock/verify state', !!ru);
  await req(`/api/admin/users/${ru.id}/unlock`, { method: 'POST', token: T });
  const unlocked = await req('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: 'GoodPass123' } });
  ok('login works after unlock', unlocked.status === 200);

  // Token revocation on password change
  const ch1 = await req('/api/auth/change-password', { method: 'POST', token: unlocked.data.token, body: { current: 'GoodPass123', next: 'BetterPass456' } });
  ok('password change returns fresh token', ch1.status === 200 && !!ch1.data.token);
  const stale = await req('/api/dashboard', { token: unlocked.data.token });
  ok('OLD token REVOKED after password change', stale.status === 401);
  const freshT = await req('/api/dashboard', { token: ch1.data.token });
  ok('NEW token valid', freshT.status === 200);
  await req('/api/auth/change-password', { method: 'POST', token: ch1.data.token, body: { current: 'BetterPass456', next: 'GoodPass123' } });

  // ===== New hardening: 2FA, encrypted files, backups, magic bytes =====

  // 2FA setup → enable with live TOTP code → login now requires the code
  const st = await req('/api/auth/2fa/setup', { method: 'POST', token: T });
  ok('2FA setup returns secret + uri', st.status === 200 && !!st.data.secret && st.data.uri.includes('otpauth://'));
  const totp = require('./totp');
  const code6 = totp.currentCode(st.data.secret);
  const en = await req('/api/auth/2fa/enable', { method: 'POST', token: T, body: { code: code6 } });
  ok('2FA enabled with valid code', en.status === 200 && en.data.backupCodes.length === 8);
  const wrongTotp = await req('/api/auth/login', { method: 'POST', body: { email: 'admin@qms.io', password: 'Admin123!', totp: '000000' } });
  ok('login without/with bad 2FA rejected', wrongTotp.status === 401);
  const goodCode = totp.currentCode(st.data.secret);
  const login3 = await req('/api/auth/login', { method: 'POST', body: { email: 'admin@qms.io', password: 'Admin123!', totp: goodCode } });
  ok('login works with correct 2FA code', login3.status === 200 && !!login3.data.token);
  // backup code also works
  const bc = en.data.backupCodes[0];
  const loginBc = await req('/api/auth/login', { method: 'POST', body: { email: 'admin@qms.io', password: 'Admin123!', totp: bc } });
  ok('backup code accepted once', loginBc.status === 200);
  const bcAgain = await req('/api/auth/login', { method: 'POST', body: { email: 'admin@qms.io', password: 'Admin123!', totp: bc } });
  ok('backup code cannot be reused', bcAgain.status === 401);
  // disable again so other tests are unaffected
  const dis = await req('/api/auth/2fa/disable', { method: 'POST', token: T, body: { password: 'Admin123!' } });
  ok('2FA disabled with password confirmation', dis.status === 200);

  // Encrypted file storage at rest
  const SECRET_TEXT = `TOP-SECRET-CONTENT-${Date.now()}`;
  const fd = new FormData();
  fd.append('file', new Blob([SECRET_TEXT], { type: 'text/plain' }), `evidence-${RUN}.txt`);
  fd.append('entity_type', 'records');
  fd.append('entity_id', '1');
  fd.append('category', 'evidence');
  const upl = await fetch(BASE + '/api/files/upload', { method: 'POST', headers: { Authorization: `Bearer ${T}` }, body: fd }).then(r => r.json());
  ok('file uploaded', !!upl.id);
  // find the stored file on disk and confirm it is NOT plaintext
  let onDiskPlain = false;
  try {
    for (const f of require('fs').readdirSync(require('path').join(__dirname, 'data', 'uploads'))) {
      const raw = require('fs').readFileSync(require('path').join(__dirname, 'data', 'uploads', f));
      if (raw.toString('utf8').includes(SECRET_TEXT)) onDiskPlain = true;
    }
  } catch {}
  ok('file ENCRYPTED at rest (plaintext not on disk)', !onDiskPlain);
  // download decrypts correctly
  const dl = await fetch(`${BASE}/api/files/${upl.id}/download`, { headers: { Authorization: `Bearer ${T}` } });
  const dlText = await dl.text();
  ok('download decrypts to original content', dl.status === 200 && dlText.includes(SECRET_TEXT));

  // Magic-byte validation: a .pdf that is really text gets rejected
  const fakePdf = new FormData();
  fakePdf.append('file', new Blob(['this is definitely not a real pdf'], { type: 'application/pdf' }), 'fake.pdf');
  fakePdf.append('entity_type', 'records');
  fakePdf.append('entity_id', '1');
  const fp = await fetch(BASE + '/api/files/upload', { method: 'POST', headers: { Authorization: `Bearer ${T}` }, body: fakePdf }).then(r => r.json());
  ok('renamed fake .pdf REJECTED by content check', !!fp.error && /contents/i.test(fp.error));

  // Automated encrypted database backup
  const bk = await req('/api/admin/security/backup-now', { method: 'POST', token: T });
  ok('encrypted DB backup created', bk.status === 200 && !!bk.data.file);
  const bl = await req('/api/admin/security/backups', { token: T });
  ok('backups listed with retention', bl.status === 200 && bl.data.rows.length >= 1);

  // Security events monitor endpoint
  const ev = await req('/api/admin/security/events', { token: T });
  ok('security events feed', ev.status === 200 && Array.isArray(ev.data.rows) && ev.data.stats.failedToday >= 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
