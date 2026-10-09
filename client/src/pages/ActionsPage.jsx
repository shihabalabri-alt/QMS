import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Icon, Badge, Spinner, EmptyState, Modal, showToast, fmtDate } from '../lib/ui';
import { useAuth } from '../App';
import { FieldInput } from './ModuleList';

const SOURCES = ['risk', 'nonconformance', 'audit', 'review', 'supplier', 'equipment', 'competency', 'document', 'policy', 'goal', 'compliance', 'design', 'manual'];
const SOURCE_LABELS = {
  risk: 'Risk Management', nonconformance: 'Non-Conformance Management', capa: 'CAPA', incident: 'Incident Management',
  audit: 'Audits', review: 'Management Review', supplier: 'Supplier Management', equipment: 'Equipment Management',
  competency: 'Competency Management', document: 'Documents Management', policy: 'Policy Management',
  goal: 'Objectives & KPIs', compliance: 'Compliance Management', design: 'Design Reviews', manual: 'Manual'
};

export default function ActionsPage() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [stats, setStats] = useState(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(params.get('status') || 'all');
  const [owner] = useState(params.get('owner'));
  const [overdue] = useState(params.get('overdue'));
  const [priority, setPriority] = useState('all');
  const [source, setSource] = useState('all');
  const [creating, setCreating] = useState(false);
  const [focusRow, setFocusRow] = useState(null);
  const [miniMap, setMiniMap] = useState(null);

  async function load() {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (status !== 'all') qs.set('status', status);
    if (owner === 'me') qs.set('owner', 'me');
    if (overdue === '1') qs.set('overdue', '1');
    if (priority !== 'all') qs.set('priority', priority);
    if (source !== 'all') qs.set('source', source);
    setData(await api.get(`/actions?${qs}`));
    setStats(await api.get('/actions/stats'));
  }
  useEffect(() => { load(); }, [q, status, priority, source]);

  useEffect(() => {
    const focus = params.get('focus');
    if (focus) api.get(`/actions/${focus}`).then(d => setFocusRow(d)).catch(() => {});
  }, [params]);

  const isVerifier = ['admin', 'quality_manager', 'management', 'manager', 'qa', 'investigator'].includes(user.role);

  async function act(row, action, body) {
    try {
      await api.post(`/actions/${row.id}/${action}`, body || {});
      showToast(`Action ${action}d`);
      setFocusRow(null); load();
    } catch (e) { showToast(e.message, 'error'); }
  }

  return (
    <div className="page-wrap">
      <div className="page-head">
        <div>
          <h1 className="page-title"><Icon name="action" /> Actions Hub</h1>
          <div className="page-sub">Every corrective and improvement action across the QMS in one place</div>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={15} /> New action</button>
      </div>

      {stats && (
        <div className="stat-grid mb-4">
          <div className="stat-card"><div className="stat-value">{stats.open}</div><div className="stat-label">Open / in progress</div></div>
          <div className="stat-card" style={stats.overdue ? { borderColor: 'var(--danger)' } : null}><div className="stat-value" style={stats.overdue ? { color: 'var(--danger)' } : null}>{stats.overdue}</div><div className="stat-label">Overdue</div></div>
          <div className="stat-card"><div className="stat-value">{stats.dueThisWeek}</div><div className="stat-label">Due this week</div></div>
          <div className="stat-card"><div className="stat-value">{stats.critical}</div><div className="stat-label">High / critical open</div></div>
          <div className="stat-card"><div className="stat-value">{stats.mine}</div><div className="stat-label">Mine{stats.mineOverdue ? ` (${stats.mineOverdue} overdue)` : ''}</div></div>
        </div>
      )}

      <div className="filter-bar">
        <input className="input" style={{ minWidth: 220 }} placeholder="Search actions…" value={q} onChange={e => setQ(e.target.value)} />
        <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
          {['all', 'open', 'in_progress', 'completed', 'verified', 'cancelled'].map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <select className="input" value={priority} onChange={e => setPriority(e.target.value)}>
          {['all', 'low', 'medium', 'high', 'critical'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" value={source} onChange={e => setSource(e.target.value)}>
          {['all', ...SOURCES].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="card table-wrap">
        {!data ? <Spinner /> : data.rows.length === 0 ? <EmptyState>No actions match.</EmptyState> : (
          <table className="data">
            <thead><tr><th>Code</th><th>Action</th><th>Source</th><th>Owner</th><th>Priority</th><th>Due</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {data.rows.map(a => (
                <tr key={a.id}>
                  <td><span className="code-chip">{a.code}</span></td>
                  <td style={{ maxWidth: 320 }}>{a.title}{a.overdue && <span className="badge b-red" style={{ marginLeft: 6 }}>overdue</span>}</td>
                  <td>{a.source_code ? (a.source_record_id
                    ? <Link to={`/${a.source_route || sourceRoute(a.source_type)}/${a.source_record_id}`} title={`Open ${a.sourceTitle || a.source_code}`}><span className="code-chip">{a.source_code}</span></Link>
                    : <span className="code-chip" title={a.sourceTitle || ''}>{a.source_code}</span>) : a.source_type}</td>
                  <td>{a.owner_name || '—'}</td>
                  <td><Badge value={a.priority} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(a.due_date)}</td>
                  <td><Badge value={a.status} /></td>
                  <td><button className="btn sm ghost" onClick={() => { api.get(`/actions/${a.id}`).then(setFocusRow); api.get(`/ai/related/Action/${a.code}`).then(setMiniMap).catch(() => setMiniMap(null)); }}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create modal */}
      {creating && <CreateModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} user={user} rolesList={rolesList} />}

      {/* Detail modal */}
      {focusRow && (
        <Modal wide title={`${focusRow.row.code} — ${focusRow.row.title}`} onClose={() => setFocusRow(null)}>
          <div className="flex gap-2 wrap mb-3">
            <Badge value={focusRow.row.status} /><Badge value={focusRow.row.priority} />
            {focusRow.row.due_date && <span className="muted small">Due {fmtDate(focusRow.row.due_date)}</span>}
            {focusRow.row.owner_name && <span className="muted small">Owner: <b>{focusRow.row.owner_name}</b></span>}
            {focusRow.row.recurrence !== 'none' && <span className="badge b-indigo">recurs {focusRow.row.recurrence}</span>}
          </div>

          {/* Source Record — links back to the exact QMS record that raised this action */}
          {focusRow.row.source_type && focusRow.row.source_type !== 'manual' && (
            <div className="card card-pad mb-3" style={{ background: '#f0f6ff', border: '1px solid #bcd7f7', padding: '12px 14px' }}>
              <div className="muted small" style={{ fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                <Icon name="link" size={12} /> Source record — this action was raised from
              </div>
              <div className="flex items-center gap-2 wrap">
                <span className="badge b-indigo">{SOURCE_LABELS[focusRow.row.source_type] || focusRow.row.source_type}</span>
                {focusRow.source ? (
                  <>
                    <span className="code-chip">{focusRow.source.code}</span>
                    <b style={{ flex: 1, minWidth: 140 }}>{focusRow.source.title}</b>
                    {focusRow.source.status && <Badge value={focusRow.source.status} />}
                    <button className="btn sm primary" onClick={() => { nav(focusRow.source.link); setFocusRow(null); }}>
                      Open source record →
                    </button>
                  </>
                ) : (
                  <span className="muted small">Source record {focusRow.row.source_code || focusRow.row.source_id} could not be found (it may have been deleted).</span>
                )}
              </div>
            </div>
          )}
          {/* Real connection map — live relationships from the database */}
          {focusRow.row.source_type && focusRow.row.source_type !== 'manual' && (
            <div className="card card-pad mb-3" style={{ background: '#f8faff' }}>
              <div className="flex justify-between items-center" style={{ marginBottom: 6 }}>
                <div className="muted small" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  <Icon name="link" size={12} /> Connection map — how this action fits in the QMS
                </div>
                <button className="btn sm ghost" onClick={() => { nav('/connections'); setFocusRow(null); }}>Full map →</button>
              </div>
              {miniMap && miniMap.nodes && miniMap.nodes.length > 1 ? (
                <ActionMiniMap graph={miniMap} centerCode={focusRow.row.code} onOpen={link => { nav(link); setFocusRow(null); }} />
              ) : (
                <div className="muted small">Loading connections… (or no links yet)</div>
              )}
            </div>
          )}
          {focusRow.row.description && <p className="small">{focusRow.row.description}</p>}
          {focusRow.row.verification_notes && <div className="alert info mb-3"><b>Notes:</b> {focusRow.row.verification_notes}</div>}

          <div className="flex gap-2 wrap mb-4">
            {['open', 'in_progress'].includes(focusRow.row.status) &&
              <button className="btn success sm" onClick={() => act(focusRow.row, 'complete')}>Mark completed</button>}
            {focusRow.row.status === 'completed' &&
              <button className="btn primary sm" disabled={!isVerifier} title={isVerifier ? '' : 'Requires quality/management role'} onClick={() => act(focusRow.row, 'verify')}>Verify (human check)</button>}
            {['completed', 'verified', 'cancelled'].includes(focusRow.row.status) && isVerifier &&
              <button className="btn sm" onClick={() => act(focusRow.row, 'reopen')}>Reopen</button>}
          </div>

          <h3 className="card-title">Comments ({focusRow.comments.length})</h3>
          {focusRow.comments.map(cm => (
            <div key={cm.id} className="alert info mb-2"><b>{cm.user_name}</b> <span className="muted small">{fmtDate(cm.created_at)}</span><br />{cm.body}</div>
          ))}
          <CommentBox onPost={async text => { await api.post(`/actions/${focusRow.row.id}/comments`, { body: text }); setFocusRow(await api.get(`/actions/${focusRow.row.id}`)); }} />

          <h3 className="card-title mt-3">History</h3>
          {focusRow.history.slice(0, 6).map(h => (
            <div key={h.id} className="tl-item"><span className="tl-dot" /><div><b>{h.user_name || h.user_name2 || 'System'}</b> {String(h.action).replace(/_/g, ' ')} <span className="tl-muted">{fmtDate(h.created_at)}</span></div></div>
          ))}
        </Modal>
      )}
    </div>
  );
}

function sourceRoute(t) { return ({ risk: 'risks', nonconformance: 'nonconformances', audit: 'audits', review: 'mgmt-reviews', supplier: 'suppliers', equipment: 'equipment', competency: 'competencies', document: 'documents', policy: 'policies', goal: 'goals', compliance: 'compliance', design: 'design' })[t] || 'dashboard'; }

// Mini visual map: the action in the center, connected records around it (live data)
function ActionMiniMap({ graph, centerCode, onOpen }) {
  const W = 560, H = 280, CX = W / 2, CY = H / 2;
  const others = (graph.nodes || []).filter(n => n.rel && n.rel !== 'query origin').slice(0, 10);
  const TYPE_COLORS = {
    Risk: '#7c3aed', NC: '#dc2626', CAPA: '#b91c1c', Incident: '#ea580c', Supplier: '#2e8f1f',
    Document: '#0369a1', Policy: '#6d28d9', Equipment: '#0891b2', Audit: '#b45309', KPI: '#0f766e',
    Compliance: '#4d7c0f', Person: '#475569', 'Design review': '#be185d', 'Mgmt review': '#1d4ed8',
    Training: '#9333ea', Employee: '#475569', Competency: '#c026d3', Action: '#1565d0'
  };
  const colorFor = t => TYPE_COLORS[t] || '#64748b';
  const pos = new Map();
  others.forEach((n, i) => {
    const ang = (i / Math.max(1, others.length)) * Math.PI * 2 - Math.PI / 2;
    pos.set(n.label + i, { x: CX + Math.cos(ang) * 205, y: CY + Math.sin(ang) * 92, node: n });
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%' }}>
      {[...pos.entries()].map(([key, p]) => (
        <line key={'l' + key} x1={CX} y1={CY} x2={p.x} y2={p.y} stroke="#b9c6dd" strokeWidth="1.4" opacity="0.8" />
      ))}
      <circle cx={CX} cy={CY} r="30" fill="#0d1b3d" />
      <text x={CX} y={CY - 2} textAnchor="middle" fill="#fff" fontSize="10" fontWeight="700">{centerCode}</text>
      <text x={CX} y={CY + 11} textAnchor="middle" fill="#9db8e8" fontSize="7.5">ACTION</text>
      {[...pos.entries()].map(([key, p]) => {
        const n = p.node;
        return (
          <g key={key} style={{ cursor: n.link ? 'pointer' : 'default' }} onClick={() => n.link && onOpen(n.link)}>
            <circle cx={p.x} cy={p.y} r="17" fill={colorFor(n.type)} stroke="#fff" strokeWidth="1.5" />
            <text x={p.x} y={p.y + 3} textAnchor="middle" fill="#fff" fontSize="7" fontWeight="700">{(n.code || n.type).slice(0, 8)}</text>
            <text x={p.x} y={p.y + 30} textAnchor="middle" fill="#334155" fontSize="7.5">{n.type}</text>
            <title>{`${n.type}: ${n.label}\n${n.rel}`}</title>
          </g>
        );
      })}
      {others.length === 0 && <text x={CX} y={CY + 60} textAnchor="middle" fill="#94a3b8" fontSize="10">No connections found</text>}
    </svg>
  );
}

function CommentBox({ onPost }) {
  const [text, setText] = useState('');
  return (
    <div className="flex gap-2">
      <input className="input" style={{ flex: 1 }} placeholder="Add a comment…" value={text} onChange={e => setText(e.target.value)} />
      <button className="btn sm primary" onClick={() => { if (text.trim()) { onPost(text); setText(''); } }}>Post</button>
    </div>
  );
}

function CreateModal({ onClose, onSaved, user, rolesList }) {
  const users = React.useRef(null);
  const [form, setForm] = useState({ title: '', description: '', owner_id: user.id, priority: 'medium', due_date: '', recurrence: 'none', source_type: 'manual', source_code: '' });
  const [userOpts, setUserOpts] = useState([]);
  const [err, setErr] = useState('');
  React.useEffect(() => { api.get('/refs/users').then(setUserOpts); }, []);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  async function save() {
    try { await api.post('/actions', form); showToast('Action created'); onSaved(); }
    catch (e) { setErr(e.message); }
  }
  return (
    <Modal title="New action" onClose={onClose}>
      {err && <div className="alert critical mb-3">{err}</div>}
      <div className="field mb-3"><label>Title *</label><input value={form.title} onChange={e => set('title', e.target.value)} /></div>
      <div className="field mb-3"><label>Description</label><textarea value={form.description} onChange={e => set('description', e.target.value)} /></div>
      <div className="form-grid">
        <div className="field"><label>Owner</label>
          <select value={form.owner_id} onChange={e => set('owner_id', Number(e.target.value))}>{userOpts.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}</select>
        </div>
        <div className="field"><label>Priority</label>
          <select value={form.priority} onChange={e => set('priority', e.target.value)}>{['low', 'medium', 'high', 'critical'].map(p => <option key={p}>{p}</option>)}</select>
        </div>
        <div className="field"><label>Due date</label><input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} /></div>
        <div className="field"><label>Recurrence</label>
          <select value={form.recurrence} onChange={e => set('recurrence', e.target.value)}>{['none', 'weekly', 'monthly', 'quarterly'].map(r => <option key={r}>{r}</option>)}</select>
        </div>
        <div className="field"><label>Source module</label>
          <select value={form.source_type} onChange={e => set('source_type', e.target.value)}>{SOURCES.map(s => <option key={s}>{s}</option>)}</select>
        </div>
        <div className="field"><label>Source reference (code)</label><input placeholder="NC-0005" value={form.source_code} onChange={e => set('source_code', e.target.value)} /></div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Create action</button>
      </div>
    </Modal>
  );
}
