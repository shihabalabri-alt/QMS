import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Icon, StatCard, Badge, Spinner, fmtDate, daysBadge } from '../lib/ui';
import { LineChart, BarChart, DonutChart, RiskMatrix } from '../lib/charts';
import { useAuth } from '../App';

export default function Dashboard() {
  const { user } = useAuth();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/dashboard').then(setD).catch(e => setErr(e.message));
  }, []);

  if (err) return <div className="page-wrap"><div className="alert critical">{err}</div></div>;
  if (!d) return <Spinner />;
  const c = d.counts;

  const kpiSegments = [
    { label: 'on target', value: d.kpis.filter(k => k.onTarget).length || 0, color: '#16a34a' },
    { label: 'off target', value: d.kpis.filter(k => !k.onTarget).length || 0, color: '#dc2626' }
  ];

  return (
    <div className="page-wrap">
      <div className="page-head">
        <div>
          <h1 className="page-title">Good to see you, {user.name.split(' ')[0]}</h1>
          <div className="page-sub">Live quality intelligence across the organization — {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        </div>
        <Link className="btn primary" to="/ai"><Icon name="ai" size={16} /> Ask the AI Brain</Link>
      </div>

      <div className="stat-grid mb-4">
        <StatCard label="High residual risks" value={c.risksHigh} accent={c.risksHigh ? 'danger' : 'success'} icon="risk" to="/risks" />
        <StatCard label="Overdue actions" value={c.overdueActions} accent={c.overdueActions ? 'danger' : 'success'} icon="action" to="/actions?overdue=1" />
        <StatCard label={`My actions${c.myOverdueActions ? ` (${c.myOverdueActions} overdue)` : ''}`} value={c.myActions} accent={c.myOverdueActions ? 'warning' : 'primary'} icon="check" to="/actions?owner=me" />
        <StatCard label="Open NCs / incidents" value={`${c.openNCs + c.openCAPA} / ${c.openIncidents}`} accent="warning" icon="nc" to="/nonconformances" />
        <StatCard label="Supplier issues" value={c.supplierIssues + c.conditionalSuppliers} accent={c.supplierIssues ? 'warning' : 'success'} icon="supplier" to="/suppliers" />
        <StatCard label="Expiring qualifications" value={c.expiringQuals} accent={c.expiredQuals ? 'danger' : c.expiringQuals ? 'warning' : 'success'} icon="competency" to="/competencies" />
        <StatCard label="Documents need review" value={c.docsForReview} accent={c.docsOverdue ? 'danger' : 'warning'} icon="document" to="/documents" />
        <StatCard label="Calibrations due" value={c.calibDue} accent={c.calibOverdue ? 'danger' : c.calibDue ? 'warning' : 'success'} icon="equipment" to="/equipment" />
      </div>

      <div className="grid-main-side mb-4">
        <div className="card card-pad">
          <div className="flex justify-between items-center mb-3">
            <h3 className="card-title" style={{ margin: 0 }}>What needs my attention?</h3>
            <span className="muted small">AI-ranked by composite risk score</span>
          </div>
          {d.attention.length === 0 && <div className="alert success"><Icon name="check" /> Nothing urgent — the QMS is in good shape.</div>}
          {d.attention.map((a, i) => (
            <Link key={i} to={a.link || '/dashboard'} style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
              <div className="attention-row">
                <span className="score-pill">{a.pts}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{a.code}</b> — <span>{a.title}</span>
                  <div className="muted small">{a.type} · {a.why}</div>
                </div>
                <Icon name="link" size={14} />
              </div>
            </Link>
          ))}
        </div>

        <div className="card card-pad">
          <h3 className="card-title">AI Insights</h3>
          {d.insights.map((ins, i) => (
            <div key={i} className={`alert ${ins.severity}`} style={{ marginBottom: 10 }}>
              <Icon name={ins.severity === 'critical' ? 'alert' : ins.severity === 'warning' ? 'risk' : 'ai'} size={17} />
              <div><b>{ins.title}</b><div className="small">{ins.body}</div></div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid-3 mb-4">
        <div className="card card-pad">
          <h3 className="card-title">KPI performance</h3>
          <DonutChart segments={kpiSegments.filter(s => s.value > 0)} centerSub="active KPIs" centerLabel={d.kpis.length} size={120} thickness={15} />
          <div className="mt-3">
            {d.kpis.slice(0, 4).map(k => (
              <Link key={k.id} to={`/goals/${k.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                <div className="attention-row">
                  <div style={{ flex: 1 }}>
                    <span className="code-chip">{k.code}</span> <span className="small">{k.title}</span>
                    <div className="muted small">{k.last ?? '—'}{k.unit} vs target {k.target}{k.unit} · trend {k.trend}</div>
                  </div>
                  <Badge value={k.onTarget ? 'on target' : 'off target'} />
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="card card-pad">
          <h3 className="card-title">Risk matrix (residual)</h3>
          <RiskMatrix cells={d.riskMatrix} />
          <div className="muted small mt-3">Likelihood × Severity · open risks only</div>
        </div>

        <div className="card card-pad">
          <h3 className="card-title">NC & incident trend</h3>
          <LineChart data={d.ncByMonth.map(x => x.count)} height={130} />
          <div className="flex justify-between muted small" style={{ marginTop: 4 }}>
            <span>{d.ncByMonth[0]?.month}</span><span>{d.ncByMonth[d.ncByMonth.length - 1]?.month}</span>
          </div>
          <div className="stat-grid mt-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div><div className="stat-value" style={{ fontSize: 20 }}>{c.ncOverdue30}</div><div className="stat-label">open &gt; 30 days</div></div>
            <div><div className="stat-value" style={{ fontSize: 20 }}>{c.openAuditFindings}</div><div className="stat-label">open audit findings</div></div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card card-pad">
          <h3 className="card-title">Upcoming deadlines (next 14 days)</h3>
          {d.upcoming.length === 0 && <div className="empty-state">Nothing due — enjoy the calm.</div>}
          {d.upcoming.slice(0, 10).map((u, i) => (
            <Link key={i} to={u.link} style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
              <div className="attention-row">
                <span className={`badge ${u.days < 0 ? 'b-red' : u.days <= 2 ? 'b-amber' : 'b-blue'}`}>{fmtDate(u.date)}</span>
                <div style={{ flex: 1 }}><b className="small">{u.type}</b> · {u.label.length > 60 ? u.label.slice(0, 60) + '…' : u.label}</div>
                {daysBadge(u.days)}
              </div>
            </Link>
          ))}
        </div>

        <div className="card card-pad">
          <h3 className="card-title">Recent activity</h3>
          <div className="timeline">
            {d.recentActivity.map((a, i) => (
              <div key={i} className="tl-item">
                <span className="tl-dot" style={{ background: a.action.includes('delete') ? 'var(--danger)' : a.action.startsWith('status') ? 'var(--info)' : 'var(--primary)' }} />
                <div>
                  <b>{a.user_name || 'System'}</b> <span className="muted">{a.action.replace(/_/g, ' ')}</span> {a.entity_label}
                  <div className="tl-muted">{fmtDate(a.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
