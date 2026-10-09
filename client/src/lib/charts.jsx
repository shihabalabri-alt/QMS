import React from 'react';

// Lightweight dependency-free SVG charts
export function LineChart({ data, height = 120, color = '#4f46e5' }) {
  if (!data || data.length < 2) return <div className="muted small">Not enough data</div>;
  const w = 100, h = 100, pad = 8;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => [pad + (i / (data.length - 1)) * (w - pad * 2), h - pad - ((v - min) / range) * (h - pad * 2)]);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${path} L${pts[pts.length - 1][0].toFixed(1)},${h - pad} L${pts[0][0].toFixed(1)},${h - pad} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height }} preserveAspectRatio="none">
      <path d={area} fill={color} opacity="0.08" />
      <path d={path} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="1.6" fill={color} />)}
    </svg>
  );
}

export function BarChart({ items, height = 150 }) {
  // items: [{label, value, color}]
  if (!items?.length) return <div className="muted small">No data</div>;
  const max = Math.max(...items.map(i => i.value)) || 1;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height, padding: '6px 2px' }}>
      {items.map((it, i) => (
        <div key={i} style={{ flex: 1, textAlign: 'center' }} title={`${it.label}: ${it.value}`}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 3 }}>{it.value}</div>
          <div style={{ background: it.color || '#6366f1', height: Math.max(4, (it.value / max) * (height - 44)), borderRadius: 5, transition: 'height .3s' }} />
          <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</div>
        </div>
      ))}
    </div>
  );
}

export function DonutChart({ segments, size = 140, thickness = 18, centerLabel, centerSub }) {
  // segments: [{label, value, color}]
  const total = segments.reduce((a, s) => a + s.value, 0);
  if (!total) return <div className="muted small">No data</div>;
  const r = (size - thickness) / 2;
  const c = size / 2;
  let acc = 0;
  const circ = 2 * Math.PI * r;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <svg width={size} height={size}>
        {segments.map((s, i) => {
          const frac = s.value / total;
          const dash = frac * circ;
          const el = <circle key={i} cx={c} cy={c} r={r} fill="none" stroke={s.color} strokeWidth={thickness} strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-acc * circ} transform={`rotate(-90 ${c} ${c})`} />;
          acc += frac;
          return el;
        })}
        <text x={c} y={c - 2} textAnchor="middle" fontWeight="800" fontSize="20" fill="#17203a">{centerLabel ?? total}</text>
        <text x={c} y={c + 15} textAnchor="middle" fontSize="10.5" fill="#64748b">{centerSub ?? ''}</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {segments.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, display: 'inline-block' }} />
            <span style={{ textTransform: 'capitalize' }}>{s.label}</span>
            <b>{s.value}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RiskMatrix({ cells }) {
  // cells: [{l, s, c}] likelihood 1..5, severity 1..5
  const grid = {};
  for (const cell of cells || []) grid[`${cell.l},${cell.s}`] = cell.c;
  const colorFor = score => score >= 15 ? '#dc2626' : score >= 8 ? '#d97706' : '#16a34a';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto repeat(5, 1fr)', gap: 3, maxWidth: 380 }}>
      {[5, 4, 3, 2, 1].map(s => (
        <React.Fragment key={s}>
          <div style={{ fontSize: 10.5, color: 'var(--muted)', display: 'grid', placeItems: 'center' }}>S{s}</div>
          {[1, 2, 3, 4, 5].map(l => {
            const n = grid[`${l},${s}`] || 0;
            const bg = n ? colorFor(l * s) : '#f1f5f9';
            return <div key={l} title={`L${l}×S${s}: ${n}`} style={{ background: n ? bg : '#f8fafc', opacity: n ? 0.25 + Math.min(0.75, n * 0.22) : 1, borderRadius: 7, height: 40, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 12.5, color: n ? '#fff' : '#cbd5e1' }}>{n || ''}</div>;
          })}
        </React.Fragment>
      ))}
      <div />
      {[1, 2, 3, 4, 5].map(l => <div key={l} style={{ fontSize: 10.5, color: 'var(--muted)', textAlign: 'center' }}>L{l}</div>)}
    </div>
  );
}
