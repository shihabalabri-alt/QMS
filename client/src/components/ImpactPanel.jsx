import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Icon, Spinner, Badge, StatCard } from '../lib/ui';

const LEVEL_COLORS = {
  critical: { bg: '#fee2e2', text: '#991b1b', border: '#fecaca', label: 'CRITICAL' },
  high: { bg: '#fef3c7', text: '#92400e', border: '#fde68a', label: 'HIGH' },
  medium: { bg: '#dbeafe', text: '#1e40af', border: '#bfdbfe', label: 'MEDIUM' },
  low: { bg: '#dcfce7', text: '#166534', border: '#bbf7d0', label: 'LOW' }
};

const MODULE_COLORS = {
  Actions: '#1565d0', 'Risk Register': '#7c3aed', Suppliers: '#2e8f1f', Equipment: '#0891b2',
  Documents: '#0369a1', Policies: '#6d28d9', 'Goals & KPIs': '#0f766e', 'NC & Incidents': '#dc2626',
  Audits: '#b45309', Compliance: '#4d7c0f', Competencies: '#c026d3', Training: '#9333ea',
  'Design Reviews': '#be185d', 'Management Review': '#1d4ed8', People: '#475569', Records: '#475569'
};

export function ImpactPanel({ moduleKey, recordId, recordCode }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    api.get(`/impact/${moduleKey}/${recordId}`).then(setData).catch(e => setErr(e.message));
  }, [moduleKey, recordId]);

  if (err) return <div className="muted small">Impact analysis unavailable.</div>;
  if (!data) return <Spinner />;

  const lc = LEVEL_COLORS[data.overallImpact] || LEVEL_COLORS.low;
  const modules = Object.entries(data.byModule);

  return (
    <div>
      {/* Impact level banner */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10,
        background: lc.bg, border: `1px solid ${lc.border}`, marginBottom: 12
      }}>
        <span className={`badge ${data.overallImpact === 'critical' ? 'b-red' : data.overallImpact === 'high' ? 'b-amber' : data.overallImpact === 'medium' ? 'b-blue' : 'b-green'}`}>
          {lc.label} IMPACT
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: lc.text }}>
          {data.totalAffected} record(s) affected
          {data.criticalCount > 0 && ` · ${data.criticalCount} critical`}
          {data.highCount > 0 && ` · ${data.highCount} high`}
        </span>
      </div>

      {/* Summary */}
      <p className="small" style={{ color: lc.text, marginBottom: 10 }}>{data.recommendation}</p>

      {/* Visual impact map — source in center, affected around it */}
      <div style={{ marginBottom: 12 }}>
        <svg viewBox="0 0 500 200" style={{ width: '100%' }}>
          <circle cx="250" cy="100" r="32" fill="#0d1b3d" />
          <text x="250" y="96" textAnchor="middle" fill="#fff" fontSize="9" fontWeight="700">{recordCode}</text>
          <text x="250" y="108" textAnchor="middle" fill="#9db8e8" fontSize="7">SOURCE</text>
          {modules.slice(0, 8).map(([mod, items], mi) => {
            const ang = (mi / Math.min(8, modules.length)) * Math.PI * 2 - Math.PI / 2;
            const mx = 250 + Math.cos(ang) * 170, my = 100 + Math.sin(ang) * 70;
            const color = MODULE_COLORS[mod] || '#64748b';
            return (
              <g key={mod}>
                <line x1="250" y1="100" x2={mx} y2={my} stroke={color} strokeWidth="1.5" opacity="0.4" />
                <circle cx={mx} cy={my} r="20" fill={color} opacity="0.15" />
                <circle cx={mx} cy={my} r="20" fill="none" stroke={color} strokeWidth="1.5" />
                <text x={mx} y={my - 2} textAnchor="middle" fill={color} fontSize="8" fontWeight="700">{items.length}</text>
                <text x={mx} y={my + 8} textAnchor="middle" fill={color} fontSize="6.5">{mod.length > 14 ? mod.slice(0, 14) : mod}</text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Expandable detail */}
      <button className="btn sm" style={{ width: '100%' }} onClick={() => setExpanded(!expanded)}>
        {expanded ? 'Hide details' : `Show all ${data.totalAffected} affected record(s)`}
        <Icon name={expanded ? 'x' : 'search'} size={13} style={{ marginLeft: 6 }} />
      </button>

      {expanded && modules.map(([mod, items]) => (
        <div key={mod} className="mb-3" style={{ marginTop: 10 }}>
          <div className="gs-section" style={{ padding: '4px 0' }}>
            <span style={{ color: MODULE_COLORS[mod] || '#64748b', fontWeight: 700 }}>{mod}</span>
            <span className="muted small"> ({items.length})</span>
          </div>
          {items.map((a, i) => {
            const lc2 = LEVEL_COLORS[a.level] || LEVEL_COLORS.medium;
            return (
              <div key={i} style={{ borderLeft: `3px solid ${lc2.bg === '#fee2e2' ? '#dc2626' : lc2.bg === '#fef3c7' ? '#d97706' : lc2.bg === '#dbeafe' ? '#2563eb' : '#16a34a'}`, paddingLeft: 10, marginBottom: 8 }}>
                <div className="flex items-center gap-2 wrap">
                  {a.code && <span className="code-chip">{a.code}</span>}
                  <span style={{ fontWeight: 600, fontSize: 12.5 }}>{a.title}</span>
                  <Badge value={a.status} />
                  <span className={`badge ${lc2.cls}`} style={{ fontSize: 10 }}>{a.level.toUpperCase()}</span>
                </div>
                <div className="muted small mt-2">
                  Why: {a.rel} · Owner: {a.owner || '—'}
                </div>
                {a.recommended && (
                  <div className="small" style={{ color: lc2.text, marginTop: 2 }}>
                    <Icon name="alert" size={11} /> {a.recommended}
                  </div>
                )}
                <Link to={a.link} className="small" style={{ color: 'var(--primary)', fontWeight: 600 }}>Open {a.code} →</Link>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Lightweight pre-approval impact banner for workflow transitions
export function PreApprovalCheck({ moduleKey, recordId }) {
  const [check, setCheck] = useState(null);
  useEffect(() => {
    api.get(`/impact/pre-approval/${moduleKey}/${recordId}`).then(setCheck).catch(() => {});
  }, [moduleKey, recordId]);

  if (!check || !check.totalAffected) return null;
  const isHigh = check.overallImpact === 'critical' || check.overallImpact === 'high';
  if (!isHigh) return null;

  return (
    <div className="alert warning mb-3" style={{ fontSize: 12.5 }}>
      <Icon name="alert" size={15} />
      <div>
        <b>Impact Analysis:</b> {check.message}
        {check.topAffected.length > 0 && (
          <div className="mt-2">
            Top affected: {check.topAffected.map(a => a.code).join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}
