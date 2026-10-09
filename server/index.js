const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');

const app = express();
app.disable('x-powered-by');
app.use(cors({
  origin: (origin, cb) => {
    // Same-origin requests send no Origin header. Extra origins allowed via ORIGIN env (comma-separated).
    const allow = (process.env.ORIGIN ? process.env.ORIGIN.split(',') : []).map(s => s.trim());
    if (!origin || allow.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: false
}));
app.use(express.json({ limit: '256kb' }));

// ---- Security layer: headers + rate limiting (data-theft protection) ----
const security = require('./security');
app.use(security.securityHeaders);
app.use('/api', security.rateLimit({ windowMs: 60000, max: 400 }));
app.use('/api/auth/login', security.loginRateLimit);
app.use('/api/auth/resend-verification', security.loginRateLimit);

// Webhook dispatcher: any emitted system event fans out to registered webhooks
const { onEvent } = require('./middleware/audit');
onEvent('*', async payload => {
  const hooks = db.prepare('SELECT * FROM webhooks WHERE active = 1').all();
  for (const w of hooks) {
    const events = (w.events || '').split(',').map(s => s.trim()).filter(Boolean);
    if (events.length && !events.includes(payload.event)) continue;
    try {
      const resp = await fetch(w.url, {
        method: 'POST', timeout: 8000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: payload.event, data: payload, at: new Date().toISOString() })
      });
      db.prepare('INSERT INTO webhook_log (webhook_id, event, status_code, ok) VALUES (?,?,?,?)').run(w.id, payload.event, resp.status, resp.ok ? 1 : 0);
    } catch (e) {
      db.prepare('INSERT INTO webhook_log (webhook_id, event, status_code, ok) VALUES (?,?,?,?)').run(w.id, payload.event, 0, 0);
    }
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'QMS API', time: new Date().toISOString() }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/actions', require('./routes/actions'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/search', require('./routes/search'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/activity', require('./routes/activity'));
app.use('/api/competency-matrix', require('./routes/competency-matrix'));
app.use('/api/impact', require('./routes/impact'));
app.use('/api/inbox', require('./routes/inbox'));
app.use('/api/workflows', require('./routes/workflows'));
app.use('/api/intelligence', require('./routes/intelligence'));
app.use('/api/files', require('./routes/files'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/tracking', require('./routes/document-tracking'));
app.use('/api/routing', require('./routes/document-routing'));

/* ---- External integration API (read-only, X-API-Key) — mounted before generic CRUD ---- */
const v1 = express.Router();
function apiKeyAuth(req, res, next) {
  const key = req.headers['x-api-key'] || (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!key) return res.status(401).json({ error: 'X-API-Key required' });
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const k = db.prepare('SELECT * FROM api_keys WHERE key_hash = ? AND active = 1').get(hash);
  if (!k) return res.status(401).json({ error: 'Invalid API key' });
  db.prepare('UPDATE api_keys SET last_used = ? WHERE id = ?').run(new Date().toISOString(), k.id);
  req.apiKey = k;
  next();
}
const { MODULES } = require('./modules');
v1.get('/:module', apiKeyAuth, (req, res) => {
  const m = MODULES[req.params.module];
  if (!m) return res.status(404).json({ error: 'Unknown module. Available: ' + Object.keys(MODULES).join(', ') });
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const rows = db.prepare(`SELECT * FROM ${m.table} ORDER BY id DESC LIMIT ?`).all(limit);
  res.json({ module: req.params.module, count: rows.length, rows });
});
v1.get('/:module/:id', apiKeyAuth, (req, res) => {
  const m = MODULES[req.params.module];
  if (!m) return res.status(404).json({ error: 'Unknown module' });
  const row = db.prepare(`SELECT * FROM ${m.table} WHERE id = ? OR code = ?`).get(req.params.id, String(req.params.id).toUpperCase());
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ module: req.params.module, row });
});
app.use('/api/v1', v1);
app.use('/api/pdf', require('./routes/pdf'));
app.use('/api/links', require('./routes/links'));
app.use('/api/activity', require('./routes/activity'));
app.use('/api', require('./routes/crud'));

// Client static build
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`QMS API listening on http://localhost:${config.port}`);
    require('./jobs').start();
  });
}

module.exports = app;
