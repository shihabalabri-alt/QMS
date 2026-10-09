import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Icon, Spinner, Badge, StatCard, fmtDateTime, showToast } from '../lib/ui';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'critical', label: 'Critical' },
  { key: 'high', label: 'High' },
  { key: 'actions', label: 'Actions' },
  { key: 'documents', label: 'Documents' },
  { key: 'risks', label: 'Risks' },
  { key: 'equipment', label: 'Equipment' },
  { key: 'suppliers', label: 'Suppliers' },
  { key: 'compliance', label: 'Compliance' },
  { key: 'competency', label: 'People & Training' },
  { key: 'quality', label: 'Quality / NC' },
  { key: 'reviews', label: 'Reviews' }
];

const PRIO = {
  critical: { label: 'CRITICAL', cls: 'b-red' },
  high: { label: 'HIGH', cls: 'b-amber' },
  medium: { label: 'MEDIUM', cls: 'b-blue' },
  low: { label: 'LOW', cls: 'b-gray' },
  info: { label: 'INFO', cls: 'b-blue' }
};

export default function NotificationsCenter() {
  const nav = useNavigate();
  const [filter, setFilter] = useState('all');
  const [data, setData] = useState(null);
  const [facets, setFacets] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [d, f] = await Promise.all([
      api.get(`/notifications?filter=${filter}&limit=200`),
      api.get('/notifications/facets')
    ]);
    setData(d); setFacets(f);
  };
  useEffect(() => { load().catch(e => showToast(e.message, 'error')); }, [filter]);

  async function markRead(id) {
    await api.post(`/notifications/${id}/read`);
    load().catch(() => {});
    window.dispatchEvent(new Event('qms-notif-changed'));
  }
  async function markAll() {
    await api.post('/notifications/read-all');
    showToast('All notifications marked as read');
    load().catch(() => {});
    window.dispatchEvent(new Event('qms-notif-changed'));
  }
  function open(n) {
    if (!n.read) {
      api.post(`/notifications/${n.id}/read`).then(() => {
        load().catch(() => {});
        window.dispatchEvent(new Event('qms-notif-changed'));
      }).catch(() => {});
    }
    if (n.link) nav(n.link);
  }

  const countFor = key => {
    if (!facets) return null;
    if (key === 'all') return facets.all;
    if (key === 'unread') return facets.unread;
    if (key === 'critical') return facets.critical;
    if (key === 'high') return facets.high;
    const c = (facets.byCategory || []).find(x => x.category === key);
    return c ? c.c : 0;
  };
  const unreadFor = key => {
    if (!facets) return 0;
    if (key === 'unread') return facets.unread;
    const c = (facets.byCategory || []).find(x => x.category === key);
    return c ? (c.unread || 0) : 0;
  };

  return (
    <div className="page-wrap" style={{ maxWidth: 1000 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title"><Icon name="bell" /> Notifications Center</h1>
          <div className="page-sub">Automatic monitoring of every QMS module — click a notification to open the exact record.</div>
        </div>
        <button className="btn" onClick={markAll}><Icon name="check" size={15} /> Mark all as read</button>
      </div>

      <div className="stat-grid mb-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <StatCard label="All notifications" value={facets ? facets.all : '—'} accent="primary" icon="bell" />
        <StatCard label="Unread" value={facets ? facets.unread : '—'} accent={facets && facets.unread > 0 ? 'warning' : 'success'} icon="alert" />
        <StatCard label="Critical" value={facets ? facets.critical : '—'} accent={facets && facets.critical > 0 ? 'danger' : 'success'} icon="risk" />
        <StatCard label="High priority" value={facets ? facets.high : '—'} accent="warning" icon="chart" />
      </div>

      <div className="chips mb-3">
        {FILTERS.map(f => (
          <span key={f.key} className="chip" style={filter === f.key ? { background: 'var(--primary)', color: '#fff', borderColor: 'var(--primary)' } : null}
            onClick={() => setFilter(f.key)}>
            {f.label}{countFor(f.key) !== null ? ` (${countFor(f.key)})` : ''}
            {unreadFor(f.key) > 0 && filter !== f.key ? <span style={{ color: '#dc2626', fontWeight: 800 }}> •</span> : null}
          </span>
        ))}
      </div>

      {!data ? <Spinner /> : data.rows.length === 0 ? (
        <div className="card card-pad"><div className="empty-state">No notifications in this view. 🎉</div></div>
      ) : (
        <div className="card">
          {data.rows.map(n => {
            const prio = PRIO[n.priority] || PRIO[n.severity] || PRIO.medium;
            return (
              <div key={n.id} className="notif-row" style={{ cursor: 'pointer', borderLeft: `4px solid ${n.priority === 'critical' ? '#dc2626' : n.priority === 'high' ? '#d97706' : n.read ? 'transparent' : 'var(--primary)'}`, background: n.read ? 'transparent' : '#f8faff' }}
                onClick={() => open(n)}>
                <span className={`badge ${prio.cls}`} style={{ minWidth: 64, justifyContent: 'center' }}>{prio.label}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="notif-title">
                    {n.title}
                    <span className="badge b-gray" style={{ marginLeft: 8, textTransform: 'capitalize' }}>{(n.category || 'general').replace(/_/g, ' ')}</span>
                    {!n.read && <span className="badge b-indigo" style={{ marginLeft: 6 }}>NEW</span>}
                  </div>
                  <div className="notif-body">{n.body}</div>
                  <div className="flex gap-2 items-center wrap" style={{ marginTop: 4 }}>
                    {n.recordCode && <span className="code-chip" title="Related record">{n.recordCode}</span>}
                    {n.recordStatus && <Badge value={n.recordStatus} />}
                    <span className="notif-time">{fmtDateTime(n.created_at)}</span>
                  </div>
                </div>
                <div style={{ display: 'grid', placeItems: 'center' }}>
                  {!n.read ? (
                    <button className="btn sm ghost" title="Mark as read" onClick={e => { e.stopPropagation(); markRead(n.id); }}>
                      <Icon name="check" size={14} />
                    </button>
                  ) : (
                    <span className="muted small">read</span>
                  )}
                  {n.link && <Icon name="link" size={13} style={{ marginTop: 4 }} />}
                </div>
              </div>
            );
          })}
          {data.rows.length < data.total && (
            <div style={{ padding: 12, textAlign: 'center' }} className="muted small">
              Showing {data.rows.length} of {data.total} — older history is kept.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
