// Keep only the working resolveSource definition in actions.js
const fs = require('fs');
let s = fs.readFileSync('server/routes/actions.js', 'utf8');

const MARK = 'function resolveSource';
const positions = [];
let idx = s.indexOf(MARK);
while (idx >= 0) { positions.push(idx); idx = s.indexOf(MARK, idx + 10); }
console.log('resolveSource definitions found:', positions.length);
if (positions.length <= 1) { console.log('nothing to dedupe'); process.exit(0); }

// Extract each full function block (balanced braces from the declaration)
const blocks = [];
for (const p of positions) {
  let depth = 0, end = p;
  for (let i = p; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  blocks.push({ start: p, end, body: s.slice(p, end) });
}
// Keep the one that uses "SELECT *" (robust version)
const good = blocks.find(b => b.body.includes('SELECT *'));
console.log('keeping block with SELECT *:', !!good);
// Remove all blocks, then re-insert the good one at the first position (sorted descending so removal doesn't shift)
for (const b of blocks.sort((x, y) => y.start - x.start)) {
  s = s.slice(0, b.start) + s.slice(b.end);
}
const insertAt = s.indexOf('r.get(\'/', s.indexOf('const SOURCE_TITLE_COL'));
const goodBlock = good ? good.body : '';
s = s.slice(0, insertAt) + '\n' + goodBlock + '\n\n' + s.slice(insertAt);
fs.writeFileSync('server/routes/actions.js', s);
console.log('final count:', (s.match(new RegExp(MARK, 'g')) || []).length);
