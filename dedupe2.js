// Remove duplicate resolveSource definitions — keep only the first (correct) one
const fs = require('fs');
let s = fs.readFileSync('server/routes/actions.js', 'utf8');

const MARK = 'function resolveSource(a) {';
const positions = [];
let idx = s.indexOf(MARK);
while (idx >= 0) { positions.push(idx); idx = s.indexOf(MARK, idx + 10); }
console.log('found', positions.length, 'definitions');

if (positions.length <= 1) { console.log('nothing to do'); process.exit(0); }

// Find the end of each function (balanced braces from the marker)
function fnEnd(str, start) {
  let depth = 0;
  for (let i = start; i < str.length; i++) {
    if (str[i] === '{') depth++;
    if (str[i] === '}') { depth--; if (depth === 0) return i + 1; }
  }
  return str.length;
}

// Keep the first, remove the rest (plus trailing newline)
let out = s;
for (let p = positions.length - 1; p >= 1; p--) {
  const start = positions[p];
  const end = fnEnd(s, start);
  out = out.slice(0, start) + out.slice(end).replace(/^\s*\n/, '\n');
}
fs.writeFileSync('server/routes/actions.js', out);
const check = (out.match(new RegExp(MARK, 'g')) || []).length;
console.log('kept', check, 'definition(s)');
