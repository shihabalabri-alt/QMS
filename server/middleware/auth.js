const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');

function sign(user) {
  const tvRow = db.prepare('SELECT COALESCE(token_version, 0) AS tv FROM users WHERE id = ?').get(user.id);
  return jwt.sign({ id: user.id, role: user.role, name: user.name, email: user.email, department: user.department, tv: tvRow ? tvRow.tv : 0 }, config.jwtSecret, { expiresIn: config.jwtExpiry });
}

/* ---- Brute-force protection: per-account + per-IP lockout ---- */
const attempts = new Map(); // key -> { count, firstAt, lockedUntil }
const MAX_ATTEMPTS = 6;
const LOCK_MINUTES = 15;

function attemptKey(req, email) {
  const ip = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  return `ip:${ip}|acct:${String(email || '').toLowerCase()}`;
}

function registerFailure(req, email) {
  const k = attemptKey(req, email);
  const now = Date.now();
  const rec = attempts.get(k) || { count: 0, firstAt: now };
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.lockedUntil = now + LOCK_MINUTES * 60000;
    const u = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(String(email || '').trim());
    if (u) {
      db.prepare('INSERT INTO notifications (user_id, title, body, severity, created_at) VALUES (?,?,?,?,datetime(\'now\'))')
        .run(u.id, 'Security alert: sign-in attempts', `Multiple failed sign-in attempts were made for your account. It is temporarily locked for ${LOCK_MINUTES} minutes.`, 'critical');
      try { require('./audit').audit(req, 'account_locked', 'users', u.id, String(email)); } catch {}
    }
  }
  attempts.set(k, rec);
  return rec;
}
function clearFailures(email) { attempts.delete(attemptKey({ headers: {}, ip: 'internal' }, email)); }
function isLocked(req, email) {
  const rec = attempts.get(attemptKey(req, email));
  if (!rec) return false;
  if (rec.lockedUntil && Date.now() < rec.lockedUntil) return true;
  // reset window after 15 quiet minutes
  if (!rec.lockedUntil && Date.now() - rec.firstAt > LOCK_MINUTES * 60000) { attempts.delete(attemptKey(req, email)); return false; }
  return false;
}

/* ---- Simple fixed-window API rate limiter ---- */
const buckets = new Map();
function rateLimit({ windowMs = 60000, max = 300, name = 'api' } = {}) {
  return (req, res, next) => {
    const ip = (req.headers['x-forwarded-for'] || req.ip || 'x').split(',')[0].trim();
    const key = `${name}:${ip}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now - b.start > windowMs) { b = { start: now, count: 0 }; buckets.set(key, b); }
    b.count += 1;
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - b.count));
    if (b.count > max) return res.status(429).json({ error: 'Too many requests — slow down.' });
    next();
  };
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    const u = db.prepare('SELECT id, active, COALESCE(token_version, 0) AS tv FROM users WHERE id = ?').get(req.user.id);
    if (!u || !u.active) return res.status(401).json({ error: 'Account disabled' });
    // Token issued before a password change / role change / disable → revoked.
    if ((req.user.tv || 0) !== u.tv) return res.status(401).json({ error: 'Session expired — please sign in again' });
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) { try { req.user = jwt.verify(token, config.jwtSecret); } catch { /* anonymous */ } }
  next();
}

function roleRequired(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}

module.exports = { sign, authRequired, optionalAuth, roleRequired, rateLimit, registerFailure, clearFailures, isLocked };
