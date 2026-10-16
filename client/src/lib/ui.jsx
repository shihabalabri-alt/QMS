import React, { useEffect, useState } from 'react';

export function Icon({ name, size = 18 }) {
  const paths = {
    dashboard: 'M3 3h8v10H3zM13 3h8v6h-8zM13 11h8v10h-8zM3 15h8v6H3z',
    policy: 'M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4zm-2 12l2 2 4-4',
    goal: 'M12 21a9 9 0 100-18 9 9 0 000 18zm0-5a4 4 0 100-8 4 4 0 000 8zm0-4h.01M12 2v4m0 12v4',
    risk: 'M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
    supplier: 'M3 9l1-5h16l1 5M3 9v11h18V9M3 9h18M9 20v-6h6v6',
    people: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zm14 10v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
    competency: 'M22 10L12 5 2 10l10 5 10-5zM6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5',
    training: 'M22 10L12 5 2 10l10 5 10-5zM6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5M22 10v6',
    record: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M16 13H8m8 4H8',
    document: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6m-4 5H8m8 4H8m2 4H8',
    design: 'M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5zM2 2l7.586 7.586M11 11a2 2 0 100-.01',
    equipment: 'M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z',
    nc: 'M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z',
    audit: 'M9 12l2 2 4-4M12 3l7 4v5c0 4.5-3 8-7 9-4-1-7-4.5-7-9V7l7-4z',
    compliance: 'M9 12l2 2 4-4M12 3l7 4v5c0 4.5-3 8-7 9-4-1-7-4.5-7-9V7l7-4z',
    review: 'M8 2v4m8-4v4M3 10h18M5 6h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2zm4 12l2-2m-2 0l2 2m4-2h4',
    action: 'M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11',
    calendar: 'M8 2v4m8-4v4M3 10h18M5 6h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z',
    chart: 'M18 20V10M12 20V4M6 20v-6',
    report: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M16 13H8m8 4H8',
    ai: 'M12 2a4 4 0 014 4c1.7 0 3 1.6 3 3.5 1.2.5 2 1.7 2 3s-.8 2.5-2 3c0 1.9-1.3 3.5-3 3.5a4 4 0 01-8 0c-1.7 0-3-1.6-3-3.5-1.2-.5-2-1.7-2-3s.8-2.5 2-3C5 7.6 6.3 6 8 6a4 4 0 014-4zm-3 10h.01M15 12h.01M9.5 15.5c.7.7 1.6 1 2.5 1s1.8-.3 2.5-1',
    settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zm7.43-3a7.43 7.43 0 00-.1-1.2l2.1-1.65-2-3.46-2.49 1a7.3 7.3 0 00-2.08-1.2L14.5 2h-4l-.36 2.49c-.75.3-1.45.7-2.08 1.2l-2.49-1-2 3.46 2.1 1.65a7.93 7.93 0 000 2.4L3.57 13.85l2 3.46 2.49-1c.63.5 1.33.9 2.08 1.2l.36 2.49h4l.36-2.49a7.3 7.3 0 002.08-1.2l2.49 1 2-3.46-2.1-1.65c.06-.4.1-.8.1-1.2z',
    search: 'M11 19a8 8 0 100-16 8 8 0 000 16zm10 2l-4.35-4.35',
    bell: 'M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0',
    logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4m7 14l5-5-5-5m5 5H9',
    lock: 'M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2zM7 11V7a5 5 0 0110 0v4',
    menu: 'M3 6h18M3 12h18M3 18h18',
    x: 'M18 6L6 18M6 6l12 12',
    plus: 'M12 5v14M5 12h14',
    download: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3',
    link: 'M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71',
    check: 'M20 6L9 17l-5-5',
    alert: 'M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
    send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
    mic: 'M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8',
    volume: 'M11 5L6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 010 7M19 5a9 9 0 010 14',
    moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 1v3m0 16v3M4.2 4.2l2.1 2.1m11.4 11.4l2.1 2.1M1 12h3m16 0h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1'
  };
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name] || paths.dashboard} />
    </svg>
  );
}

const STATUS_COLORS = {
  approved: 'b-green', active: 'b-green', compliant: 'b-green', operational: 'b-green', pass: 'b-green', verified: 'b-green', closed: 'b-green', issued: 'b-green', completed: 'b-green', achieved: 'b-green', attended: 'b-green', conformant: 'b-green', monitored: 'b-green', higher_is_better: 'b-green',
  draft: 'b-gray', not_assessed: 'b-gray', planned: 'b-blue', invited: 'b-gray', none: 'b-gray', pending: 'b-amber', obsolete: 'b-gray', archived: 'b-gray', destroyed: 'b-gray', retired: 'b-gray', cancelled: 'b-red', rejected: 'b-red', no_show: 'b-red', disqualified: 'b-red', out_of_service: 'b-red', non_compliant: 'b-red', fail: 'b-red', failed: 'b-red', major_nc: 'b-red',
  in_review: 'b-indigo', investigation: 'b-indigo', action_plan: 'b-indigo', treating: 'b-indigo', scheduled: 'b-blue', open: 'b-amber', partially: 'b-amber', conditional: 'b-amber', minor_nc: 'b-amber', verification: 'b-indigo', under_qualification: 'b-indigo', on_leave: 'b-amber', deferred: 'b-gray',
  in_progress: 'b-blue', observation: 'b-blue', low: 'b-gray', medium: 'b-blue', high: 'b-amber', critical: 'b-red', minor: 'b-blue', major: 'b-red', low_risk: 'b-green'
};
export function Badge({ value }) {
  if (value === null || value === undefined || value === '') return <span className="muted">—</span>;
  const cls = STATUS_COLORS[String(value)] || 'b-gray';
  const label = String(value).replace(/_/g, ' ');
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function RiskPill({ score, rating }) {
  if (score === undefined || score === null) return <span className="muted">—</span>;
  return <span className={`badge ${rating ? `risk-${rating}` : 'b-gray'}`}>{score}{rating ? ` · ${rating}` : ''}</span>;
}

export function Spinner() { return <div className="spinner" />; }

export function EmptyState({ children = 'No records found' }) {
  return <div className="empty-state">{children}</div>;
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={wide ? { maxWidth: 960 } : null}>
        <div className="modal-head"><div className="modal-title">{title}</div><button className="icon-btn" onClick={onClose}><Icon name="x" /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function StatCard({ label, value, accent = 'primary', icon = 'chart', to }) {
  const inner = (
    <>
      <div className={`stat-accent ${accent}`}><Icon name={icon} size={17} /></div>
      <div className="stat-value">{value ?? '—'}</div>
      <div className="stat-label">{label}</div>
    </>
  );
  return to ? <a href={to} className="stat-card" style={{ display: 'block', color: 'inherit' }}>{inner}</a> : <div className="stat-card">{inner}</div>;
}

export function Toast({ msg, kind = 'ok' }) {
  if (!msg) return null;
  return <div className={`toast ${kind === 'error' ? 'error' : ''}`}>{msg}</div>;
}

let toastFn = null;
export function showToast(msg, kind) { if (toastFn) toastFn(msg, kind); }
export function ToastHost() {
  const [state, setState] = useState(null);
  useEffect(() => {
    toastFn = (msg, kind = 'ok') => { setState({ msg, kind }); setTimeout(() => setState(null), 3200); };
    return () => { toastFn = null; };
  }, []);
  return <Toast msg={state?.msg} kind={state?.kind} />;
}

export function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return d; }
}
export function fmtDateTime(d) {
  if (!d) return '—';
  try { return new Date(d.includes('T') ? d : d.replace(' ', 'T')).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return d; }
}
export function daysBadge(days) {
  if (days === undefined || days === null) return null;
  let cls = 'b-gray', txt = `${days}d`;
  if (days < 0) { cls = 'b-red'; txt = `${Math.abs(days)}d overdue`; }
  else if (days <= 7) { cls = 'b-amber'; txt = `in ${days}d`; }
  else txt = `in ${days}d`;
  return <span className={`badge ${cls}`}>{txt}</span>;
}
