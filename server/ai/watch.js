// QualiCore watchdog: "watch RSK-0001" / "notify me when DOC-0002 changes".
// The AI drafts the watch; the human taps Confirm; the scheduler (jobs.js)
// checks every sweep and notifies on real changes. Nothing polls the client.
const crypto = require('crypto');
const db = require('../db');
const { MODULES, findByCode } = require('../modules');
const { notify } = require('../middleware/audit');

const ROUTE = { policies: 'policies', goals: 'goals', risks: 'risks', suppliers: 'suppliers', employees: 'employees', competencies: 'competencies', trainings: 'trainings', records: 'records', documents: 'documents', design: 'design', equipment: 'equipment', nonconformances: 'nonconformances', audits: 'audits', compliance: 'compliance', mgmt_reviews: 'mgmt-reviews', actions: 'actions' };

const WATCH_FIELDS = {
  risks: ['status', 'treatment', 'residual_likelihood', 'residual_severity', 'review_date', 'owner_id'],
  actions: ['status', 'priority', 'due_date', 'owner_id'],
  documents: ['status', 'version', 'review_date', 'owner_id'],
  policies: ['status', 'version', 'review_date', 'owner_id'],
  nonconformances: ['status', 'severity', 'owner_id'],
  audits: ['status', 'result'],
  suppliers: ['status', 'risk_level', 'next_audit'],
  equipment: ['status', 'next_calibration'],
  goals: ['status'],
  compliance: ['status'],
  trainings: ['status', 'scheduled_date'],
  design: ['status'],
  employees: ['status'],
  competencies: ['status'],
  records: ['status'],
  mgmt_reviews: ['status'],
};

function low(s) { return String(s || '').toLowerCase(); }

function canRead(user, key) {
  if (key === 'records') return ['admin', 'quality_manager', 'management', 'manager', 'compliance_manager', 'doc_controller'].includes(user.role);
  if (key === 'mgmt_reviews') return ['admin', 'quality_manager', 'management', 'manager', 'qa', 'investigator', 'auditor', 'compliance_manager', 'risk_manager'].includes(user.role);
  return true;
}

function titleOf(key, row) { return row.title || row.name || row.code || ''; }
function linkOf(key, row) { return `/${ROUTE[key]}/${row.id}`; }

function snapshotOf(key, row) {
  const fields = WATCH_FIELDS[key] || ['status'];
  const snap = {};
  for (const f of fields) snap[f] = row[f] === undefined ? null : row[f];
  return snap;
}

function fmtVal(v) {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

function base(user, intent) {
  return { intent: intent || 'watch_draft', role: user.role, scope: 'watch (scheduler-checked)', generatedAt: new Date().toISOString(), facts: [], findings: [], recommendations: [], citations: [], evidence: [], actions: [] };
}

function myWatches(user) {
  return db.prepare('SELECT * FROM ai_watches WHERE user_id = ? AND active = 1 ORDER BY id').all(user.id);
}

function interpret(question, user) {
  const q = String(question || '').trim();
  const t = low(q);
  if (q.length < 4) return null;
  const isList = /\bwatch(ing|es)?\b/.test(t) && /\b(what|which|list|show|my|am i|do i)\b/.test(t);
  const isStop = /\bstop watching\b|\bunwatch\b|\bdon't watch\b|\bremove (the )?watch\b|\bcancel (the )?watch\b/.test(t);
  const isWatch = /\bwatch\b|\bmonitor\b|\bkeep an eye\b|\bnotify me\b|\balert me\b|\btell me when\b|\blet me know\b/.test(t);
  if (!isList && !isStop && !isWatch) return null;
  if (/\bhow (do|can|to)\b/.test(t)) return null; // how-to -> guide

  // --- "what am I watching?" ---
  if (isList && !isStop) {
    const rows = myWatches(user);
    const a = base(user, 'watch_list');
    if (!rows.length) {
      a.facts.push('You are watching nothing yet — the kennel is empty.');
      a.recommendations.push('Say "watch RSK-0001" and I will guard it for you.');
      return a;
    }
    a.facts.push(`You are watching ${rows.length} record${rows.length > 1 ? 's' : ''} — I check every scheduler sweep:`);
    for (const w of rows) {
      a.facts.push(`• ${w.code}${w.title ? ` "${w.title}"` : ''}${w.last_fired ? ` (last change ${String(w.last_fired).slice(0, 10)})` : ' (no changes yet)'}`);
      a.citations.push({ type: 'Watch', code: w.code, title: w.title, link: w.link });
      a.actions.push({ kind: 'navigate', label: `Open ${w.code}`, link: w.link, primary: false, auto: false });
    }
    return a;
  }

  const codeHit = (q.match(/\b(NC|CAPA|INC|RSK|SUP|DOC|POL|ACT|EQ|AUD|KPI|OBJ|ASM|TRN|REC|DR|CR|MR|EMP|CMP)-\d{1,6}\b/i) || [])[0];

  // --- "stop watching RSK-0001" ---
  if (isStop) {
    if (!codeHit) {
      const a = base(user, 'watch_ask');
      a.facts.push('Stop watching which one? Give me its code (e.g. "stop watching RSK-0001").');
      return a;
    }
    const hit = findByCode(codeHit.toUpperCase());
    const w = hit && db.prepare('SELECT * FROM ai_watches WHERE user_id = ? AND module = ? AND record_id = ? AND active = 1').get(user.id, hit.module, hit.row.id);
    const a = base(user, 'watch_draft');
    if (!w) {
      a.facts.push(`You are not watching ${codeHit.toUpperCase()}.`);
      return a;
    }
    a.facts.push(`Stop guarding ${w.code}${w.title ? ` "${w.title}"` : ''}? Tap Confirm — no more alerts.`);
    a.actions.push({ kind: 'api', method: 'DELETE', url: `/ai/watches/${w.id}`, body: {}, label: 'Confirm & stop', primary: true, auto: false, doneText: `Stopped watching ${w.code}` });
    return a;
  }

  // --- "watch RSK-0001" ---
  if (!codeHit) {
    const a = base(user, 'watch_ask');
    a.facts.push('Which record should I guard? Give me its code (e.g. "watch RSK-0001").');
    return a;
  }
  const hit = findByCode(codeHit.toUpperCase());
  if (!hit || !ROUTE[hit.module]) {
    const a = base(user);
    a.facts.push(`I can't find ${codeHit.toUpperCase()} in the system.`);
    return a;
  }
  if (!canRead(user, hit.module)) {
    const a = base(user);
    a.intent = 'no_access';
    a.facts.push(`You don't have access to that section.`);
    return a;
  }
  const existing = db.prepare('SELECT * FROM ai_watches WHERE user_id = ? AND module = ? AND record_id = ? AND active = 1').get(user.id, hit.module, hit.row.id);
  const a = base(user, 'watch_draft');
  if (existing) {
    a.facts.push(`Already guarding ${hit.row.code} — I will bell you on any change.`);
    a.actions.push({ kind: 'api', method: 'DELETE', url: `/ai/watches/${existing.id}`, body: {}, label: 'Stop watching', primary: false, auto: false, doneText: `Stopped watching ${hit.row.code}` });
    a.citations.push({ type: 'Watch', code: hit.row.code, title: titleOf(hit.module, hit.row), link: linkOf(hit.module, hit.row) });
    return a;
  }
  a.facts.push(`Guard ${hit.row.code} "${titleOf(hit.module, hit.row)}"? I check status${(WATCH_FIELDS[hit.module] || []).filter(f => f !== 'status').length ? ' + ' + WATCH_FIELDS[hit.module].filter(f => f !== 'status').slice(0, 3).join(', ').replace(/_/g, ' ') : ''} every sweep and bell you on change.`);
  a.facts.push('Tap Confirm — watching starts immediately.');
  a.actions.push({ kind: 'api', method: 'POST', url: '/ai/watches', body: { module: hit.module, record_id: hit.row.id }, label: 'Confirm & watch', primary: true, auto: false, doneText: `Watching ${hit.row.code} — I will bell you on change` });
  a.citations.push({ type: MODULES[hit.module].title, code: hit.row.code, title: titleOf(hit.module, hit.row), link: linkOf(hit.module, hit.row) });
  return a;
}

// Scheduler sweep: compare snapshots, bell on real change. Returns counts.
function sweepWatches() {
  let checked = 0, fired = 0;
  let watches = [];
  try { watches = db.prepare('SELECT * FROM ai_watches WHERE active = 1').all(); }
  catch { return { watchesChecked: 0, watchesFired: 0 }; }
  const now = new Date().toISOString();
  for (const w of watches) {
    let row = null;
    try {
      const mod = MODULES[w.module];
      if (!mod) continue;
      row = db.prepare(`SELECT * FROM ${mod.table} WHERE id = ?`).get(w.record_id);
    } catch { continue; }
    checked++;
    if (!row) {
      // Record deleted: retire the watch, bell once.
      db.prepare('UPDATE ai_watches SET active = 0, last_checked = ? WHERE id = ?').run(now, w.id);
      notify(w.user_id, `Watch ended: ${w.code}`, `The record was deleted, so I stopped guarding it.`, null, 'info', 'watchdog', `watch-gone:${w.id}`, w.module, w.code, w.record_id);
      fired++;
      continue;
    }
    const fresh = snapshotOf(w.module, row);
    let old = {};
    try { old = JSON.parse(w.snapshot || '{}'); } catch {}
    const diffs = Object.keys(fresh).filter(k => String(old[k] ?? '') !== String(fresh[k] ?? ''));
    db.prepare('UPDATE ai_watches SET last_checked = ? WHERE id = ?').run(now, w.id);
    if (!diffs.length) continue;
    const lines = diffs.map(k => `${k.replace(/_/g, ' ')}: ${fmtVal(old[k])} → ${fmtVal(fresh[k])}`).join('; ');
    const hash = crypto.createHash('md5').update(JSON.stringify(fresh)).digest('hex').slice(0, 10);
    notify(w.user_id, `Watch alert: ${w.code} changed`, `${w.title || ''} — ${lines}.`, w.link, 'warning', 'watchdog', `watch:${w.id}:${hash}`, w.module, w.code, w.record_id);
    db.prepare('UPDATE ai_watches SET snapshot = ?, last_fired = ? WHERE id = ?').run(JSON.stringify(fresh), now, w.id);
    fired++;
  }
  return { watchesChecked: checked, watchesFired: fired };
}

module.exports = { interpret, sweepWatches, snapshotOf, linkOf, titleOf };
