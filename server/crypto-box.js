// Encryption-at-rest utilities: AES-256-GCM with a managed master key.
// Used for uploaded attachments and database backups.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAGIC = Buffer.from('QENC0100'); // marks our encrypted container format
const config = require('./config');

let cachedKey = null;

function masterKey() {
  if (cachedKey) return cachedKey;
  const keyFile = path.join(config.dataDir, 'file.key');
  if (!fs.existsSync(keyFile)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    try { fs.chmodSync(keyFile, 0o600); } catch {}
  }
  cachedKey = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex');
  return cachedKey;
}

function isEncrypted(buf) {
  return buf && buf.length > MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

function encrypt(plainBuf, key) {
  const k = key || masterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
  const enc = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, enc]);
}

function decrypt(encBuf, key) {
  if (!isEncrypted(encBuf)) return encBuf; // legacy plaintext passthrough
  const k = key || masterKey();
  const iv = encBuf.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = encBuf.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encBuf.subarray(MAGIC.length + 28)), decipher.final()]);
}

module.exports = { masterKey, encrypt, decrypt, isEncrypted, MAGIC };
