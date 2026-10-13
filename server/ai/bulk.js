// QualiCore bulk moves: "escalate all overdue actions", "mark them critical",
// "assign all my overdue actions to Ahmed".
// Drafts every change for ONE human Confirm tap. Caps at 10 per batch.
// Only items the requester may edit (owner or quality staff) are included.
const db = require('../db');

const STAFF = ['admin', 'quality_manager', 'management', 'manager', 'qa', 'investigator', 'risk_manager', 'compliance_manager'];
const CAP = 10;

function low(s) { return String(s || '').toLowerCase(); }

function base(user) {
  return { intent: 'bulk_draft', role: user.role, scope: 'bulk-draft (editable items only)', generatedAt: new Date().toISOString(), facts: [], findings: [], recommendations: [], citations: [], evidence: [], actions: [] };
}

function overdueActions() {
  const T = new Date().toISOString().slice(0, 10);
  return db.prepare("SELECT * FROM actions WHERE due_date IS NOT NULL AND due_date < ? AND status IN ('open','in_progress') ORDER BY due_date").all(T);
}

function editable(user, rows) {
  const staff = STAFF.includes(user.role);
  return rows.filter(r => staff || r.owner_id === user.id);
}

function resolveOwner(q) {
  const m = low(q).match(/\b(?:assign(?:ed)?|reassign(?:ed)?|give|move)\b.{0,20}?\bto\s+([a-z]+(?: [a-z]+)?)/);
  if (!m) return null;
  try {
    return db.prepare('SELECT id, name FROM users WHERE name LIKE ? AND active = 1 ORDER BY id LIMIT 1').get('%' + m[1].trim() + '%') || null;
  } catch { return null; }
}

function interpret(question, user) {
  const q = String(question || '').trim();
  const t = low(q);
  if (!/\ball\b/.test(t)) return null;
  if (!/\bactions?\b|\btasks?\b|\btodos?\b|\bto-dos?\b/.test(t)) return null; // this round: actions only
  const wantsEscalate = /\bescalat|\bmark\b|\bset\b|\bmake\b|\braise\b|\bpriorit/.test(t);
  const wantsAssign = /\bassign|reassign|give|move\b/.test(t);
  if (!wantsEscalate && !wantsAssign) return null;
  if (/\bhow (do|can|to)\b/.test(t)) return null; // how-to -> guide

  let rows = overdueActions();
  if (/\bmy\b|\bmine\b/.test(t)) rows = rows.filter(r => r.owner_id === user.id);
  if (/\bcritical\b/.test(t)) rows = rows.filter(r => r.priority === 'critical');
  else if (/\bhigh\b/.test(t)) rows = rows.filter(r => ['high', 'critical'].includes(r.priority));
  if (!rows.length) {
    const a = base(user);
    a.facts.push('No overdue actions match — nothing to move.');
    a.actions.push({ kind: 'navigate', label: 'Open Actions Hub', link: '/actions', primary: true, auto: false });
    return a;
  }

  const mine = editable(user, rows);
  if (!mine.length) {
    const a = base(user);
    a.intent = 'no_access';
    a.facts.push(`${rows.length} match, but you may edit none (owner or quality staff only).`);
    return a;
  }

  // Build the change.
  let change = {}, desc = '';
  if (wantsAssign) {
    const owner = resolveOwner(q);
    if (!owner) {
      const a = base(user);
      a.intent = 'bulk_ask';
      a.facts.push(`Assign ${mine.length} overdue action(s) to whom? Say "assign all overdue actions to Ahmed".`);
      return a;
    }
    change = { owner_id: owner.id };
    desc = `owner → ${owner.name}`;
  } else {
    const level = /\bcritical\b/.test(t) ? 'critical' : 'high';
    change = { priority: level };
    desc = `priority → ${level}`;
  }

  const batch = mine.slice(0, CAP);
  const a = base(user);
  a.facts.push(`Bulk move ready — ${batch.length} action(s), ${desc}:`);
  for (const r of batch) {
    a.facts.push(`• ${r.code} "${r.title}" (due ${r.due_date}, now ${r.priority})`);
    a.citations.push({ type: 'Action', code: r.code, title: r.title, link: `/actions?focus=${r.id}` });
  }
  if (mine.length > CAP) a.facts.push(`…and ${mine.length - CAP} more match — say "my overdue" to narrow it first.`);
  if (mine.length < rows.length) a.facts.push(`(${rows.length - mine.length} skipped — not yours to edit.)`);
  a.facts.push('Tap Confirm — nothing changes until you do.');
  a.actions.push({
    kind: 'api-bulk', label: `Confirm (${batch.length} changes)`, primary: true, auto: false,
    navigateTo: '/actions?overdue=1',
    ops: batch.map(r => ({ method: 'PUT', url: `/actions/${r.id}`, body: change }))
  });
  return a;
}

module.exports = { interpret };
