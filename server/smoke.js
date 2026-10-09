// Reusable end-to-end smoke test: node server/smoke.js
const RUN = Date.now().toString().slice(-6);
const BASE = process.env.BASE || 'http://localhost:4000';
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name); } };

async function req(path, { method = 'GET', token, body, key } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (key) headers['X-API-Key'] = key;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

(async () => {
  console.log('QualiCore smoke test →', BASE);

  // Health & UI
  const h = await fetch(BASE + '/api/health').then(r => r.json());
  ok('health endpoint', h.ok);
  const ui = await fetch(BASE + '/');
  ok('UI served', ui.status === 200 && (await ui.text()).includes('QualiCore'));

  // Auth
  const login = await req('/api/auth/login', { method: 'POST', body: { email: 'admin@qms.io', password: 'Admin123!' } });
  ok('login admin', login.status === 200 && !!login.data.token);
  const t = login.data.token;
  ok('login rejects bad credentials', (await req('/api/auth/login', { method: 'POST', body: { email: `nobody.${Date.now()}@gmail.com`, password: 'WrongPass999' } })).status === 401);
  ok('unauthenticated blocked', (await req('/api/risks')).status === 401);

  // Meta & all modules readable
  const meta = await req('/api/auth/meta', { token: t });
  ok('meta modules >= 15', Object.keys(meta.data.modules).length >= 15);
  for (const m of ['policies','goals','risks','suppliers','employees','competencies','trainings','records','documents','design','equipment','nonconformances','audits','compliance']) {
    const r = await req(`/api/${m}`, { token: t });
    ok(`module ${m}`, r.status === 200 && r.data.total > 0);
  }

  // Dashboard & search & calendar
  const dash = await req('/api/dashboard', { token: t });
  ok('dashboard kpis + attention', dash.data.kpis.length > 0 && Array.isArray(dash.data.attention));
  const s = await req('/api/search?q=steril', { token: t });
  ok('search finds results', s.data.groups.length > 0);
  const cal = await req('/api/calendar', { token: t });
  ok('calendar events', cal.data.items.length > 10);

  // AI
  for (const q of ['Show me what needs attention.', 'Which suppliers have repeated problems?', 'Which risks are getting worse?', 'Prepare a management review summary', 'Summarize RSK-0001']) {
    const a = await req('/api/ai/ask', { method: 'POST', token: t, body: { question: q } });
    ok(`AI "${q.slice(0, 30)}…"`, a.status === 200 && a.data.answer.facts.length > 0 && a.data.answer.citations.length > 0);
  }
  const g = await req('/api/ai/related/NC/NC-0001', { token: t });
  ok('related graph nodes', g.data.nodes.length > 2);

  // Workflow enforcement
  let ncs = await req('/api/nonconformances?status=open', { token: t });
  let nc = ncs.data.rows[0];
  if (!nc) {
    const created = await req('/api/nonconformances', { method: 'POST', token: t, body: { title: 'Smoke test NC', description: 'auto', type: 'nc', severity: 'minor', source: 'internal', department: 'Operations', occurred_at: new Date().toISOString().slice(0, 10) } });
    nc = created.data.row;
  }
  ok('open NC available for workflow test', !!nc);
  const bad = await req(`/api/nonconformances/${nc.id}/status`, { method: 'POST', token: t, body: { status: 'closed' } });
  ok('invalid transition rejected', bad.status === 400);

  // Human-control gate on AI recommendations
  const rec = await req('/api/ai/recommendations', { method: 'POST', token: t, body: { op: 'create_action', payload: { title: 'Smoke test action' }, rationale: 'test' } });
  ok('AI recommendation proposed', rec.status === 201);
  const dec = await req(`/api/ai/recommendations/${rec.data.id}/decide`, { method: 'POST', token: t, body: { decision: 'approve', note: 'ok' } });
  ok('human approve executes', dec.status === 200 && dec.data.result && !!dec.data.result.code);

  // Reports & export & external API
  const rep = await req('/api/reports/suppliers', { token: t });
  ok('supplier report rows', rep.data.rows.length > 0);
  const csv = await fetch(BASE + '/api/reports/suppliers/export.csv', { headers: { Authorization: `Bearer ${t}` } });
  ok('CSV export', csv.status === 200);

  const keyRes = await req('/api/admin/api-keys', { method: 'POST', token: t, body: { name: 'smoke' } });
  const v1 = await req('/api/v1/risks?limit=5', { key: keyRes.data.key });
  ok('external API v1', v1.status === 200 && v1.data.count === 5);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
