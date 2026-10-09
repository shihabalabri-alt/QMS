// Email validation bot + verification sender.
// Blocks fake signups three ways: syntax, disposable domains, live MX lookup.
const nodemailer = require('nodemailer');
const dns = require('dns').promises;
const db = require('./db');

const DISPOSABLE = new Set([
  'mailinator.com', 'tempmail.com', 'temp-mail.org', '10minutemail.com', 'guerrillamail.com',
  'yopmail.com', 'trashmail.com', 'throwawaymail.com', 'getnada.com', 'dispostable.com',
  'sharklasers.com', 'grr.la', 'mytemp.email', 'fakeinbox.com', 'maildrop.cc', 'mohmal.com',
  'emailondeck.com', 'tempr.email', 'spam4.me', '1secmail.com', 'moakt.com', 'tmpmail.org'
]);

function validSyntax(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || '').trim());
}

async function checkEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!validSyntax(e)) return { ok: false, reason: 'Invalid email format' };
  const domain = e.split('@')[1];
  if (DISPOSABLE.has(domain)) return { ok: false, reason: `Disposable email domain "${domain}" is not allowed` };
  try {
    const mx = await dns.resolveMx(domain);
    if (!mx || !mx.length) {
      // fallback: some domains accept mail via A record
      try {
        const a = await dns.resolve4(domain);
        if (!a || !a.length) return { ok: false, reason: `Domain "${domain}" cannot receive email (no mail servers)` };
      } catch { return { ok: false, reason: `Domain "${domain}" does not exist or cannot receive email` }; }
    }
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'NXDOMAIN') return { ok: false, reason: `Domain "${domain}" does not exist` };
    // Offline / DNS blocked: don't hard-fail, verification email remains the real gate
    return { ok: true, reason: 'Domain could not be checked offline; email verification still required' };
  }
  return { ok: true, reason: 'Valid' };
}

const smtpConfigured = () => !!(process.env.SMTP_HOST && process.env.SMTP_PORT);
let transporter = null;
function getTransporter() {
  if (!smtpConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
    });
  }
  return transporter;
}
function appUrl() {
  return process.env.APP_URL || 'http://localhost:4000';
}

async function sendVerificationEmail(user, token) {
  const link = `${appUrl()}/verify-email/${token}`;
  const t = getTransporter();
  const orgName = (db.prepare("SELECT value FROM settings WHERE key = 'org_name'").get() || {}).value || 'QualiCore';
  if (t) {
    await t.sendMail({
      from: process.env.SMTP_FROM || 'QMS <no-reply@qms.local>',
      to: user.email,
      subject: `${orgName}: verify your email address`,
      text: `Hello ${user.name},\n\nVerify your QMS account by opening this link:\n${link}\n\nThe link is valid until used. If you did not expect this email, contact your administrator.`,
      html: `<p>Hello <b>${user.name}</b>,</p><p>Verify your QMS account by clicking the button below:</p>
             <p><a href="${link}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Verify my email</a></p>
             <p>Or paste this link into your browser:<br>${link}</p>
             <p style="color:#888;font-size:12px">If you did not expect this email, contact your administrator.</p>`
    });
    return { delivered: true, link };
  }
  // Dev mode without SMTP: persist + log so admins can complete verification manually
  console.log(`[mailer] SMTP not configured. Verification link for ${user.email}:\n  ${link}`);
  return { delivered: false, link };
}

module.exports = { checkEmail, sendVerificationEmail, smtpConfigured, appUrl, DISPOSABLE };
