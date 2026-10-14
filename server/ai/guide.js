// QualiCore Site Guide AI — built-in knowledge, no database, no API key.
// Teaches visitors how to USE the site. Data questions fall through to the Brain.
// Anything outside the site + quality-data world is politely refused.
function L(s) { return String(s || '').toLowerCase(); }
function padded(s) { return ' ' + L(s).replace(/[^a-z0-9/]+/g, ' ') + ' '; }
function hasSub(q, ...subs) { const t = padded(q); return subs.some(s => t.includes(' ' + s) || t.includes(s)); }
function stripWords(q, ...ws) {
  let t = padded(q);
  for (const w of ws) t = t.replace(new RegExp(' ' + w + ' ', 'g'), ' ');
  return t;
}

// Vocabulary of our world (site features + quality data). Anything without
// a single one of these words is off-topic.
const WORLD = [
  'dashboard', 'home', 'risk', 'polic', 'document', 'record', 'audit', 'finding',
  'nonconformance', 'non-conformance', 'incident', 'capa', 'action', 'supplier',
  'equipment', 'calibrat', 'competenc', 'training', 'matrix', 'employee', 'people',
  'goal', 'kpi', 'objective', 'target', 'compliance', 'requirement', 'clause',
  'management review', 'mgmt', 'report', 'export', 'csv', 'pdf', 'download',
  'calendar', 'deadline', 'connection', 'map', 'graph', 'network', 'inbox',
  'notification', 'bell', 'search', 'admin', 'user', 'role', 'secur', 'password',
  '2fa', 'totp', 'activity', 'history', 'comment', 'file', 'attach', 'upload',
  'workflow', 'approv', 'status', 'stage', 'transition', 'review', 'log in',
  'login', 'sign in', 'account', 'dark', 'theme', 'night', 'light mode',
  'install', 'app', 'phone', 'home screen', 'print', 'filter', 'create',
  'add', 'new record', 'edit', 'update', 'delete', 'help', 'guide', 'tutorial',
  'how to', 'how do', 'where', 'qualicore', 'qms', 'quality', 'iso', 'trend',
  'overdue', 'open', 'closed', 'which', 'list', 'show', 'many', 'worse',
  'critical', 'high', 'score', 'ai', 'insight', 'attention', 'design',
  'track', 'rout', 'seed', 'escalat'
];
const CODE_RE = /[A-Z]{2,4}-\d{2,4}/;

// Words that never belong to this system — instant polite refusal.
const DENY = [
  'minecraft', 'fortnite', 'roblox', 'gta', 'fifa', 'game', 'gaming', 'gamer',
  'free download', 'download free', 'crack', 'torrent', 'hack', 'cheat',
  'movie', 'film', 'series', 'netflix', 'song', 'music', 'video', 'youtube',
  'tiktok', 'instagram', 'football', 'soccer', 'sport', 'cricket',
  'homework', 'exam', 'math', 'recipe', 'cook', 'food', 'clothes', 'shopping',
  'crypto', 'bitcoin', 'weather', 'news', 'joke', 'story', 'poem', 'love',
  'girlfriend', 'boyfriend', 'prayer', 'religion', 'politics'
];

function isOffTopic(question) {
  const q = L(question);
  if (CODE_RE.test(question)) return false;
  if (/\b(hi|hello|hey|salam|thanks|thank you|help|ok|yes|no)\b/.test(q)) return false;
  return !WORLD.some(w => q.includes(w));
}

function offTopicAnswer(user) {
  return {
    intent: 'off_topic', role: user.role, scope: 'site guide (built-in knowledge)',
    generatedAt: new Date().toISOString(),
    facts: [
      "I'm the QualiCore guide — I answer questions about using this site (its pages, features and how-tos) and about your quality data.",
      "I can't help with that topic, and I never guess."
    ],
    findings: [],
    recommendations: [
      'Try: "Where are the reports?"',
      'Try: "How do I create a risk?"',
      'Try: "Which actions are overdue?"'
    ],
    citations: [], evidence: []
  };
}

function base(user) {
  return {
    intent: 'site_guide', role: user.role, scope: 'site guide (built-in knowledge)',
    generatedAt: new Date().toISOString(),
    facts: [], findings: [], recommendations: [], citations: [], evidence: []
  };
}

// --- Small talk (only when the message is basically JUST small talk) ---
function smallTalk(question, user) {
  const q = L(question);
  const rest = (re) => stripWords(q, 'please').replace(re, ' ').replace(/[^a-z]/g, '').length < 3;
  if (/\b(hi|hello|hey|salam|marhaba|sabah|masa|good morning|good afternoon|good evening)\b/.test(q) && rest(/\b(hi|hello|hey|salam|marhaba|sabah|masa|good|morning|afternoon|evening)\b/g)) {
    const a = base(user);
    a.facts.push(`Hello ${user.name ? user.name.split(' ')[0] : 'there'}! I'm the QualiCore guide — ask me anything about using this site.`);
    a.recommendations.push('Try: "What is this site?", "Where are the reports?", "How do I add a supplier?"');
    return a;
  }
  if (/\b(thank|thanks|shukran)\b/.test(q) && rest(/\b(thank|thanks|thankyou|shukran|you|very|much|so)\b/g)) {
    const a = base(user);
    a.facts.push("You're welcome! Anything else about the site, just ask.");
    return a;
  }
  if (/who are you|what are you|your name|about yourself/.test(q)) {
    const a = base(user);
    a.facts.push("I'm the built-in QualiCore guide. I explain every page and feature of this system and answer questions about your quality data — instantly, no internet needed.");
    a.facts.push('I stay on topic: this site and your data. Anything else, I politely decline.');
    return a;
  }
  return null;
}

// --- Topic library: [keywords, title, lines, link] ---
const TOPICS = [
  [['what is this', 'what is qualicore', 'what is qms', 'about this site', 'about the site', 'what is this site', 'what does this site', 'what is the system'],
   'What QualiCore is',
   ['QualiCore is a Quality Management System (QMS) — one website holding a whole quality world for companies and factories.',
    'It tracks documents, risks, audits, mistakes (NCs), tasks, suppliers, machines, people training, goals and compliance — with charts, reports and an AI helper.',
    'Companies use systems like this to earn ISO 9001 certificates and keep bad products away from customers.'],
   '/'],
  [['help', 'what can you do', 'how to use', 'how does this', 'guide me', 'tutorial', 'getting started'],
   'What I can teach you',
   ['I can explain every section: Dashboard, Risks, Policies, Documents, Audits, NC & Incidents, Actions, Suppliers, Equipment, People, Goals, Compliance, Reviews, Reports, Calendar, Connections, Inbox and Notifications.',
    'I can teach every move: create, edit, approve, comment, attach files, export CSV/PDF, print, dark mode, phone install, search shortcuts.',
    'Just ask, e.g. "How do I export a report?" or "Where are overdue actions?"'],
   '/ai'],
  [['log in', 'login', 'sign in', 'password', 'account', 'credentials', 'logged out'],
   'Logging in and accounts',
   ['Open the site and sign in with the account your administrator gave you.',
    'A demo account is shown on the login screen itself.',
    'Change your password and turn on two-factor login (2FA) under My security in the top-right user menu → /security.'],
   '/security'],
  [['dashboard', 'home page', 'overview', 'attention'],
   'Dashboard (home)',
   ['The dashboard is your morning briefing: stat cards (high risks, overdue actions, open NCs, supplier issues, expiring qualifications, documents due, calibrations due).',
    '"What needs my attention?" lists the riskiest items first — each row links straight to the record.',
    'Below: AI insights, KPI performance, risk matrix, NC trend, deadlines for the next 14 days, and recent activity.'],
   '/'],
  [['risk', 'risk register'],
   'Risk Register — /risks',
   ['Each risk scores likelihood × severity twice: inherent (before controls) and residual (after controls). High residual = danger.',
    'Create: Risks → New record → title, likelihood, severity, treatment (mitigate/accept/transfer/avoid), owner, review date.',
    'Ask me "which risks are getting worse?" and I answer from live data.'],
   '/risks'],
  [['polic', 'policies'],
   'Policies — /policies',
   ['Company policies with versions, owners and review dates. Open one to read, check its History tab, comment, or attach files.',
    'Policies due for review appear as warnings — re-approve them through the workflow buttons.'],
   '/policies'],
  [['document', 'tracking dashboard', 'routing dashboard', 'doc control', 'seed'],
   'Documents — /documents',
   ['Full document control: versions, categories, departments, review stages and reviewers.',
    'Two dashboards on top: Tracking (where every document sits) and Routing (automatic review routes — press "Seed Default Rules" once to load the 8 standard routes, then "Check escalations").',
    'Overdue reviews glow red — filter by stage, reviewer or department.'],
   '/documents'],
  [['audit', 'finding'],
   'Audits — /audits',
   ['Plan audits with dates, auditors and checklists; record findings per clause with type and severity.',
    'Open findings stay visible until closed — close them with evidence attached.'],
   '/audits'],
  [['nonconformance', 'non-conformance', 'nc ', 'incident', 'capa'],
   'NC & Incidents — /nonconformances',
   ['Log every mistake, defect or accident: what happened, severity, department, root cause.',
    'Serious ones get CAPA (corrective actions) tracked to closure — nothing disappears quietly.'],
   '/nonconformances'],
  [['action', 'actions hub', 'to-do', 'todo', 'task'],
   'Actions Hub — /actions',
   ['Every task in the system with owner, priority and due date. Use ?overdue=1 to see only late ones, ?owner=me for yours.',
    'Overdue + critical actions trigger escalation to management.'],
   '/actions'],
  [['supplier', 'vendor', 'conditional'],
   'Suppliers — /suppliers',
   ['Supplier profiles with status (approved / pending / conditional), risk level and audit dates.',
    'Evaluations score suppliers per period; below 70% twice in a row → move to conditional.',
    'Incidents linked to a supplier build a repeat-offender pattern the AI flags automatically.'],
   '/suppliers'],
  [['equipment', 'calibrat', 'machine'],
   'Equipment — /equipment',
   ['Machines and instruments with calibration due dates, qualifications and status.',
    'Calibrations due turn red when overdue — schedule from the record.'],
   '/equipment'],
  [['competenc', 'training', 'matrix', 'people', 'employee', 'qualification', 'skill'],
   'People & Competency — /employees, /competencies, /trainings, /competency-matrix',
   ['Employees hold competencies assessed against required levels; the Competency Matrix grid shows gaps at a glance.',
    'Trainings schedule sessions and track completion per person. Expiring qualifications warn on the dashboard.'],
   '/competency-matrix'],
  [['goal', 'kpi', 'objective', 'target'],
   'Objectives & KPIs — /goals',
   ['Goals with numeric targets; entries per period build trends (improving / flat / deteriorating) and on/off-target badges.',
    'Ask me "which KPIs are off target?" for a live answer.'],
   '/goals'],
  [['compliance', 'requirement', 'clause', 'iso'],
   'Compliance — /compliance',
   ['Regulatory requirements per framework and clause, each assessed compliant / gaps / non-compliant.',
    'Non-compliant items are the most visible exposure in the company — close them with linked actions.'],
   '/compliance'],
  [['management review', 'mgmt review', 'mgmt-review'],
   'Management Review — /mgmt-reviews',
   ['Periodic reviews with auto-collected inputs. The "AI draft" button writes key findings + suggested decisions as a DRAFT — a human must review and issue it.',
    'Nothing is issued by the AI alone, ever.'],
   '/mgmt-reviews'],
  [['report', 'csv', 'pdf', 'export'],
   'Reports & Export — /reports',
   ['Pick a report chip on top (risks, suppliers, documents, audits, actions, goals, compliance, reviews, equipment) to see charts + full tables.',
    'Every report has PDF and CSV download buttons — the CSV opens in Excel.'],
   '/reports'],
  [['calendar', 'deadline', 'schedule', 'upcoming'],
   'Calendar — /calendar',
   ['All due dates in one calendar: action deadlines, reviews, calibrations, audits.',
    'The dashboard also lists everything due in the next 14 days.'],
   '/calendar'],
  [['connection', 'connections map', 'network', 'related', 'linked'],
   'Connections Map — /connections',
   ['A visual graph of how everything links: risks to actions, NCs to suppliers, documents to reviews.',
    'Open any record → "Related information" shows its personal mini-map. Ask me "show everything connected to NC-0005".'],
   '/connections'],
  [['inbox'],
   'Inbox — /inbox',
   ['Your personal pile: items assigned to you and waiting — approvals, reviews, overdue tasks. Work it top-down.'],
   '/inbox'],
  [['notification', 'bell', 'mark read'],
   'Notifications',
   ['The bell in the top bar counts unread items. Open it to preview; "Mark all as read" (✓ All) clears it.',
    'Full history lives at /notifications.'],
   '/notifications'],
  [['watch', 'watchdog', 'monitor a record', 'notify me when', 'alert me', 'guard'],
   'Watchdog — guard records',
   ['Tell me "watch RSK-0001" and I tap Confirm: I then check that record every scheduler sweep and bell you in Notifications the moment its status or key fields change.',
    '"What am I watching?" lists your guarded records; "stop watching RSK-0001" ends one.'],
   '/notifications'],
  [['search', 'find', 'global search', 'shortcut', 'slash'],
   'Search',
   ['The top bar searches everything — codes, titles, people. Press "/" anywhere to jump into it instantly.',
    'Enter runs a full search; or pick a result to jump straight to the record. Asking a question runs it through the AI (/ai).'],
   '/search'],
  [['admin', 'user management', 'role', 'permission'],
   'Administration — /admin',
   ['Admins manage users, roles and permissions, plus system settings. Restricted to administrator accounts.'],
   '/admin'],
  [['security', '2fa', 'totp', 'change password'],
   'Security — /security',
   ['Change your password and enable two-factor login (2FA/TOTP app codes) from the user menu → My security.'],
   '/security'],
  [['activity', 'audit trail', 'log', 'who changed'],
   'Activity — /activity',
   ['Every change by every user, timestamped: who created, edited, approved or deleted what. The Hole Truth Log — nothing hides.'],
   '/activity'],
  [['create', 'new record', 'add '],
   'Creating records',
   ['Open any section (e.g. /risks) → "New record" → fill the fields (starred ones required) → "Create record".',
    'It appears in the list instantly with its auto-generated code (RSK-, DOC-, ACT-…).'],
   null],
  [['edit', 'update record', 'modify', 'change record'],
   'Editing records',
   ['Open the record → Edit → change fields → Save changes. The old values stay visible in the History tab.',
    'Some fields lock after workflow moves forward — that is intentional.'],
   null],
  [['workflow', 'approv', 'transition', 'change status', 'review ', 'issue ', 'close record'],
   'Workflows and approvals',
   ['Records move through stages with buttons (Submit → Approve → Issue/Close). Each click asks for an optional comment and writes History + Activity.',
    'Only permitted roles see each button — if a button is missing, your role cannot take that step.'],
   null],
  [['comment'],
   'Comments',
   ['Open any record → Comments tab → write → Post. Everyone watching the record gets notified.'],
   null],
  [['attach', 'upload', 'file'],
   'Attaching files',
   ['Open the record → Files/attachments → Upload → pick the file. Evidence (photos, certificates, reports) lives with the record forever.'],
   null],
  [['history'],
   'History tab',
   ['Every record has a History tab: every status change, edit and comment, newest first, with who and when.',
    'Empty history simply shows a friendly empty message — that is normal for new records.'],
   null],
  [['dark', 'theme', 'night mode', 'light mode'],
   'Dark mode',
   ['Moon button in the top bar (next to notifications): dark on, sun: light off. Your choice is remembered on this device.'],
   null],
  [['install', 'phone app', 'home screen', 'mobile app', 'pwa'],
   'Install as a phone app (free)',
   ['iPhone: open the site in Safari → Share → Add to Home Screen → Add. A QualiCore icon appears; it opens fullscreen like a real app.',
    'Android: menu → Add to Home screen / Install app. No store, no fees.'],
   null],
  [['print'],
   'Printing',
   ['Any page prints cleanly: menus and buttons hide automatically, tables and cards stay. Just use browser Print / Save as PDF.'],
   null]
];

function scoreTopic(q, keywords) {
  let s = 0;
  for (const k of keywords) {
    if (padded(q).includes(' ' + k) || L(q).includes(k)) s += k.split(' ').length + 1;
  }
  return s;
}

function answerSiteGuide(question, user) {
  const q = question;
  // Hard off-topic anchors (games, free downloads, entertainment...): refuse at once.
  const ql = L(q);
  if (DENY.some(w => ql.includes(w))) return offTopicAnswer(user);
  // Data questions (entity codes, data-led verbs) belong to the Brain, not the guide.
  if (CODE_RE.test(q)) return null;
  if (/^(which|list|show|give|how many|count|what are|tell me)\b/i.test(q) && !/how (do|can|to)|where|help|guide/i.test(q)) return null;
  const st = smallTalk(q, user);
  if (st) return st;
  let best = null, bestScore = 0;
  for (const [keys, title, lines, link] of TOPICS) {
    const s = scoreTopic(q, keys);
    if (s > bestScore) { bestScore = s; best = { title, lines, link }; }
  }
  if (!best || bestScore <= 0) return null;
  const a = base(user);
  a.facts.push(best.title + ':');
  for (const line of best.lines) a.facts.push(line);
  if (best.link) a.facts.push('Open it: ' + best.link);
  return a;
}

module.exports = { answerSiteGuide, isOffTopic, offTopicAnswer };
