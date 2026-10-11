// QualiCore Make-Actions: "create a risk for X" => verified draft + one-tap Confirm.
// The AI NEVER writes directly: it drafts from live schema + permissions,
// the human taps Confirm, the normal API (with its validation) creates it.
const db = require('../db');
const { MODULES, can } = require('../modules');

const ROUTE = { actions: 'actions', risks: 'risks', nonconformances: 'nonconformances', suppliers: 'suppliers' };
const VERB_RE = /\b(create|add|new|log|raise|file|record|make)\b/i;

// module keywords, longest-first matching
const TARGETS = [
  ['nonconformances', ['non-conformance', 'nonconformance', 'nonconformances', 'incident', 'incidents', 'nc', 'capa']],
  ['actions', ['actions hub', 'action', 'actions', 'task', 'tasks', 'todo', 'to-do', 'reminder']],
  ['suppliers', ['suppliers', 'supplier', 'vendor', 'vendors']],
  ['risks', ['risk register', 'risks', 'risk']],
];

const FILLER_RE = /^(please\s+|kindly\s+|a\s+new\s+|an?\s+|the\s+|for\s+me\s+|for\s+|about\s+|on\s+|of\s+|called\s+|titled\s+|named\s+|that\s+|to\s+)+/i;

function low(s) { return String(s || '').toLowerCase(); }

function matchTarget(q) {
  const t = low(q);
  // "create a risk for X" / "add an action to Y": the word right after
  // the verb decides — beats longest-match ("supplier" inside a risk title).
  const lead = t.match(/^(please\s+|kindly\s+)?(create|add|make|log|raise|file|record)\s+(a|an|the|new)\s+([a-z-]+)/);
  if (lead) {
    const w = lead[4];
    const direct = { risk: 'risks', action: 'actions', task: 'actions', incident: 'nonconformances', nonconformance: 'nonconformances', nc: 'nonconformances', supplier: 'suppliers', vendor: 'suppliers' }[w];
    if (direct) {
      const keys = TARGETS.find(x => x[0] === direct)[1];
      const key = keys.find(k => k === w) || keys.find(k => k.includes(w)) || w;
      return { mod: direct, key };
    }
  }
  let best = null;
  for (const [mod, keys] of TARGETS) {
    for (const k of keys) {
      if (t.includes(k) && (!best || k.length > best.key.length)) best = { mod, key: k };
    }
  }
  return best;
}

function extractTitle(q, key) {
  let t = ' ' + low(q).replace(/[^a-z0-9 -]+/g, ' ') + ' ';
  t = t.replace(new RegExp('\\b' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'), ' ');
  t = t.replace(/\b(create|add|new|log|raise|file|record|make|please|kindly|called|titled|named|for me|assign|assigned)\b/g, ' ');
  t = t.replace(/\b(today|tomorrow|next week|on monday|on tuesday|on wednesday|on thursday|on friday|on saturday|on sunday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|in \d+ days?|by \w+|due \w+[^ ]*|critical|high|medium|low|priority|urgent)\b/g, ' ');
  t = t.split(/\s+/).filter(Boolean).join(' ').trim();
  t = t.replace(FILLER_RE, '').trim();
  // cut trailing owner clause ("for Ahmed", "to Sara") — handled separately
  t = t.replace(/\b(for|to)\s+[a-z]+(\s+[a-z]+)?$/i, '').trim();
  return t;
}

function parseDue(q) {
  const t = low(q);
  const d = new Date();
  const fmt = x => x.toISOString().slice(0, 10);
  if (/\btoday\b/.test(t)) return fmt(d);
  if (/\btomorrow\b/.test(t)) { const x = new Date(d); x.setDate(x.getDate() + 1); return fmt(x); }
  const mIn = t.match(/\bin (\d+) days?\b/);
  if (mIn) { const x = new Date(d); x.setDate(x.getDate() + Number(mIn[1])); return fmt(x); }
  if (/\bnext week\b/.test(t)) { const x = new Date(d); x.setDate(x.getDate() + 7); return fmt(x); }
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (let i = 0; i < 7; i++) {
    if (new RegExp('\\b' + days[i] + '\\b').test(t)) {
      const x = new Date(d);
      let diff = (i - x.getDay() + 7) % 7 || 7;
      x.setDate(x.getDate() + diff);
      return fmt(x);
    }
  }
  const iso = t.match(/\b(20\d\d-\d\d-\d\d)\b/);
  if (iso) return iso[1];
  return null;
}

function parseLevel(q, words) {
  const t = low(q);
  if (/\bcritical\b|\burgent\b/.test(t)) return words[0];
  const m = t.match(/\b(high|medium|low|major|minor)\b/);
  return m ? m[1] : null;
}

function resolveOwner(q) {
  const m = low(q).match(/\b(?:assign(?:ed)? to|for|owner:?)\s+([a-z]+(?: [a-z]+)?)/);
  if (!m) return null;
  const like = '%' + m[1].trim() + '%';
  try {
    const u = db.prepare('SELECT id, name FROM users WHERE name LIKE ? AND active = 1 ORDER BY id LIMIT 1').get(like);
    return u || null;
  } catch { return null; }
}

function base(user) {
  return { intent: 'create_draft', role: user.role, scope: 'create-draft (schema + permissions verified)', generatedAt: new Date().toISOString(), facts: [], findings: [], recommendations: [], citations: [], evidence: [], actions: [] };
}

function interpret(question, user) {
  const q = String(question || '').trim();
  if (!VERB_RE.test(q) || q.length < 8) return null;
  // How-to questions belong to the site guide, not the maker ("how do I create..." teaches, doesn't draft).
  if (/\bhow (do|can|to|should)|where|what is|explain|help me|guide|teach|show me how\b/i.test(q)) return null;
  const target = matchTarget(q);
  if (!target) return null;
  const m = MODULES[target.mod];
  if (!m) return null;
  if (!can(user, m, 'create')) {
    const a = base(user);
    a.intent = 'no_access';
    a.facts.push(`You don't have permission to create ${m.title.toLowerCase()}. Ask your administrator.`);
    return a;
  }

  const titleField = target.mod === 'suppliers' ? 'name' : 'title';
  let title = extractTitle(q, target.key);
  if (title.length < 3) {
    const a = base(user);
    a.intent = 'create_ask';
    a.facts.push(`I'll create a ${m.title.replace(/s$/, '').toLowerCase()} for you — but what should it be called?`);
    a.recommendations.push(`Reply like: "create ${target.key} for ${target.mod === 'actions' ? 'calling the supplier' : 'packaging damage trend'}"`);
    return a;
  }
  // Title-case nicely
  title = title.charAt(0).toUpperCase() + title.slice(1);

  const body = {};
  body[titleField] = title;
  const due = parseDue(q);
  const owner = resolveOwner(q);
  const extras = [];

  if (target.mod === 'actions') {
    body.priority = parseLevel(q) || 'medium';
    if (due) body.due_date = due;
    if (owner) { body.owner_id = owner.id; extras.push(`Owner: ${owner.name}`); }
    extras.unshift(`Priority: ${body.priority}`);
    if (due) extras.push(`Due: ${due}`);
  } else if (target.mod === 'risks') {
    body.treatment = 'mitigate';
    body.status = 'open';
    body.inherent_likelihood = 3; body.inherent_severity = 3;
    body.residual_likelihood = 2; body.residual_severity = 2;
    if (owner) { body.owner_id = owner.id; extras.push(`Owner: ${owner.name}`); }
    extras.unshift('Treatment: mitigate · Likelihood 3 × Severity 3 (adjust after creating)');
    if (due) { body.review_date = due; extras.push(`Review: ${due}`); }
  } else if (target.mod === 'nonconformances') {
    body.type = /incident/.test(low(q)) ? 'incident' : 'nonconformance';
    body.severity = parseLevel(q, ['critical', 'major', 'minor']) || 'minor';
    body.status = 'open';
    if (owner) { body.owner_id = owner.id; extras.push(`Owner: ${owner.name}`); }
    extras.unshift(`Type: ${body.type} · Severity: ${body.severity}`);
  } else if (target.mod === 'suppliers') {
    body.status = 'pending';
    extras.unshift('Status: pending qualification');
  }

  const a = base(user);
  a.facts.push(`Draft ready — ${m.title.replace(/s$/, '').toLowerCase()} "${body[titleField]}"`);
  for (const e of extras) a.facts.push('• ' + e);
  a.facts.push('Tap Confirm & create — nothing is saved until you do.');
  a.actions.push({ kind: 'api', method: 'POST', url: '/' + ROUTE[target.mod], body, label: 'Confirm & create', primary: true, auto: false, navigateTo: '/' + ROUTE[target.mod] });
  return a;
}

module.exports = { interpret };
