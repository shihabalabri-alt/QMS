// Test notification badge: exact count, live updates, persistence
const db = require('./db.js');
const http = require('http');
const BASE = 'http://localhost:4000';

function req(method, p, token, body) {
  return new Promise((resolve, reject) => {
    const options = { hostname: 'localhost', port: 4000, path: encodeURI(p), method, headers: {} };
    if (token) options.headers.Authorization = 'Bearer ' + token;
    if (body) { options.headers['Content-Type'] = 'application/json'; options.headers['Content-Length'] = Buffer.byteLength(body); }
    const r = http.request(options, res => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(b) }); } catch { resolve({ status: res.statusCode, data: {} }); } });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

(async () => {
  let pass = 0, fail = 0;
  const ok = (name, cond) => { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name); } };

  const login = await req('POST', '/api/auth/login', null, JSON.stringify({ email: 'qm@qms.io', password: 'Qm12345!' }));
  const T = login.data.token;
  ok('login works', login.status === 200);

  // Clean slate
  await req('POST', '/api/notifications/read-all', T);
  let n = await req('GET', '/api/notifications?limit=1', T);
  const start = n.data.unread;
  console.log('  Starting unread:', start);

  const now = new Date().toISOString();
  const ids = [];
  for (let i = 0; i < 5; i++) {
    const id = db.prepare('INSERT INTO notifications (user_id, title, body, link, severity, category, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(login.data.user.id, 'Badge test ' + i, 'Body', '/actions', 'info', 'actions', now).lastInsertRowid;
    ids.push(id);
  }
  n = await req('GET', '/api/notifications?limit=1', T);
  ok('5 created → unread = ' + (start + 5), n.data.unread === start + 5);

  await req('POST', '/api/notifications/' + ids[0] + '/read', T);
  n = await req('GET', '/api/notifications?limit=1', T);
  ok('Read 1 → unread = ' + (start + 4), n.data.unread === start + 4);

  await req('POST', '/api/notifications/read-all', T);
  n = await req('GET', '/api/notifications?limit=1', T);
  ok('Read all → unread = 0', n.data.unread === 0);

  // 12 unread (tests the 9+ bug)
  const ids2 = [];
  for (let i = 0; i < 12; i++) {
    const id = db.prepare('INSERT INTO notifications (user_id, title, body, link, severity, category, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(login.data.user.id, 'Bulk test ' + i, 'Body', '/risks', 'warning', 'risks', now).lastInsertRowid;
    ids2.push(id);
  }
  n = await req('GET', '/api/notifications?limit=1', T);
  ok('12 created → unread = 12 (exact, not 9+)', n.data.unread === 12);

  // Clean up test notifications
  for (const id of ids) db.prepare('DELETE FROM notifications WHERE id = ?').run(id);
  for (const id of ids2) db.prepare('DELETE FROM notifications WHERE id = ?').run(id);
  n = await req('GET', '/api/notifications?limit=1', T);
  console.log('  Final unread after cleanup:', n.data.unread);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
