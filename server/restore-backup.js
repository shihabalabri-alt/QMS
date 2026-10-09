// Restore an encrypted QualiCore database backup.
// Usage:  node server/restore-backup.js <backup-file.db.enc> [output-path]
// STOP THE SERVER FIRST (otherwise changes since the backup are lost).
const fs = require('fs');
const path = require('path');

const src = process.argv[2];
if (!src) { console.log('Usage: node server/restore-backup.js <backup-file.db.enc> [output]'); process.exit(1); }
const out = process.argv[3] || path.join(__dirname, 'data', 'qms-restored.db');
const box = require('./crypto-box');

try {
  const enc = fs.readFileSync(path.resolve(src));
  const plain = box.decrypt(enc);
  fs.writeFileSync(out, plain);
  console.log(`Restored to: ${out}`);
  console.log('To use it: stop the server, replace server/data/qms.db with this file, restart.');
} catch (e) {
  console.error('Restore failed:', e.message);
  process.exit(1);
}
