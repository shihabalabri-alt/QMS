// QualiCore memory: follow-ups like "open the second one", "tell me more
// about it", "that one". The frontend sends the previous answer back as
// context; references resolve ONLY against server-generated citations.
const CODE_RE = /[A-Z]{2,4}-\d{1,6}/;

const ORDINALS = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4, sixth: 5, seventh: 6, eighth: 7, ninth: 8, tenth: 9, eleventh: 10, twelfth: 11, last: -1 };

function low(s) { return String(s || '').toLowerCase().trim(); }

// Returns {type:'open'|'more'|'which', index} or null (not a follow-up).
function resolve(question, ctx) {
  const q = low(question);
  if (!ctx || !Array.isArray(ctx.citations) || !ctx.citations.length) return null;
  if (CODE_RE.test(question)) return null; // explicit code => normal path
  if (q.length > 120) return null; // follow-ups are short

  const ordHit = q.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|last)\b/);
  const numHit = q.match(/(?:number|#)\s*(\d{1,2})/);
  const ord = ordHit ? ORDINALS[ordHit[1]] : numHit ? (Number(numHit[1]) - 1) : null;
  const saysOpen = /^(open|show|go to|take me to|display)\b/.test(q);
  const saysWatch = /^(watch|monitor)\b/.test(q);
  const saysMore = /tell me more|more (details|detail|about|info)|what about it|explain it|describe it|why (it|this|that)|details\??$/.test(q);
  const saysThat = /\b(it|that one|this one|that|this)\b/.test(q);

  if (ord !== null && (saysOpen || saysWatch || /^(the|that|this|and|what about)\b/.test(q) || saysMore || /one\b/.test(q))) {
    return { type: saysMore && !saysOpen && !saysWatch ? 'more' : saysWatch ? 'watch' : 'open', index: ord };
  }
  if (saysMore && saysThat) return { type: 'more', index: 0 };
  if ((saysOpen || saysWatch) && saysThat) return { type: saysWatch ? 'watch' : 'open', index: 0 };
  return null;
}

function pick(cites, index) {
  const i = index === -1 ? cites.length - 1 : index;
  return cites[i] || null;
}

module.exports = { resolve, pick };
