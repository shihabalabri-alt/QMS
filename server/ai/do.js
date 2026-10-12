// QualiCore Do-Actions: the AI that DOES things, not just talks.
// Understands "open / take me to / find / show ..." and returns real
// navigation + record-opening actions the UI executes.
// Facts still come ONLY from the live database (never invented).
const db = require('../db');
const { MODULES, findByCode } = require('../modules');

const ROUTE = { policies: 'policies', goals: 'goals', risks: 'risks', suppliers: 'suppliers', employees: 'employees', competencies: 'competencies', trainings: 'trainings', records: 'records', documents: 'documents', design: 'design', equipment: 'equipment', nonconformances: 'nonconformances', audits: 'audits', compliance: 'compliance', mgmt_reviews: 'mgmt-reviews', actions: 'actions' };
const ROUTE_TO_KEY = Object.fromEntries(Object.entries(ROUTE).map(([k, v]) => ['/' + v, k]));
// static pages with no DB table
const STATIC_ROUTE = { '/': 'dashboard', '/ai': 'ai', '/inbox': 'inbox', '/notifications': 'notifications', '/connections': 'connections', '/reports': 'reports', '/calendar': 'calendar', '/search': 'search', '/activity': 'activity', '/admin': 'admin', '/security': 'security', '/competency-matrix': 'competency-matrix' };

// pages ordered so long phrases match first ("risk register" beats "risk")
const PAGES = [
  ['/competency-matrix', ['competency matrix']],
  ['/mgmt-reviews', ['management review', 'mgmt review', 'mgmt-reviews']],
  ['/nonconformances', ['non-conformance', 'nonconformance', 'nonconformances', 'nc & incidents', 'capa', 'incidents', 'incident']],
  ['/actions', ['actions hub', 'actions', 'to-do', 'todo', 'tasks', 'task']],
  ['/documents', ['document control', 'documents', 'document']],
  ['/connections', ['connections map', 'connection map', 'knowledge graph', 'network', 'graph']],
  ['/reports', ['reports', 'report', 'export']],
  ['/calendar', ['calendar', 'schedule', 'deadlines', 'deadline']],
  ['/notifications', ['notifications', 'notification center', 'notification', 'bell']],
  ['/risks', ['risk register', 'risks', 'risk']],
  ['/policies', ['policies', 'policy']],
  ['/goals', ['objectives', 'objective', 'kpis', 'kpi', 'goals', 'target', 'targets']],
  ['/compliance', ['compliance']],
  ['/suppliers', ['suppliers', 'supplier', 'vendor', 'vendors']],
  ['/equipment', ['equipment', 'machine', 'machines', 'calibration']],
  ['/design', ['design reviews', 'design review', 'design']],
  ['/employees', ['employees', 'employee', 'people', 'staff', 'person']],
  ['/competencies', ['competencies', 'competency', 'qualifications', 'qualification', 'skills', 'skill']],
  ['/trainings', ['trainings', 'training', 'courses', 'course']],
  ['/records', ['records', 'record']],
  ['/audits', ['audits', 'audit']],
  ['/inbox', ['inbox']],
  ['/search', ['search']],
  ['/activity', ['activity', 'audit trail', 'change log', 'changelog']],
  ['/admin', ['administration', 'user management', 'admin', 'settings', 'permission', 'permissions']],
  ['/security', ['security', 'password', '2fa']],
  ['/ai', ['ai assistant', 'ai brain', 'assistant']],
  ['/', ['dashboard', 'home page', 'overview', 'home']],
];

const VERB_RE = /\b(open|go to|take me to|take me|bring me|bring up|show me|show|list|find|search for|search|look up|display|navigate to|go)\b/i;
const STOP = new Set(('open,go,to,take,me,bring,up,show,find,search,for,display,navigate,look,please,the,a,an,on,about,called,named,titled,with,of,my,us,page,section,for me').split(','));

function low(s) { return String(s || '').toLowerCase(); }

function canRead(user, key) {
  if (key === 'records') return ['admin', 'quality_manager', 'management', 'manager', 'compliance_manager', 'doc_controller'].includes(user.role);
  if (key === 'mgmt_reviews') return ['admin', 'quality_manager', 'management', 'manager', 'qa', 'investigator', 'auditor', 'compliance_manager', 'risk_manager'].includes(user.role);
  return true;
}

function matchPage(q) {
  const t = ' ' + low(q).replace(/[^a-z0-9/& -]+/g, ' ') + ' ';
  let best = null;
  for (const [route, keys] of PAGES) {
    for (const k of keys) {
      if (low(q).includes(k) && (!best || k.length > best.key.length)) best = { route, key: k };
    }
  }
  return best;
}

function stripQuery(q, phrases) {
  let t = ' ' + low(q).replace(/[^a-z0-9 -]+/g, ' ') + ' ';
  for (const p of phrases) {
    for (const w of p.split(' ')) t = t.replace(new RegExp('\\b' + w + '\\b', 'g'), ' ');
  }
  t = t.split(/\s+/).filter(w => w && !STOP.has(w) && w.length > 1).join(' ').trim();
  return t;
}

function titleOf(key, row) { return row.title || row.name || row.code || ''; }

function searchModule(key, query, limit) {
  const m = MODULES[key];
  if (!m || !m.search || !m.search.length) return [];
  const like = '%' + query + '%';
  const sql = `SELECT * FROM ${m.table} WHERE (${m.search.map(f => f + ' LIKE ?').join(' OR ')}) ORDER BY id DESC LIMIT ${limit || 5}`;
  try { return db.prepare(sql).all(...m.search.map(() => like)); }
  catch { return []; }
}

function base(user) {
  return { intent: 'do_action', role: user.role, scope: 'do-action (live database)', generatedAt: new Date().toISOString(), facts: [], findings: [], recommendations: [], citations: [], evidence: [], actions: [] };
}
function navAction(label, link, primary, auto) {
  return { kind: 'navigate', label, link, primary: !!primary, auto: !!auto };
}

function navAction(label, link, primary, auto) {
  return { kind: 'navigate', label, link, primary: !!primary, auto: !!auto };
}

// Personal filtered views: "my overdue actions", "my open risks", "closed audits".
// Only fires when the list page can actually honor the filter via URL params.
function interpretView(q, user, page) {
  const key = ROUTE_TO_KEY[page.route];
  const isActions = page.route === '/actions';
  if (!key && !isActions) return null; // static pages have no filters
  if (key && !MODULES[key]) return null;
  if (key && !canRead(user, key)) return null;

  const t = low(q);
  const mine = /\bmy\b|\bmine\b|\bassigned to me\b|\bowned by me\b|\bmy own\b/.test(t);
  const overdue = /\boverdue\b|\blate\b|\bpast due\b/.test(t);
  // status words, normalized
  let status = null;
  const norm = t.replace(/in review/g, 'in_review').replace(/in progress/g, 'in_progress');
  const statuses = isActions
    ? ['open', 'in_progress', 'completed', 'verified', 'cancelled']
    : (MODULES[key] && MODULES[key].statuses) || [];
  for (const s of statuses) {
    if (new RegExp('\\b' + s.replace(/_/g, ' ') + '\\b').test(t) || new RegExp('\\b' + s + '\\b').test(norm)) { status = s; break; }
  }
  if (!mine && !status && !(overdue && isActions)) return null;

  // A leftover title ("my risks for packaging") means record-find, not a view.
  const leftover = stripQuery(q, [page.key, 'my', 'mine', 'me', 'overdue', 'late', 'past', 'due', 'open', 'closed', 'all', 'show', 'list', 'filter', 'filtered']);
  if (leftover.length >= 3) return null;

  const params = new URLSearchParams();
  const bits = [];
  if (mine) { params.set(isActions ? 'owner' : 'mine', isActions ? 'me' : '1'); bits.push('yours'); }
  if (overdue && isActions) { params.set('overdue', '1'); bits.push('overdue'); }
  if (status) { params.set('status', status); bits.push(status.replace(/_/g, ' ')); }
  const link = page.route + (params.toString() ? '?' + params.toString() : '');
  const name = isActions ? 'Actions' : MODULES[key].title;
  const a = base(user);
  a.facts.push(`Showing ${name.toLowerCase()} — ${bits.join(' · ')}. Taking you there now.`);
  a.actions.push(navAction(`Open ${bits.join(', ')} ${name.toLowerCase()}`, link, true, true));
  return a;
}

function interpret(question, user) {
  const q = String(question || '').trim();
  if (q.length < 2 || q.length > 500) return null;
  const hasVerb = VERB_RE.test(q);

  // --- client action: dark / light mode (no database needed) ---
  if (/\b(dark|night)\s*mode\b|\blight\s*mode\b|\btheme\b/i.test(q) && /turn on|turn off|enable|disable|switch|toggle|activate|go dark|go light|dark|light/i.test(q)) {
    const toDark = /\bdark\b|\bnight\b/.test(low(q)) && !/\blight\b/.test(low(q));
    const value = toDark ? 'dark' : 'light';
    const a = base(user);
    a.facts.push(`Switching to ${value} mode now.`);
    a.actions.push({ kind: 'client', op: 'theme', value, label: `Switch to ${value} mode`, primary: true, auto: true });
    return a;
  }

  // Verbless filtered views ("closed audits", "my overdue actions"): only when the
  // question LEADS with a filter — "which/what" starters stay data questions.
  {
    const pe = matchPage(q);
    if (pe) {
      const v = interpretView(q, user, pe);
      if (v && /^(my|mine|overdue|late|open|closed|pending|critical|high|all|my own)\b/i.test(q.trim())) return v;
    }
  }
  if (!hasVerb) return null;
  // How-to questions belong to the site guide ("how do I open..." teaches, doesn't jump).
  if (/\bhow (do|can|to|should)|where do|what is|explain|teach|show me how\b/i.test(q) && !/\b(open it|take me|go to|navigate)\b/i.test(q)) return null;

  // --- "open RSK-0001" style: verb + exact code => open the record ---
  const codeHit = (q.match(/\b(NC|CAPA|INC|RSK|SUP|DOC|POL|ACT|EQ|AUD|KPI|OBJ|ASM|TRN|REC|DR|CR|MR|EMP|CMP)-\d{1,6}\b/i) || [])[0];
  if (codeHit && /open|go|take|bring|show|display|navigate/i.test(q)) {
    const hit = findByCode(codeHit.toUpperCase());
    if (hit) {
      const route = ROUTE[hit.module];
      const link = route ? `/${route}/${hit.row.id}` : null;
      if (link) {
        if (!canRead(user, hit.module)) {
          const a = base(user);
          a.intent = 'no_access';
          a.facts.push(`You don't have access to ${codeHit.toUpperCase()}.`);
          return a;
        }
        const a = base(user);
        a.facts.push(`Opening ${hit.row.code} "${titleOf(hit.module, hit.row)}" — taking you there now.`);
        a.actions.push(navAction(`Open ${hit.row.code}`, link, true, true));
        a.citations.push({ type: hit.mod.title, code: hit.row.code, title: titleOf(hit.module, hit.row), link });
        return a;
      }
    }
  }

  // --- personal filtered views ("my overdue actions", "my open risks", "closed audits") ---
  const page = matchPage(q);
  if (page) {
    const viewed = interpretView(q, user, page);
    if (viewed) return viewed;
    const key = ROUTE_TO_KEY[page.route] || STATIC_ROUTE[page.route];
    if (key && (ROUTE_TO_KEY[page.route]) && !canRead(user, key)) {
      const a = base(user);
      a.intent = 'no_access';
      a.facts.push(`You don't have access to that section.`);
      return a;
    }
    const query = stripQuery(q, [page.key]);
    // module with a table + leftover search words => find the record, open best hit
    if (key && MODULES[key] && query.length >= 2) {
      const rows = canRead(user, key) ? searchModule(key, query, 5) : [];
      if (rows.length) {
        const a = base(user);
        const top = rows[0];
        a.facts.push(`Opening ${top.code || titleOf(key, top)} "${titleOf(key, top)}" — taking you there now.`);
        rows.forEach((r, i) => a.actions.push(navAction(`${r.code || ''} — ${titleOf(key, r)}`.trim(), `/${page.route.replace(/^\//, '')}/${r.id}`, i === 0, i === 0)));
        if (rows.length > 1) a.facts.push(`${rows.length - 1} more match${rows.length > 2 ? 'es' : ''} — alternatives below.`);
        rows.forEach(r => a.citations.push({ type: MODULES[key].title, code: r.code, title: titleOf(key, r), link: `/${page.route.replace(/^\//, '')}/${r.id}` }));
        return a;
      }
      // nothing matched: still take them to the section, filtered by their words
      const a = base(user);
      a.facts.push(`No exact match for "${query}" — opening the section filtered by your words instead.`);
      a.actions.push(navAction(`Open ${MODULES[key] ? MODULES[key].title : page.route} (search: ${query})`, `${page.route}?q=${encodeURIComponent(query)}`, true, true));
      return a;
    }
    // plain "open X / go to X": navigate there
    const a = base(user);
    const name = (key && MODULES[key] && MODULES[key].title) || page.key;
    a.facts.push(`Opening ${name} — taking you there now.`);
    a.actions.push(navAction(`Open ${name}`, page.route, true, true));
    return a;
  }

  // --- no module word, but a title ("open Quality Manual") => search everywhere ---
  const query = stripQuery(q, []);
  if (query.length >= 3) {
    const order = ['documents', 'policies', 'risks', 'suppliers', 'actions', 'audits', 'nonconformances', 'equipment', 'goals', 'trainings', 'employees'];
    const hits = [];
    for (const key of order) {
      if (!canRead(user, key)) continue;
      for (const r of searchModule(key, query, 2)) hits.push({ key, row: r });
      if (hits.length >= 6) break;
    }
    if (hits.length) {
      const a = base(user);
      const top = hits[0];
      a.facts.push(`Opening ${top.row.code || titleOf(top.key, top.row)} "${titleOf(top.key, top.row)}" — taking you there now.`);
      hits.forEach((h, i) => {
        const link = `/${ROUTE[h.key]}/${h.row.id}`;
        a.actions.push(navAction(`${h.row.code || ''} — ${titleOf(h.key, h.row)}`.trim(), link, i === 0, i === 0));
        a.citations.push({ type: MODULES[h.key].title, code: h.row.code, title: titleOf(h.key, h.row), link });
      });
      return a;
    }
  }
  return null;
}

module.exports = { interpret };
