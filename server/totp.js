// TOTP (time-based one-time passwords) — Google Authenticator / Microsoft Authenticator compatible.
// Implemented with Node's built-in crypto: no external dependencies.
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHABET[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(val << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, val = 0;
  const out = [];
  for (const c of clean) {
    const idx = ALPHABET.indexOf(c);
    if (idx < 0) continue;
    val = (val << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secretBuf, counter) {
  const cnt = Buffer.alloc(8);
  cnt.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  cnt.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', secretBuf).update(cnt).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 1000000).padStart(6, '0');
}

function currentCode(secret, offsetSteps = 0) {
  return hotp(base32Decode(secret), Math.floor(Date.now() / 30000) + offsetSteps);
}

// Verifies a code allowing ±1 time-step of clock drift.
function verify(secret, token, window = 1) {
  const clean = String(token || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  const counter = Math.floor(Date.now() / 30000);
  const secretBuf = base32Decode(secret);
  for (let i = -window; i <= window; i++) {
    if (hotp(secretBuf, counter + i) === clean) return true;
  }
  return false;
}

function otpauthUri(label, secret, issuer = 'QualiCore') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// Human-friendly backup codes (shown once, stored hashed)
function generateBackupCodes(n = 8) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no confusing l/I/1/O/0
  const codes = [];
  for (let i = 0; i < n; i++) {
    let c = '';
    for (let j = 0; j < 8; j++) c += chars[crypto.randomInt(chars.length)];
    codes.push(`${c.slice(0, 4)}-${c.slice(4)}`);
  }
  return codes;
}

module.exports = { generateSecret, verify, currentCode, otpauthUri, generateBackupCodes, base32Decode };
