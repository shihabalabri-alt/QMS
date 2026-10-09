import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Icon, Spinner, StatCard, Badge } from '../lib/ui';

const SEV_COLORS = { critical: '#dc2626', warning: '#d97706', info: '#2563eb' };

export default function IntelligenceDashboard() {
  const [intel, setIntel] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const nav = useNavigate();

  useEffect(() => {
    api.get('/intelligence/patterns').then(setIntel).catch(() => setIntel({ patterns: [], total: 0, openEvents: 0, totalEvents: 0 }));
  }, []);

  if (!intel) return <Spinner />;

  return (
    <div className="page-wrap" style={{ maxWidth: 1100 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title"><Icon name="ai" /> Quality Event Intelligence</h1>
          <div className="page-sub">Automated pattern detection across all quality events — labeled as <b>Detected Pattern / Requires Review</b>.</div>
        </div>
      </div>

      <div className="stat-grid mb-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <StatCard label="Patterns detected" value={intel.patterns.length} accent={intel.patterns.length > 0 ? 'warning' : 'success'} icon="ai" />
        <StatCard label="Critical patterns" value={intel.patterns.filter(p => p.severity === 'critical').length} accent="danger" icon="risk" />
        <StatCard label="Open quality events" value={intel.openEvents} accent="info" icon="nc" />
        <StatCard label="Total events tracked" value={intel.totalEvents} accent="primary" icon="chart" />
      </div>

      {intel.patterns.length === 0 ? (
        <div className="card card-pad"><div className="empty-state">No recurring patterns detected. 🎉</div></div>
      ) : intel.patterns.map((p, i) => {
        const color = SEV_COLORS[p.severity] || '#64748b';
        const isExp = expanded === i;
        return (
          <div key={p.key} className="card card-pad mb-3" style={{ borderLeft: `4px solid ${color}` }}>
            <div className="flex justify-between items-center wrap">
              <div>
                <div className="flex items-center gap-2 wrap">
                  <span className="badge" style={{ background: color, color: '#fff', fontWeight: 700, fontSize: 10, textTransform: 'uppercase' }}>{p.severity}</span>
                  <b style={{ fontSize: 14 }}>{p.title}</b>
                </div>
                <p className="muted small mt-2">{p.detail}</p>
                <div className="flex gap-2 wrap items-center mt-2">
                  <span className="badge b-indigo" style={{ fontSize: 9.5 }}>{p.type.replace(/_/g, ' ')}</span>
                  <span className="badge b-amber" style={{ fontSize: 9.5 }}>Detected Pattern — Requires Review</span>
                </div>
              </div>
              <button className="btn sm" onClick={() => setExpanded(isExp ? null : i)}>
                {isExp ? 'Hide' : 'Details'}
              </button>
            </div>
            {isExp && (
              <div className="mt-3" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <div className="muted small mb-2" style={{ fontWeight: 700 }}>Related records:</div>
                {(p.records || []).map((r, j) => (
                  <div key={j} className="attention-row" style={{ padding: '4px 0' }}>
                    <span className="code-chip">{r.code}</span>
                    <span className="small" style={{ flex: 1 }}>{r.title}</span>
                    <Badge value={r.severity} />
                    <Badge value={r.status} />
                    {r.link && <button className="btn sm ghost" onClick={() => nav(r.link)}><Icon name="link" size={13} /></button>}
                  </div>
                ))}
                <div className="alert warning mt-3" style={{ fontSize: 12 }}>
                  <b>Suggestion:</b> {p.suggestion}
                  <div className="muted small mt-2">⚠️ Detected pattern, not confirmed root cause. Authorized Quality user must investigate.</div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
