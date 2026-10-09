// Data-theft protection layer: headers, rate limiting, password policy, token revocation.
const db = require('./db');
const { audit } = require('./middleware/audit');

/* ---------- 1. Security headers (helmet-style, dependency-free) ---------- */
function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'");
  if (process.env.HTTPS === '1') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

/* ---------- 2. Rate limiting (sliding window, per IP) ---------- */
const buckets = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now - b.start > b.windowMs * 2) buckets.delete(k);
}, 60000).unref();

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || req.socket?.remoteAddress || 'unknown';
}

function rateLimit({ windowMs = 60000, max = 240 } = {}) {
  return (req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    const ip = clientIp(req);
    const now = Date.now();
    let b = buckets.get(ip);
    if (!b || now - b.start > b.windowMs) { b = { start: now, count: 0, windowMs }; buckets.set(ip, b); }
    b.count += 1;
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - b.count)));
    if (b.count > max) {
      audit({ user: null, ip }, 'rate_limited', 'security', null, `IP ${ip}`, { path: req.path });
      return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    }
    next();
  };
}
function loginRateLimit(req, res, next) {
  return rateLimit({ windowMs: 15 * 60000, max: 120 })(req, res, next);
}

/* ---------- 3. Account lockout (persistent, per user) ---------- */
const MAX_FAILED = 6;
const LOCK_MINUTES = 15;

function isLocked(user) {
  if (!user.locked_until) return false;
  if (new Date(user.locked_until) > new Date()) return true;
  db.prepare('UPDATE users SET locked_until = NULL, failed_attempts = 0 WHERE id = ?').run(user.id);
  return false;
}

function registerFailedLogin(userId) {
  const u = db.prepare('SELECT failed_attempts FROM users WHERE id = ?').get(userId);
  const attempts = ((u && u.failed_attempts) || 0) + 1;
  if (attempts >= MAX_FAILED) {
    const until = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString();
    db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(attempts, until, userId);
    try {
      db.prepare("INSERT INTO notifications (user_id, title, body, severity, created_at) VALUES (?,?,'','critical',datetime('now'))").run(userId, '');
      db.prepare('DELETE FROM notifications WHERE id = last_insert_rowid()').run();
    } catch {}
    return { locked: true, attempts };
  }
  db.prepare('UPDATE users SET failed_attempts = ? WHERE id = ?').run(attempts, userId);
  return { locked: false, remaining: MAX_FAILED - attempts };
}

function clearLock(userId) {
  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(userId);
}

/* ---------- 4. Password policy ---------- */
// Returns true when the password satisfies the policy.
function passwordOk(pw) {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 128) return false;
  if (!/[a-z]/.test(pw)) return false;
  if (!/[A-Z]/.test(pw)) return false;
  if (!/[0-9]/.test(pw)) return false;
  return true;
}
const PASSWORD_RULES = 'At least 8 characters with uppercase, lowercase and a number';

/* ---------- 4. Token revocation via token_version ---------- */
function bumpTokenVersion(userId) {
  db.prepare('UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?').run(userId);
}

module.exports = { securityHeaders, rateLimit, loginRateLimit, passwordOk, PASSWORD_RULES, bumpTokenVersion, clientIp, isLocked, registerFailedLogin, clearLock };
