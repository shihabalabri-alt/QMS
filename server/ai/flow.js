// QualiCore Flow-Actions: "approve RSK-0001" / "submit DOC-0002 for review" /
// "complete ACT-0097" / "what needs my signature?"
// Same safety as the API: transitions validated, approver roles checked,
// close-requirements enforced. NOTHING executes until the human taps Confirm.
const db = require('../db');
const { MODULES, findByCode, can } = require('../modules');

const ROUTE = { policies: 'policies', goals: 'goals', risks: 'risks', suppliers: 'suppliers', employees: 'employees', competencies: 'competencies', trainings: 'trainings', records: 'records', documents: 'documents', design: 'design', equipment: 'equipment', nonconformances: 'nonconformances', audits: 'audits', compliance: 'compliance', mgmt_reviews: 'mgmt-reviews', actions: 'actions' };
const FINAL_STATES = ['approved', 'closed', 'issued', 'disqualified'];
const VERB_RE = /\b(approve|submit|move|send|close|complete|verify|sign off|sign)\b/i;

function low(s) { return String(s || '').toLowerCase(); }

function canRead(user, key) {
  if (key === 'records') return ['admin', 'quality_manager', 'management', 'manager', 'compliance_manager', 'doc_controller'].includes(user.role);
  if (key === 'mgmt_reviews') return ['admin', 'quality_manager', 'management', 'manager', 'qa', 'investigator', 'auditor', 'compliance_manager', 'risk_manager'].includes(user.role);
  return true;
}

function titleOf(key, row) { return row.title || row.name || row.code || ''; }
function linkOf(key, row) { return `/${ROUTE[key]}/${row.id}`; }

function base(user, intent) {
  return { intent: intent || 'approve_draft', role: user.role, scope: 'flow-action (transitions + roles verified)', generatedAt: new Date().toISOString(), facts: [], findings: [], recommendations: [], citations: [], evidence: [], actions: [] };
}

function searchModule(key, query, limit) {
  const m = MODULES[key];
  if (!m || !m.search || !m.search.length) return [];
  const like = '%' + query + '%';
  try { return db.prepare(`SELECT * FROM ${m.table} WHERE (${m.search.map(f => f + ' LIKE ?').join(' OR ')}) ORDER BY id DESC LIMIT ${limit || 3}`).all(...m.search.map(() => like)); }
  catch { return []; }
}

// "move X to Y" — extract the desired state word
function wantedState(q) {
  const m = low(q).match(/\bto\s+([a-z_]+)/);
  if (m) return m[1].replace(/_/g, ' ');
  if (/\bfor review\b|\bsubmit\b|\bsend\b/.test(low(q))) return null; // handled as first-step
  return null;
}

function interpretApproval(question, user) {
  const q = String(question || '').trim();
  if (!VERB_RE.test(q) || q.length < 6) return null;
  // How-to belongs to the guide ("how do I approve...?" teaches).
  if (/\bhow (do|can|to|should)|where|what is|explain|teach|show me how\b/i.test(q)) return null;

  const isComplete = /\bcomplete\b|\bmark\b.*\bdone\b|\bdone\b/.test(q);
  const isClose = /\bclose\b/.test(q) && !isComplete;
  const isSubmit = /\bsubmit\b|\bsend\b/.test(q);

  // resolve target: exact code first
  const codeHit = (q.match(/\b(NC|CAPA|INC|RSK|SUP|DOC|POL|ACT|EQ|AUD|KPI|OBJ|ASM|TRN|REC|DR|CR|MR|EMP|CMP)-\d{1,6}\b/i) || [])[0];

  // --- action completion: "complete ACT-0097" ---
  if (isComplete) {
    let row = null;
    if (codeHit) {
      const hit = findByCode(codeHit.toUpperCase());
      if (hit && hit.module === 'actions') row = hit.row;
      else if (hit) { const a = base(user); a.facts.push(`${codeHit.toUpperCase()} is not an action — completion applies to actions (ACT- codes).`); return a; }
    }
    if (!row) {
      // try title search in actions
      const words = low(q).replace(/[^a-z0-9 -]+/g, ' ').split(/\s+/).filter(w => w && !/complete|mark|done|action|actions|act|the|a|please|my|this|that/.test(w)).join(' ').trim();
      const rows = words.length >= 3 ? searchModule('actions', words, 3) : [];
      if (!rows.length) {
        const a = base(user);
        a.intent = 'approve_ask';
        a.facts.push('Which action should I complete? Give me its code (e.g. "complete ACT-0097").');
        return a;
      }
      row = rows[0];
    }
    const STAFF = ['admin', 'quality_manager', 'management', 'manager', 'qa', 'investigator'];
    if (row.owner_id !== user.id && !STAFF.includes(user.role)) {
      const a = base(user);
      a.intent = 'no_access';
      a.facts.push(`Only the owner or quality staff can complete ${row.code}.`);
      return a;
    }
    if (!['open', 'in_progress'].includes(row.status)) {
      const a = base(user);
      a.facts.push(`${row.code} is already ${row.status} — nothing to complete.`);
      a.actions.push({ kind: 'navigate', label: `Open ${row.code}`, link: `/actions?focus=${row.id}`, primary: true, auto: false });
      return a;
    }
    const a = base(user);
    a.facts.push(`Ready to complete ${row.code} "${row.title}" (owner signs off, timestamp recorded).`);
    a.facts.push('Tap Confirm & complete — nothing changes until you do.');
    a.actions.push({ kind: 'api', method: 'POST', url: `/actions/${row.id}/complete`, body: {}, label: 'Confirm & complete', primary: true, auto: false, navigateTo: '/actions' });
    a.citations.push({ type: 'Action', code: row.code, title: row.title, link: `/actions?focus=${row.id}` });
    return a;
  }

  // --- generic workflow transitions ---
  let hit = codeHit ? findByCode(codeHit.toUpperCase()) : null;
  let key = hit ? hit.module : null;
  let row = hit ? hit.row : null;
  if (!row) {
    // title search across workflow modules
    const words = low(q).replace(/[^a-z0-9 -]+/g, ' ').split(/\s+/).filter(w => w && !/approve|submit|move|send|close|sign|off|for|review|please|the|a|record|this|that|it|my/.test(w)).join(' ').trim();
    if (words.length >= 3 && !/\bthis\b|\bit\b/.test(low(q))) {
      const order = ['documents', 'policies', 'risks', 'audits', 'nonconformances', 'compliance', 'design', 'goals', 'suppliers', 'equipment'];
      for (const k of order) {
        if (!canRead(user, k)) continue;
        const rows = searchModule(k, words, 1);
        if (rows.length) { key = k; row = rows[0]; break; }
      }
    }
    if (!row) {
      const a = base(user);
      a.intent = 'approve_ask';
      a.facts.push('Which record should I move? Give me its code (e.g. "approve DOC-0002").');
      return a;
    }
  }
  if (key === 'actions') {
    const a = base(user);
    a.facts.push('Actions use complete / verify instead of approve — say "complete ' + row.code + '".');
    return a;
  }
  const m = MODULES[key];
  if (!m || !m.transitions) {
    const a = base(user);
    a.facts.push(`${row.code} has no workflow to move.`);
    return a;
  }
  if (!canRead(user, key)) {
    const a = base(user);
    a.intent = 'no_access';
    a.facts.push(`You don't have access to that section.`);
    return a;
  }
  const next = m.transitions[row.status] || [];
  if (!next.length) {
    const a = base(user);
    a.facts.push(`${row.code} is ${row.status} — final state, nowhere left to move.`);
    a.actions.push({ kind: 'navigate', label: `Open ${row.code}`, link: linkOf(key, row), primary: true, auto: false });
    return a;
  }
  // Already approved/closed/etc: "approve" means nothing — say so (unless an explicit target was named).
  const wantEarly = wantedState(q);
  if (FINAL_STATES.includes(row.status) && !wantEarly) {
    const a = base(user);
    a.facts.push(`${row.code} is already ${row.status} — nothing left to approve.`);
    a.actions.push({ kind: 'navigate', label: `Open ${row.code}`, link: linkOf(key, row), primary: true, auto: false });
    return a;
  }

  // decide target state
  let to = null;
  const want = wantedState(q);
  if (want && next.includes(want)) to = want;
  else if (want && !next.includes(want)) {
    const a = base(user);
    a.facts.push(`Can't move ${row.code} from ${row.status} to "${want}". Allowed: ${next.join(', ')}.`);
    a.actions.push({ kind: 'navigate', label: `Open ${row.code}`, link: linkOf(key, row), primary: true, auto: false });
    return a;
  }
  else if (isClose) to = next.includes('closed') ? 'closed' : null;
  else if (isSubmit) to = next.find(s => !FINAL_STATES.includes(s)) || next[0];
  else to = next.find(s => FINAL_STATES.includes(s)) || next[next.length - 1]; // approve => final-ward
  if (!to) {
    const a = base(user);
    a.facts.push(`${row.code} (${row.status}) has no close step. Next: ${next.join(', ')}.`);
    return a;
  }

  // permission mirror of the API
  if (!can(user, m, 'update')) {
    const a = base(user);
    a.intent = 'no_access';
    a.facts.push(`Your role can't move ${m.title.toLowerCase()} records. Ask your administrator.`);
    return a;
  }
  if (FINAL_STATES.includes(to) && m.approveRole && !m.approveRole.includes(user.role)) {
    const a = base(user);
    a.intent = 'no_access';
    a.facts.push(`${row.code}: the ${row.status} → ${to} step needs an authorized approver, not your role.`);
    a.recommendations.push('Someone with an approver role must tap Confirm on their own login.');
    return a;
  }
  if (to === 'closed' && m.closeRequires) {
    const missing = m.closeRequires.filter(f => !row[f]);
    if (missing.length) {
      const a = base(user);
      a.facts.push(`Can't close ${row.code} yet — complete first: ${missing.join(', ').replace(/_/g, ' ')}.`);
      a.actions.push({ kind: 'navigate', label: `Open ${row.code} to complete it`, link: linkOf(key, row), primary: true, auto: false });
      return a;
    }
  }

  const a = base(user);
  a.facts.push(`Ready: ${row.code} "${titleOf(key, row)}" — ${row.status} → ${to}.`);
  a.facts.push('Your name is recorded as approver, the owner is notified, history is written.');
  a.facts.push('Tap Confirm — nothing changes until you do.');
  a.actions.push({ kind: 'api', method: 'POST', url: `/${ROUTE[key]}/${row.id}/status`, body: { status: to }, label: to === 'closed' ? 'Confirm & close' : `Confirm & ${to.replace(/_/g, ' ')}`, primary: true, auto: false, navigateTo: linkOf(key, row) });
  a.citations.push({ type: m.title, code: row.code, title: titleOf(key, row), link: linkOf(key, row) });
  return a;
}

function interpretMyApprovals(question, user) {
  if (!/\b(approv|signature|sign.?off|sign)\b/i.test(question)) return null;
  if (!/\b(my|mine|awaiting|pending|waiting|need|needs|for me|i can)\b/i.test(question)) return null;
  if (/\bhow (do|can|to)\b/i.test(question)) return null; // how-to -> guide
  const a = base(user, 'my_approvals');
  const waiting = [];
  for (const [key, m] of Object.entries(MODULES)) {
    if (!m.transitions || !m.table || !ROUTE[key] || !canRead(user, key)) continue;
    let rows;
    try { rows = db.prepare(`SELECT * FROM ${m.table} ORDER BY id DESC LIMIT 60`).all(); }
    catch { continue; }
    for (const r of rows) {
      const next = (m.transitions[r.status] || []).filter(s => FINAL_STATES.includes(s));
      if (!next.length) continue;
      if (!can(user, m, 'update')) continue;
      if (m.approveRole && !m.approveRole.includes(user.role)) continue;
      waiting.push({ key, row: r, to: next[0] });
      if (waiting.length >= 10) break;
    }
    if (waiting.length >= 10) break;
  }
  if (!waiting.length) {
    a.facts.push('Nothing is waiting for your signature — the pile is empty.');
    a.actions.push({ kind: 'navigate', label: 'Open dashboard', link: '/', primary: true, auto: false });
    return a;
  }
  a.facts.push(`${waiting.length} record${waiting.length > 1 ? 's' : ''} waiting for your signature:`);
  for (const w of waiting) {
    a.facts.push(`• ${w.row.code} "${titleOf(w.key, w.row)}" — ${w.row.status} → ${w.to}`);
    a.citations.push({ type: MODULES[w.key].title, code: w.row.code, title: titleOf(w.key, w.row), link: linkOf(w.key, w.row) });
  }
  a.recommendations.push('Say "approve CODE" and I prepare each one for your one-tap Confirm.');
  return a;
}

function interpret(question, user) {
  return interpretMyApprovals(question, user) || interpretApproval(question, user);
}

module.exports = { interpret };
