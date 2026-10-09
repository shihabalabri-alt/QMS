// Remove the duplicate Source Record block from ActionsPage.jsx
const fs = require('fs');
let s = fs.readFileSync('client/src/pages/ActionsPage.jsx', 'utf8');

const MARKER = 'links back to the exact';
const first = s.indexOf(MARKER);
const second = s.indexOf(MARKER, first + 10);
const desc = s.indexOf('{focusRow.row.description', second);

if (first < 0) { console.log('no marker found'); process.exit(1); }
if (second < 0 || desc < 0) { console.log('no duplicate found — nothing to remove'); process.exit(0); }

s = s.slice(0, second) + s.slice(desc);
fs.writeFileSync('client/src/pages/ActionsPage.jsx', s);
const count = (s.match(new RegExp(MARKER, 'g')) || []).length;
console.log('duplicate removed. Source Record blocks remaining:', count);
