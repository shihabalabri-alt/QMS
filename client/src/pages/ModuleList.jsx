import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Icon, Badge, RiskPill, Spinner, EmptyState, Modal, ToastHost, showToast, fmtDate, daysBadge } from '../lib/ui';
import { useAuth } from '../App';
import { DocumentTrackingDashboard } from '../components/DocumentTrackingDashboard';
import { DocumentRoutingDashboard } from '../components/DocumentRoutingDashboard';

export function FieldInput({ field, value, onChange, refsCache }) {
  const [options, setOptions] = useState(null);
  useEffect(() => {
    if (field.type === 'ref' && field.ref) {
      const table = field.ref.table;
      if (refsCache?.[table]) { setOptions(refsCache[table]); return; }
      api.get(`/refs/${table}`).then(rows => setOptions(rows)).catch(() => setOptions([]));
    }
  }, [field.type]);
  if (!field) return null;
  const v = value ?? '';
  switch (field.type) {
    case 'textarea': return <textarea value={v} onChange={e => onChange(e.target.value)} />;
    case 'select': return (
      <select value={v} onChange={e => onChange(e.target.value)}>
        <option value="">—</option>
        {(field.options || []).map(o => <option key={o} value={o}>{String(o).replace(/_/g, ' ')}</option>)}
      </select>
    );
    case 'number': return <input type="number" step={field.step || '1'} min={field.min} max={field.max} value={v} onChange={e => onChange(e.target.value)} />;
    case 'date': return <input type="date" value={v} onChange={e => onChange(e.target.value)} />;
    case 'boolean': return <select value={String(v)} onChange={e => onChange(e.target.value === 'true')}><option value="false">No</option><option value="true">Yes</option></select>;
    case 'ref': {
      if (field.ref?.table === 'users') {
        if (!options) return <select disabled><option>Loading…</option></select>;
        return <select value={String(v)} onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}><option value="">—</option>{(options || []).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>;
      }
      if (!options) return <select disabled><option>Loading…</option></select>;
      return <select value={String(v)} onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}><option value="">—</option>{(options || []).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>;
    }
    default: return <input value={v} onChange={e => onChange(e.target.value)} />;
  }
}

export function RecordForm({ moduleKey, cfg, initial, onSaved, onCancel }) {
  const [form, setForm] = useState(() => {
    const f = {};
    for (const fld of cfg.fields) f[fld.name] = initial ? initial[fld.name] : (fld.type === 'boolean' ? false : '');
    return f;
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  async function save() {
    setBusy(true); setErr('');
    try {
      if (initial) await api.put(`/${moduleKey}/${initial.id}`, form);
      else await api.post(`/${moduleKey}`, form);
      showToast(initial ? 'Record updated' : 'Record created');
      onSaved();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <>
      {err && <div className="alert critical mb-3">{err}</div>}
      <div className="form-grid">
        {cfg.fields.map(f => (
          <div key={f.name} className={`field ${f.span === 2 ? 'span-2' : ''}`}>
            <label>{f.label} {f.required && <span className="req">*</span>}</label>
            <FieldInput field={f} value={form[f.name]} onChange={v => set(f.name, v)} />
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : initial ? 'Save changes' : 'Create record'}</button>
      </div>
    </>
  );
}

function Cell({ col, row }) {
  const v = row[col.name];
  switch (col.type) {
    case 'status': return <Badge value={v} />;
    case 'date': return <span style={{ whiteSpace: 'nowrap' }}>{fmtDate(v)}</span>;
    case 'num': return v ?? '—';
    case 'risk': return <RiskPill score={row[col.name]} rating={row[col.computed + '_rating']} />;
    case 'user': case 'employee': return row[col.name.replace('_id', '_name')] || v || '—';
    default:
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return fmtDate(v);
      if (col.name === 'code') return <span className="code-chip">{v}</span>;
      const s = v === null || v === undefined || v === '' ? '—' : String(v);
      return s.length > 70 ? s.slice(0, 70) + '…' : s;
  }
}

export default function ModuleList() {
  const { module: moduleKey } = useParams();
  const { metaModules, permissions } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const apiKeyName = moduleKey.includes('-') ? moduleKey.replace(/-/g, '_') : moduleKey;
  const cfg = metaModules?.[apiKeyName];

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(params.get('q') || '');
  const [status, setStatus] = useState(params.get('status') || 'all');
  const [mine, setMine] = useState(params.get('mine') === '1');
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState('list');
  const [filters, setFilters] = useState({
    category: '', department: '', current_stage: '', assigned_reviewer_id: '',
    reviewer_department: '', review_priority: '', routing_status: '', routing_rule_id: '',
    owner_id: '', sla_breached: '', overdue: '', days_in_stage_min: '', days_in_stage_max: '',
    escalation_level_min: ''
  });

  useEffect(() => { setLoading(true); }, [moduleKey]);

  useEffect(() => {
    if (!cfg) return;
    const t = setTimeout(() => {
      const qs = new URLSearchParams();
      if (q) qs.set('q', q);
      if (status !== 'all') qs.set('status', status);
      if (mine) qs.set('owner', 'me');
      if (apiKeyName === 'documents') {
        Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v); });
      }
      api.get(`/${apiKeyName}?${qs}`).then(setData).catch(e => setData({ error: e.message })).finally(() => setLoading(false));
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [apiKeyName, moduleKey, q, status, mine, filters, cfg]);

  if (!metaModules) return <Spinner />;
  if (!cfg) return <div className="page-wrap"><div className="notfound">
    <div className="notfound-code">404</div>
    <h2 className="page-title" style={{ justifyContent: 'center' }}>Unknown section “{moduleKey}”</h2>
    <p className="page-sub">This page doesn't exist or you don't have access to it.</p>
    <button className="btn primary mt-3" onClick={() => nav('/')}>Back to dashboard</button>
  </div></div>;

  const canCreate = cfg.can.create;

  const isDocuments = apiKeyName === 'documents';

  return (
    <div className="page-wrap">
      <ToastHost />
      <div className="page-head">
        <div>
          <h1 className="page-title"><Icon name={cfg.icon} /> {cfg.title}</h1>
          <div className="page-sub">{cfg.desc} · {data ? `${data.total} record(s)` : ''}</div>
        </div>
        {canCreate && <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={15} /> New record</button>}
      </div>

      <div className="tabs" style={{ marginBottom: 12 }}>
        <span className={`tab ${tab === 'list' ? 'active' : ''}`} onClick={() => setTab('list')}>List View</span>
        {isDocuments && <span className={`tab ${tab === 'tracking' ? 'active' : ''}`} onClick={() => setTab('tracking')}>Tracking Dashboard</span>}
        {isDocuments && <span className={`tab ${tab === 'routing' ? 'active' : ''}`} onClick={() => setTab('routing')}>Routing Dashboard</span>}
      </div>

      {tab === 'tracking' && isDocuments && <DocumentTrackingDashboard />}
      {tab === 'routing' && isDocuments && <DocumentRoutingDashboard />}

      {tab === 'list' && (
        <>
          <div className="filter-bar">
            <input className="input" style={{ minWidth: 220 }} placeholder={`Search ${cfg.title.toLowerCase()}…`} value={q} onChange={e => setQ(e.target.value)} />
            {cfg.statuses && (
              <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
                <option value="all">All statuses</option>
                {cfg.statuses.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} /> Assigned to me
            </label>
          </div>

          {isDocuments && (
            <div className="filter-bar" style={{ marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
              <select className="input" value={filters.category} onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}>
                <option value="">Category</option>
                {['Manual', 'Procedure', 'Work Instruction', 'Specification', 'Protocol', 'Form', 'Plan'].map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <select className="input" value={filters.department} onChange={e => setFilters(f => ({ ...f, department: e.target.value }))}>
                <option value="">Department</option>
                {['Quality', 'Operations', 'Engineering', 'Supply Chain', 'HR', 'IT'].map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <select className="input" value={filters.current_stage} onChange={e => setFilters(f => ({ ...f, current_stage: e.target.value }))}>
                <option value="">Current Stage</option>
                {['draft', 'review', 'approval', 'distribution', 'effective', 'archived'].map(o => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
              </select>
              <select className="input" value={filters.routing_status} onChange={e => setFilters(f => ({ ...f, routing_status: e.target.value }))}>
                <option value="">Routing Status</option>
                {['pending', 'in_progress', 'completed', 'escalated', 'rejected', 'on_hold'].map(o => <option key={o} value={o}>{o.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
              </select>
              <select className="input" value={filters.review_priority} onChange={e => setFilters(f => ({ ...f, review_priority: e.target.value }))}>
                <option value="">Priority</option>
                {['low', 'normal', 'high', 'critical'].map(o => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
              </select>
              <select className="input" value={filters.assigned_reviewer_id} onChange={e => setFilters(f => ({ ...f, assigned_reviewer_id: e.target.value }))}>
                <option value="">Assigned Reviewer</option>
              </select>
              <select className="input" value={filters.sla_breached} onChange={e => setFilters(f => ({ ...f, sla_breached: e.target.value }))}>
                <option value="">SLA Breach</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
              <select className="input" value={filters.overdue} onChange={e => setFilters(f => ({ ...f, overdue: e.target.value }))}>
                <option value="">Overdue</option>
                <option value="true">Yes</option>
              </select>
              <input className="input" style={{ width: 120 }} type="number" placeholder="Min days in stage" value={filters.days_in_stage_min} onChange={e => setFilters(f => ({ ...f, days_in_stage_min: e.target.value }))} />
              <input className="input" style={{ width: 120 }} type="number" placeholder="Max days in stage" value={filters.days_in_stage_max} onChange={e => setFilters(f => ({ ...f, days_in_stage_max: e.target.value }))} />
            </div>
          )}

          <div className="card table-wrap">
            {loading && !data ? <Spinner /> : data.error ? <div className="alert danger">{data.error}</div> : data.rows.length === 0
              ? <EmptyState>No records match. {canCreate ? 'Create the first one!' : ''}</EmptyState> : (
              <table className="data">
                <thead><tr>{cfg.list.map(c => <th key={c.name}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {data.rows.map(row => (
                    <tr key={row.id} className="row-link" onClick={() => nav(`/${moduleKey}/${row.id}`)}>
                      {cfg.list.map(c => <td key={c.name}><Cell col={c} row={row} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {creating && (
        <Modal title={`New ${cfg.title.replace(/s$/, '')}`} onClose={() => setCreating(false)}>
          <RecordForm moduleKey={apiKeyName} cfg={cfg} onCancel={() => setCreating(false)}
            onSaved={() => { setCreating(false); api.get(`/${apiKeyName}?q=${q}&status=${status}`).then(setData); }} />
        </Modal>
      )}
    </div>
  );
}
