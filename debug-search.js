// Debug: check search endpoint response shape
const http = require('http');
function req(path, token) {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:4000' + path, { headers: token ? { Authorization: 'Bearer ' + token } : {} }, res => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve({ raw: b }); } });
    }).on('error', reject);
  });
}
(async () => {
  const loginData = JSON.stringify({ email: 'admin@qms.io', password: 'Admin123!' });
  const token = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port: 4000, path: '/api/auth/login', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': loginData.length } }, res => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => resolve(JSON.parse(b).token));
    });
    req.on('error', reject); req.write(loginData); req.end();
  });
  const s = await req('/api/search?q=calibration', token);
  console.log('response keys:', Object.keys(s));
  console.log('groups type:', typeof s.groups, Array.isArray(s.groups));
  if (s.groups) console.log('groups count:', s.groups.length);
  if (s.groups && s.groups.length) s.groups.forEach(g => console.log(' ', g.moduleTitle || g.module, g.rows ? g.rows.length : 'no rows'));
  else console.log('full response:', JSON.stringify(s).slice(0, 300));
})();
