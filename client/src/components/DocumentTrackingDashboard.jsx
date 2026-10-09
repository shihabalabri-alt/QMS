import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Icon, Badge, Spinner, EmptyState, showToast, fmtDate, daysBadge } from '../lib/ui';

const STAGE_ORDER = ['draft', 'review', 'approval', 'distribution', 'effective', 'archived'];
const PRIORITY_ORDER = ['critical', 'high', 'normal', 'low'];
const ROUTING_STATUS_ORDER = ['pending', 'in_progress', 'on_hold', 'escalated', 'completed', 'rejected'];

export function DocumentTrackingDashboard() {
  const [summary, setSummary] = useState(null);
  const [filterOptions, setFilterOptions] = useState(null);
  const [acrossData, setAcrossData] = useState(null);
  const [compareIds, setCompareIds] = useState([]);
  const [compareData, setCompareData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [acrossGroupBy, setAcrossGroupBy] = useState('current_stage');
  const [acrossMetric, setAcrossMetric] = useState('count');
  const [timelineDocId, setTimelineDocId] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [showCompareModal, setShowCompareModal] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [s, f, a] = await Promise.all([
        api.get('/tracking/documents/tracking/summary'),
        api.get('/tracking/documents/tracking/filter-options'),
        api.get('/tracking/documents/tracking/across?groupBy=current_stage&metric=count')
      ]);
      setSummary(s);
      setFilterOptions(f);
      setAcrossData(a);
    } catch (e) {
      showToast(e.message, 'error');
    }
    setLoading(false);
  }

  async function loadAcross() {
    try {
      const a = await api.get(`/tracking/documents/tracking/across?groupBy=${acrossGroupBy}&metric=${acrossMetric}`);
      setAcrossData(a);
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function loadCompare() {
    if (compareIds.length < 2) return;
    try {
      const c = await api.get(`/tracking/documents/tracking/compare?ids=${compareIds.join(',')}`);
      setCompareData(c);
      setShowCompareModal(true);
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function loadTimeline(docId) {
    try {
      const t = await api.get(`/tracking/documents/tracking/${docId}/timeline`);
      setTimeline(t);
      setTimelineDocId(docId);
    } catch (e) { showToast(e.message, 'error'); }
  }

  function addToCompare(id) {
    setCompareIds(prev => {
      if (prev.includes(id)) return prev;
      if (prev.length >= 5) return [...prev.slice(1), id];
      return [...prev, id];
    });
  }

  function removeFromCompare(id) {
    setCompareIds(prev => prev.filter(x => x !== id));
  }

  const statCards = [
    { label: 'Total Documents', value: summary?.total || 0, icon: 'document', color: 'var(--primary)' },
    { label: 'SLA Breaches', value: summary?.slaBreached || 0, icon: 'alert', color: 'var(--danger)', alert: true },
    { label: 'Overdue', value: summary?.overdue || 0, icon: 'clock', color: 'var(--warning)', alert: true },
    { label: 'Escalated', value: summary?.escalated || 0, icon: 'arrow-up', color: 'var(--danger)', alert: true },
    { label: 'Avg Days in Stage', value: Math.round(summary?.avgDaysInStage || 0), icon: 'timer', color: 'var(--info)' },
    { label: 'Routing Active', value: summary?.byRoutingStatus?.find(x => x.routing_status === 'in_progress')?.c || 0, icon: 'arrow-right', color: 'var(--success)' },
  ];

  const stageCards = (summary?.byStage || []).map(s => ({
    stage: s.current_stage, count: s.c,
    order: STAGE_ORDER.indexOf(s.current_stage), color: s.current_stage === 'archived' ? 'var(--muted)' : 'var(--primary)'
  })).sort((a, b) => a.order - b.order);

  return (
    <div className="page-wrap">
      <div className="gs-section" style={{ marginBottom: 16 }}>Document Tracking Dashboard</div>

      {loading ? <Spinner /> : (
        <>
          <div className="card-grid" style={{ marginBottom: 20 }}>
            {statCards.map((c, i) => (
              <div key={i} className={`card stat-card ${c.alert ? 'stat-alert' : ''}`}>
                <div className="stat-icon" style={{ background: c.color }}><Icon name={c.icon} size={20} /></div>
                <div className="stat-value" style={{ color: c.color }}>{c.value}</div>
                <div className="stat-label">{c.label}</div>
              </div>
            ))}
          </div>

          <div className="card-grid" style={{ marginBottom: 20 }}>
            <div className="card card-pad span-2">
              <div className="card-title">Pipeline by Stage</div>
              <div className="flex gap-2 wrap" style={{ marginTop: 12 }}>
                {stageCards.map(s => (
                  <div key={s.stage} className="stage-pill" style={{ background: s.color + '20', borderColor: s.color }}>
                    <span className="stage-name" style={{ color: s.color }}>{s.stage.charAt(0).toUpperCase() + s.stage.slice(1)}</span>
                    <span className="stage-count" style={{ color: s.color }}>{s.count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card card-pad">
              <div className="card-title">By Priority</div>
              <div className="flex flex-col gap-2" style={{ marginTop: 12 }}>
                {(summary?.byPriority || []).map(p => (
                  <div key={p.review_priority} className="flex justify-between">
                    <Badge value={p.review_priority}>{p.c}</Badge>
                  </div>
                ))}
              </div>
            </div>

            <div className="card card-pad">
              <div className="card-title">By Routing Status</div>
              <div className="flex flex-col gap-2" style={{ marginTop: 12 }}>
                {(summary?.byRoutingStatus || []).map(r => (
                  <div key={r.routing_status} className="flex justify-between">
                    <Badge value={r.routing_status}>{r.c}</Badge>
                  </div>
                ))}
              </div>
            </div>

            <div className="card card-pad">
              <div className="card-title">By Department</div>
              <div className="flex flex-col gap-2" style={{ marginTop: 12 }}>
                {(summary?.byDepartment || []).slice(0, 8).map(d => (
                  <div key={d.department} className="flex justify-between">
                    <span>{d.department}</span>
                    <Badge value={d.c}>{d.c}</Badge>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card card-pad" style={{ marginBottom: 20 }}>
            <div className="card-title">Cross-Module Analysis</div>
            <div className="filter-bar" style={{ marginBottom: 16 }}>
              <select className="input" value={acrossGroupBy} onChange={e => { setAcrossGroupBy(e.target.value); loadAcross(); }}>
                <option value="current_stage">Stage</option>
                <option value="status">Status</option>
                <option value="category">Category</option>
                <option value="department">Department</option>
                <option value="review_priority">Priority</option>
                <option value="routing_status">Routing Status</option>
              </select>
              <select className="input" value={acrossMetric} onChange={e => { setAcrossMetric(e.target.value); loadAcross(); }}>
                <option value="count">Count</option>
                <option value="avg_days_in_stage">Avg Days in Stage</option>
                <option value="sla_breach_rate">SLA Breach Rate (%)</option>
                <option value="escalation_rate">Escalation Rate (%)</option>
              </select>
            </div>
            {acrossData && (
              <table className="data">
                <thead><tr><th>{acrossData.groupBy}</th><th>{acrossData.metric}</th></tr></thead>
                <tbody>
                  {acrossData.rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.group_value || '—'}</td>
                      <td className="mono">{typeof r.value === 'number' ? Number(r.value).toFixed(1) : r.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card card-pad">
            <div className="card-title">Document Compare (max 5)</div>
            <div className="filter-bar" style={{ marginBottom: 16 }}>
              <span className="small muted">Selected: {compareIds.length}/5</span>
              {compareIds.map(id => (
                <Badge key={id} onClick={() => removeFromCompare(id)}>{id} <Icon name="x" size={10} /></Badge>
              ))}
              <button className="btn primary" onClick={loadCompare} disabled={compareIds.length < 2} style={{ marginLeft: 'auto' }}>
                Compare
              </button>
              <button className="btn" onClick={() => setCompareIds([])}>Clear</button>
            </div>
            {compareData && (
              <table className="data">
                <thead><tr><th>Field</th>{compareData.rows.map(r => <th key={r.id}>{r.code}</th>)}</tr></thead>
                <tbody>
                  <tr><td>Title</td>{compareData.rows.map(r => <td key={r.id}>{r.title}</td>)}</tr>
                  <tr><td>Category</td>{compareData.rows.map(r => <td key={r.id}>{r.category}</td>)}</tr>
                  <tr><td>Department</td>{compareData.rows.map(r => <td key={r.id}>{r.department}</td>)}</tr>
                  <tr><td>Status</td>{compareData.rows.map(r => <td key={r.id}><Badge value={r.status} /></td>)}</tr>
                  <tr><td>Stage</td>{compareData.rows.map(r => <td key={r.id}><Badge value={r.current_stage} /></td>)}</tr>
                  <tr><td>Days in Stage</td>{compareData.rows.map(r => <td key={r.id} className="mono">{r.days_in_stage}</td>)}</tr>
                  <tr><td>Priority</td>{compareData.rows.map(r => <td key={r.id}><Badge value={r.review_priority} /></td>)}</tr>
                  <tr><td>SLA Breached</td>{compareData.rows.map(r => <td key={r.id}><Badge value={r.sla_breached ? 'Yes' : 'No'} /></td>)}</tr>
                  <tr><td>Escalation Level</td>{compareData.rows.map(r => <td key={r.id} className="mono">{r.escalation_level}</td>)}</tr>
                  <tr><td>Routing Status</td>{compareData.rows.map(r => <td key={r.id}><Badge value={r.routing_status} /></td>)}</tr>
                  <tr><td>Review Cycles</td>{compareData.rows.map(r => <td key={r.id} className="mono">{r.total_review_cycles}</td>)}</tr>
                  <tr><td>Review Due</td>{compareData.rows.map(r => <td key={r.id}>{fmtDate(r.review_date)}</td>)}</tr>
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {timeline && (
        <div className="modal-overlay" onClick={() => setTimelineDocId(null)}>
          <div className="modal wide" style={{ maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <h2>Timeline: {timeline.document.code}</h2>
              <button className="btn ghost" onClick={() => setTimelineDocId(null)}><Icon name="x" size={16} /></button>
            </div>
            <div className="tabs">
              <span className={`tab ${!['routing', 'audit', 'comments', 'versions'].includes('active') ? 'active' : ''}`} onClick={() => setTimelineDocId(timelineDocId)}>All</span>
              <span className="tab">Versions ({timeline.history.length})</span>
              <span className="tab">Routing ({timeline.routing.length})</span>
              <span className="tab">Audit ({timeline.auditLog.length})</span>
              <span className="tab">Comments ({timeline.comments.length})</span>
            </div>
            <div className="timeline">
              {timeline.history.map((h, i) => (
                <div key={i} className="tl-item">
                  <span className="tl-dot" style={{ background: 'var(--primary)' }} />
                  <div>
                    <b>Version {h.version}</b> · {h.status}
                    {h.approved_by && <div className="muted small">Approved by {h.approved_by} on {fmtDate(h.approved_at)}</div>}
                    {h.change_summary && <div className="muted small">{h.change_summary}</div>}
                  </div>
                </div>
              ))}
              {timeline.routing.map((r, i) => (
                <div key={i} className="tl-item">
                  <span className="tl-dot" style={{ background: r.status === 'completed' ? 'var(--success)' : r.status === 'rejected' ? 'var(--danger)' : 'var(--info)' }} />
                  <div>
                    <b>Routing: {r.rule_name}</b> · {r.status}
                    <div className="muted small">Step {r.current_step} · {r.step_history}</div>
                  </div>
                </div>
              ))}
              {timeline.auditLog.map((a, i) => (
                <div key={i} className="tl-item">
                  <span className="tl-dot" style={{ background: a.action.includes('delete') ? 'var(--danger)' : 'var(--primary)' }} />
                  <div>
                    <b>{a.user_name || 'System'}</b> <Badge value={a.action}>{a.action}</Badge>
                    {a.details && <div className="muted small mono">{String(a.details).slice(0, 200)}</div>}
                    <div className="tl-muted">{fmtDate(a.created_at)}</div>
                  </div>
                </div>
              ))}
              {timeline.comments.map((c, i) => (
                <div key={i} className="tl-item">
                  <span className="tl-dot" style={{ background: 'var(--info)' }} />
                  <div>
                    <b>{c.user_name || c.user_id}</b> <div>{c.body}</div>
                    <div className="tl-muted">{fmtDate(c.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showCompareModal && compareData && (
        <div className="modal-overlay" onClick={() => setShowCompareModal(false)}>
          <div className="modal wide" style={{ maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <h2>Document Compare ({compareData.rows.length} documents)</h2>
              <button className="btn ghost" onClick={() => setShowCompareModal(false)}><Icon name="x" size={16} /></button>
            </div>
            <table className="data">
              <thead><tr><th>Field</th>{compareData.rows.map(r => <th key={r.id}>{r.code}</th>)}</tr></thead>
              <tbody>
                <tr><td>Title</td>{compareData.rows.map(r => <td key={r.id}>{r.title}</td>)}</tr>
                <tr><td>Category</td>{compareData.rows.map(r => <td key={r.id}>{r.category}</td>)}</tr>
                <tr><td>Department</td>{compareData.rows.map(r => <td key={r.id}>{r.department}</td>)}</tr>
                <tr><td>Status</td>{compareData.rows.map(r => <td key={r.id}><Badge value={r.status} /></td>)}</tr>
                <tr><td>Stage</td>{compareData.rows.map(r => <td key={r.id}><Badge value={r.current_stage} /></td>)}</tr>
                <tr><td>Days in Stage</td>{compareData.rows.map(r => <td key={r.id} className="mono">{r.days_in_stage}</td>)}</tr>
                <tr><td>Priority</td>{compareData.rows.map(r => <td key={r.id}><Badge value={r.review_priority} /></td>)}</tr>
                <tr><td>SLA Breached</td>{compareData.rows.map(r => <td key={r.id}><Badge value={r.sla_breached ? 'Yes' : 'No'} /></td>)}</tr>
                <tr><td>Escalation Level</td>{compareData.rows.map(r => <td key={r.id} className="mono">{r.escalation_level}</td>)}</tr>
                <tr><td>Routing Status</td>{compareData.rows.map(r => <td key={r.id}><Badge value={r.routing_status} /></td>)}</tr>
                <tr><td>Review Cycles</td>{compareData.rows.map(r => <td key={r.id} className="mono">{r.total_review_cycles}</td>)}</tr>
                <tr><td>Review Due</td>{compareData.rows.map(r => <td key={r.id}>{fmtDate(r.review_date)}</td>)}</tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}