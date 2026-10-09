import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Icon, Spinner, Badge, StatCard, fmtDate, daysBadge } from '../lib/ui';

const TYPE_COLORS = {
  Supplier: '#2e8f1f', NC: '#dc2626', CAPA: '#b91c1c', Incident: '#ea580c', Action: '#1565d0',
  Risk: '#7c3aed', Document: '#0369a1', Policy: '#6d28d9', Equipment: '#0891b2', Audit: '#b45309',
  KPI: '#0f766e', Person: '#475569', Employee: '#475569', Training: '#9333ea', Competency: '#c026d3',
  'Design review': '#be185d', Requirement: '#db2777', Finding: '#991b1b', Qualification: '#0e7490',
  'Mgmt review': '#1d4ed8', Evaluation: '#65a30d', Assessment: '#a21caf', Compliance: '#4d7c0f'
};
const colorFor = t => TYPE_COLORS[t] || '#64748b';

export default function ConnectionsMap() {
  const nav = useNavigate();
  const [net, setNet] = useState(null);
  const [err, setErr] = useState('');
  const [hover, setHover] = useState(null);
  const [filterType, setFilterType] = useState('all');

  useEffect(() => { api.get('/ai/network').then(setNet).catch(e => setErr(e.message)); }, []);

  const layout = useMemo(() => {
    if (!net) return null;
    let nodes = net.nodes;
    if (filterType !== 'all') {
      const keep = new Set([filterType]);
      const byId = new Map(net.nodes.map(n => [n.id, n]));
      for (const e of net.edges) {
        const a = byId.get(e.from), b = byId.get(e.to);
        if (a && a.type === filterType && b) keep.add(b.id);
        if (b && b.type === filterType && a) keep.add(a.id);
      }
      nodes = net.nodes.filter(n => keep.has(n.id));
    }
    const ids = new Set(nodes.map(n => n.id));
    const edges = net.edges.filter(e => ids.has(e.from) && ids.has(e.to));
    const byType = new Map();
    for (const n of nodes) { if (!byType.has(n.type)) byType.set(n.type, []); byType.get(n.type).push(n); }
    const types = [...byType.keys()];
    const W = 1100, H = 780, CX = W / 2, CY = H / 2, R = 330;
    const pos = new Map();
    types.forEach((t, ti) => {
      const ang = (ti / types.length) * Math.PI * 2 - Math.PI / 2;
      const hx = CX + Math.cos(ang) * R, hy = CY + Math.sin(ang) * R;
      const list = byType.get(t);
      const nr = 30 + Math.min(95, list.length * 9);
      list.forEach((n, ni) => {
        const na = (ni / list.length) * Math.PI * 2;
        pos.set(n.id, { x: hx + Math.cos(na) * (list.length === 1 ? 0 : nr), y: hy + Math.sin(na) * (list.length === 1 ? 0 : nr) * 0.82, node: n });
      });
      pos.set('hub:' + t, { x: hx, y: hy, hub: true, label: t, count: list.length });
    });
    return { W, H, pos, edges, types, nodeCount: nodes.length, edgeCount: edges.length };
  }, [net, filterType]);

  if (err) return <div className="page-wrap"><div className="alert critical">{err}</div></div>;
  if (!net || !layout) return <Spinner />;

  return (
    <div className="page-wrap" style={{ maxWidth: 1240 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title"><Icon name="link" /> Connections Map</h1>
          <div className="page-sub">Every verified relationship across all QMS processes — click any dot to open the exact record.</div>
        </div>
        <div className="flex gap-2 items-center">
          <select className="input" value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="all">All processes ({net.nodes.length} nodes)</option>
            {[...new Set(net.nodes.map(n => n.type))].sort().map(t => (
              <option key={t} value={t}>{t} ({net.nodes.filter(n => n.type === t).length})</option>
            ))}
          </select>
        </div>
      </div>

      <div className="stat-grid mb-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <StatCard label="Connected records" value={layout.nodeCount} accent="primary" icon="link" />
        <StatCard label="Live relationships" value={layout.edgeCount} accent="success" icon="check" />
        <StatCard label="Process types" value={layout.types.length} accent="info" icon="dashboard" />
      </div>

      <div className="card" style={{ padding: 10, overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${layout.W} ${layout.H}`} style={{ width: '100%', minHeight: 500 }}>
          {layout.edges.map((e, i) => {
            const a = layout.pos.get(e.from), b = layout.pos.get(e.to);
            if (!a || !b) return null;
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#b9c6dd" strokeWidth="0.7" opacity="0.55" />;
          })}
          {[...layout.pos.entries()].map(([id, p]) => p.hub ? (
            <g key={id}>
              <circle cx={p.x} cy={p.y} r={26} fill="#0d1b3d" opacity="0.92" />
              <text x={p.x} y={p.y + 3} textAnchor="middle" fill="#fff" fontSize="9.5" fontWeight="700">{p.count}</text>
              <text x={p.x} y={p.y + 40} textAnchor="middle" fill="#334155" fontSize="10.5" fontWeight="700">{p.label}</text>
            </g>
          ) : (
            <g key={id} style={{ cursor: 'pointer' }} onClick={() => p.node.link && nav(p.node.link)}
               onMouseEnter={() => setHover({ ...p.node, x: p.x, y: p.y })} onMouseLeave={() => setHover(null)}>
              <circle cx={p.x} cy={p.y} r="6.5" fill={colorFor(p.node.type)} stroke="#fff" strokeWidth="1.2" />
            </g>
          ))}
          {hover && (
            <g>
              <rect x={Math.min(hover.x + 10, layout.W - 240)} y={hover.y - 26} width={230} height={38} rx={7} fill="#0d1b3d" opacity="0.95" />
              <text x={Math.min(hover.x + 18, layout.W - 232)} y={hover.y - 10} fill="#fff" fontSize="10.5" fontWeight="700">{hover.code || hover.type}</text>
              <text x={Math.min(hover.x + 18, layout.W - 232)} y={hover.y + 4} fill="#c9d6f2" fontSize="9.5">{String(hover.label).slice(0, 42)}</text>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
