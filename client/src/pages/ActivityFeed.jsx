import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Icon, Spinner, Badge, fmtDateTime } from '../lib/ui';

const FILTERS = [
  ['all', 'All'], ['actions', 'Actions'], ['risks', 'Risks'], ['documents', 'Documents'],
  ['nonconformances', 'NC & Incidents'], ['audits', 'Audits'], ['suppliers', 'Suppliers'],
  ['equipment', 'Equipment'], ['users', 'Users'], ['goals', 'Goals'], ['compliance_requirements', 'Compliance'],
  ['competencies', 'Competency'], ['trainings', 'Training'], ['reviews', 'Reviews'], ['design_reviews', 'Design']
];

const ACTION_COLORS = {
  create: 'b-green', update: 'b-blue', status_change: 'b-indigo', delete: 'b-red',
  complete: 'b-green', verify: 'b-green', reopen: 'b-amber', comment: 'b-gray',
  file_upload: 'b-blue', file_download: 'b-gray', link_created: 'b-indigo',
  login: 'b-gray', export: 'b-gray', ai_recommendation_approved: 'b-green'
};
const colorFor = a => ACTION_COLORS[a] || 'b-gray';

export default function ActivityFeed() {
  const nav = useNavigate();
  const [filter, setFilter] = useState('all');
  const [userF, setUserF] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState(null);
  const [actors, setActors] = useState([]);
  const [limit, setLimit] = useState(60);

  useEffect(() => {
    const qs = new URLSearchParams({ filter, limit: String(limit) });
    if (userF) qs.set('user', userF);
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    api.get(`/activity?${qs}`).then(setData).catch(() => {});
  }, [filter, userF, from, to, limit]);

  useEffect(() => { api.get('/activity?limit=300').then(d => {
    const names = [...new Set(d.rows.map(r => r.actor).filter(Boolean))];
    setActors(names);
  }).catch(() => {}); }, []);

  return (
    <div className="page-wrap" style={{ maxWidth: 1000 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title"><Icon name="chart" /> Global Activity Feed</h1>
          <div className="page-sub">Every recorded change across all QMS modules — who did what, when, and what changed.</div>
        </div>
      </div>

      <div className="chips mb-3">
        {FILTERS.map(([k, label]) => (
          <span key={k} className="chip" style={filter === k ? { background: 'var(--primary)', color: '#fff', borderColor: 'var(--primary)' } : null}
            onClick={() => setFilter(k)}>{label}</span>
        ))}
      </div>

      <div className="filter-bar">
        <select className="input" style={{ width: 170 }} value={userF} onChange={e => setUserF(e.target.value)}>
          <option value="">All users</option>
          {actors.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} title="From date" />
        <input className="input" type="date" value={to} onChange={e => setTo(e.target.value)} title="To date" />
        {(userF || from || to) && <button className="btn sm ghost" onClick={() => { setUserF(''); setFrom(''); setTo(''); }}>Clear</button>}
      </div>

      {!data ? <Spinner /> : data.rows.length === 0 ? (
        <div className="card card-pad"><div className="empty-state">No activity matches these filters.</div></div>
      ) : (
        <div className="card card-pad">
          <div className="timeline">
            {data.rows.map(a => (
              <div key={a.id} className="tl-item" style={{ alignItems: 'flex-start' }}>
                <span className={`badge ${colorFor(a.action)}`} style={{ minWidth: 86, justifyContent: 'center' }}>{a.action.replace(/_/g, ' ')}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div>
                    <b>{a.actor}</b>{' '}
                    <span className="muted">{a.action.replace(/_/g, ' ')}</span>{' '}
                    {a.link
                      ? <Link to={a.link} style={{ fontWeight: 700 }}>{a.entityLabel || `${a.entityType} #${a.entityId}`}</Link>
                      : <span style={{ fontWeight: 700 }}>{a.entityLabel || a.entityType}</span>}
                    {a.ip && a.ip !== 'local' ? <span className="muted small"> · from {a.ip}</span> : null}
                  </div>
                  {a.changes && a.changes.length > 0 && (
                    <div className="flex gap-2 wrap" style={{ marginTop: 4 }}>
                      {a.changes.map((c, i) => (
                        <span key={i} className="mono small" style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px' }}>
                          <span className="muted">{c.field}:</span> <span style={{ color: '#b91c1c', textDecoration: 'line-through' }}>{String(c.from).slice(0, 30) || '—'}</span> → <span style={{ color: '#15803d', fontWeight: 700 }}>{String(c.to).slice(0, 30) || '—'}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {!a.changes && a.details && a.details.length > 2 && a.details !== '{}' && (
                    <div className="mono muted small" style={{ marginTop: 3, wordBreak: 'break-all' }}>{a.details.slice(0, 140)}</div>
                  )}
                  <div className="tl-muted">{fmtDateTime(a.created_at)}</div>
                </div>
                {a.link && <Icon name="link" size={13} />}
              </div>
            ))}
          </div>
          {data.rows.length < data.total && (
            <div style={{ textAlign: 'center', paddingTop: 10 }}>
              <button className="btn sm" onClick={() => setLimit(l => l + 60)}>Load older activity</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
