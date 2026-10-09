import React, { useEffect, useState } from 'react';
import { api, downloadFile } from '../lib/api';
import { Icon, Spinner, Badge, EmptyState, showToast } from '../lib/ui';
import { BarChart, DonutChart } from '../lib/charts';

const COLORS = ['#4f46e5', '#16a34a', '#d97706', '#dc2626', '#0284c7', '#9333ea'];

export default function ReportsPage() {
  const [list, setList] = useState(null);
  const [current, setCurrent] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => { api.get('/reports').then(setList); }, []);
  useEffect(() => {
    if (current) api.get(`/reports/${current}`).then(setData);
  }, [current]);

  if (!list) return <Spinner />;
  const active = list.reports.find(r => r.key === current);

  return (
    <div className="page-wrap">
      <div className="page-head">
        <div>
          <h1 className="page-title"><Icon name="report" /> Reports & Analytics</h1>
          <div className="page-sub">Analytics across all QMS modules · CSV export for authorized roles</div>
        </div>
        {current && (
          <div className="flex gap-2">
            <button className="btn primary" onClick={async () => { try { await downloadFile(`/pdf/report/${current}`, `${current}-report.pdf`); showToast('PDF downloaded'); } catch (e) { showToast(e.message, 'error'); } }}><Icon name="download" size={15} /> PDF</button>
            {data?.canExport ? (
              <a className="btn" href={`/api/reports/${current}/export.csv`}><Icon name="download" size={15} /> CSV</a>
            ) : (
              <a className="btn secondary" href={`/api/reports/${current}/export.csv`}><Icon name="download" size={15} /> CSV</a>
            )}
          </div>
        )}

      </div>

      <div className="chips mb-3">
        {list.reports.map(r => (
          <span key={r.key} className={`chip ${current === r.key ? 'active' : ''}`}
            style={current === r.key ? { background: 'var(--primary)', color: '#fff', borderColor: 'var(--primary)' } : null}
            onClick={() => { setCurrent(r.key); setData(null); }}>
            <Icon name={r.icon} size={12} /> {r.title}
          </span>
        ))}
      </div>

      {!current && <EmptyState>Select a report above to view analytics.</EmptyState>}
      {!data && current && <Spinner />}
      {data && (
        <>
          {/* Summary charts per report type */}
          {data.byStatus && (
            <div className="grid-2 mb-3">
              <div className="card card-pad"><h3 className="card-title">By status</h3>
                <DonutChart size={120} thickness={15} centerSub="records"
                  segments={data.byStatus.map((s, i) => ({ label: s.status, value: s.count, color: COLORS[i % COLORS.length] }))} />
              </div>
              {data.byCategory ? (
                <div className="card card-pad"><h3 className="card-title">By category</h3>
                  <BarChart height={140} items={data.byCategory.slice(0, 8).map((s, i) => ({ label: s.category || s.department || s.framework, value: s.count }))} />
                </div>
              ) : data.bySeverity ? (
                <div className="card card-pad"><h3 className="card-title">By severity</h3>
                  <BarChart height={140} items={data.bySeverity.map(s => ({ label: s.severity, value: s.count, color: { critical: '#dc2626', major: '#d97706' }[s.severity] || '#6366f1' }))} />
                </div>
              ) : data.byFramework ? (
                <div className="card card-pad"><h3 className="card-title">By framework</h3>
                  <BarChart height={140} items={data.byFramework.map(f => ({ label: f.framework.split(' ')[0], value: f.compliant, color: '#16a34a' })).concat(data.byFramework.map(f => ({ label: f.framework.split(' ')[0] + ' gaps', value: f.gaps, color: '#d97706' })))} />
                </div>
              ) : null}
            </div>
          )}

          {/* Highlight panels */}
          {data.overdue?.length > 0 && <div className="alert critical mb-3"><b>{data.overdue.length} overdue action(s):</b> {data.overdue.slice(0, 6).map(a => a.code).join(', ')}</div>}
          {data.reviewOverdue?.length > 0 && <div className="alert warning mb-3"><b>Review overdue:</b> {data.reviewOverdue.map(d2 => `${d2.code}`).join(', ')}</div>}
          {data.expiring?.length > 0 && <div className="alert warning mb-3"><b>Expiring / below required level:</b> {data.expiring.length} assessment(s)</div>}
          {data.lowPerformers?.length > 0 && <div className="alert warning mb-3"><b>Evaluations below 80:</b> {data.lowPerformers.slice(0, 5).map(x => `${x.code} (${x.total_score})`).join(', ')}</div>}
          {data.findings?.length > 0 && <div className="alert info mb-3"><b>Audit findings:</b> {data.findings.filter(f => f.status !== 'closed').length} open of {data.findings.length}</div>}

          {/* Main table */}
          <div className="card table-wrap">
            {!data.rows?.length ? <EmptyState>No data.</EmptyState> : (
              <table className="data">
                <thead><tr>{(data.columns || []).map(c => <th key={c.value}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {data.rows.slice(0, 300).map((row, i) => (
                    <tr key={i}>
                      {(data.columns || []).map(c => {
                        let v = row[c.value];
                        if (v === null || v === undefined || v === '') v = '—';
                        return <td key={c.value}>{typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(v).toLocaleDateString() : String(v)}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {data.trainings && (
            <div className="card table-wrap mt-3">
              <table className="data">
                <thead><tr><th>Training</th><th>Type</th><th>Date</th><th>Status</th><th>Completion</th></tr></thead>
                <tbody>{data.trainings.map(t => (
                  <tr key={t.code}><td><span className="code-chip">{t.code}</span> {t.title}</td><td>{t.type}</td><td>{t.scheduled_date}</td><td><Badge value={t.status} /></td><td>{t.completed}/{t.total}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {data.findings && (
            <div className="card table-wrap mt-3">
              <h3 className="card-title" style={{ padding: '12px 14px 0' }}>Audit findings</h3>
              <table className="data">
                <thead><tr><th>Audit</th><th>Clause</th><th>Type</th><th>Description</th><th>Status</th></tr></thead>
                <tbody>{data.findings.map((f, i) => (
                  <tr key={i}><td>{f.audit}</td><td>{f.clause}</td><td><Badge value={f.finding_type} /></td><td>{f.description}</td><td><Badge value={f.status} /></td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
