import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Icon, Spinner, Badge, showToast, fmtDate, daysBadge } from '../lib/ui';

const TASK_TYPES = [
  ['all', 'All'], ['action', 'Action'], ['approval', 'Approval'], ['review', 'Review'],
  ['training', 'Training'], ['risk', 'Risk'], ['nc', 'Non-Conformance'], ['audit', 'Audit'],
  ['supplier', 'Supplier'], ['equipment', 'Equipment'], ['compliance', 'Compliance'], ['document', 'Document']
];
const DUE_FILTERS = [
  ['all', 'All'], ['overdue', 'Overdue'], ['dueToday', 'Due Today'], ['dueThisWeek', 'Due This Week'], ['upcoming', 'Upcoming']
];
const PRIO_FILTERS = ['all', 'critical', 'high', 'medium', 'low'];
const SORTS = [['priority', 'Priority'], ['dueDate', 'Due Date'], ['createdDate', 'Created'], ['module', 'Module'], ['status', 'Status']];

export default function Inbox() {
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [taskType, setTaskType] = useState('all');
  const [dueFilter, setDueFilter] = useState('all');
  const [priority, setPriority] = useState('all');
  const [sortBy, setSortBy] = useState('priority');

  const load = async () => {
    const qs = new URLSearchParams({ sort: sortBy });
    if (taskType !== 'all') qs.set('taskType', taskType);
    if (dueFilter !== 'all') qs.set('dueFilter', dueFilter);
    if (priority !== 'all') qs.set('priority', priority);
    const d = await api.get(`/inbox?${qs}`).catch(() => null);
    setData(d);
  };
  useEffect(() => { load(); }, [taskType, dueFilter, priority, sortBy]);
  useEffect(() => { const t = setInterval(load, 30000); return () => clearInterval(t); }, [taskType, dueFilter, priority, sortBy]);

  async function completeAction(item, e) {
    if (e) e.stopPropagation();
    try {
      await api.post(`/actions/${item.recordId}/complete`, { notes: 'Completed from Inbox' });
      showToast(`${item.code} completed`);
      window.dispatchEvent(new Event('qms-notif-changed'));
      load();
    } catch (ex) { showToast(ex.message, 'error'); }
  }

  if (!data) return <Spinner />;
  const { sections, counts, attentionCount } = data;
  const isEmpty = attentionCount === 0;

  function renderSection(title, items, color) {
    if (!items || !items.length) return null;
    return (
      <div className="card card-pad mb-3">
        <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: color }} />
          <h3 className="card-title" style={{ margin: 0 }}>{title} ({items.length})</h3>
        </div>
        {items.map(item => (
          <div key={item.id} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)', alignItems: 'flex-start', cursor: 'pointer' }} onClick={() => nav(item.link)}>
            <span className={`badge ${item.priority === 'critical' ? 'b-red' : item.priority === 'high' ? 'b-amber' : item.priority === 'low' ? 'b-gray' : 'b-blue'}`} style={{ minWidth: 64, justifyContent: 'center' }}>{String(item.priority).toUpperCase()}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="code-chip">{item.code}</span>
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>{item.title}</span>
                <span className="badge b-gray" style={{ fontSize: 11 }}>{item.moduleLabel}</span>
                {item.taskType === 'approval' && <span className="badge b-indigo">waiting</span>}
                {item.overdue && <span className="badge b-red">OVERDUE {item.dueDate ? `• ${fmtDate(item.dueDate)}` : ''}</span>}
              </div>
              <div className="muted small" style={{ marginTop: 3 }}>{item.requiredNextStep}</div>
              <div className="muted small" style={{ marginTop: 3 }}>
                Status: <b>{String(item.status).replace(/_/g, ' ')}</b> · Owner: {item.owner || '—'} · Created: {fmtDate(item.createdAt)}
                {item.dueDate && !item.overdue && <> · Due: {fmtDate(item.dueDate)} {daysBadge(Math.ceil((new Date(item.dueDate) - new Date()) / 86400000))}</>}
              </div>
            </div>
            <div className="flex gap-2" style={{ flexShrink: 0 }} onClick={e => e.stopPropagation()}>
              {item.recordType === 'actions' && item.status === 'open' && (
                <button className="btn sm success" onClick={e => completeAction(item, e)}><Icon name="check" size={12} /> Complete</button>
              )}
              <button className="btn sm ghost" onClick={() => nav(item.link)}><Icon name="link" size={13} /></button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="page-wrap" style={{ maxWidth: 1000 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title"><Icon name="bell" /> Inbox</h1>
          <div className="page-sub">
            {isEmpty ? 'Nothing requires your attention — you are all caught up. 🎉' : (
              <><b>{attentionCount}</b> item(s) require your attention · {counts.overdue} overdue · {counts.dueSoon} due soon · {counts.waiting} waiting for you</>
            )}
          </div>
        </div>
        <button className="btn sm ghost" onClick={load}><Icon name="search" size={13} /> Refresh</button>
      </div>

      {/* Filters + sorting */}
      <div className="card card-pad mb-3">
        <div className="flex gap-2 wrap items-center">
          <span className="muted small" style={{ fontWeight: 700 }}>FILTER:</span>
          <select className="input" style={{ minWidth: 140 }} value={taskType} onChange={e => setTaskType(e.target.value)}>
            {TASK_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select className="input" style={{ minWidth: 130 }} value={dueFilter} onChange={e => setDueFilter(e.target.value)}>
            {DUE_FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select className="input" style={{ minWidth: 110 }} value={priority} onChange={e => setPriority(e.target.value)}>
            {PRIO_FILTERS.map(p => <option key={p} value={p}>{p === 'all' ? 'All priorities' : p}</option>)}
          </select>
          <span className="muted small" style={{ fontWeight: 700, marginLeft: 8 }}>SORT:</span>
          <select className="input" style={{ minWidth: 130 }} value={sortBy} onChange={e => setSortBy(e.target.value)}>
            {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        {(taskType !== 'all' || dueFilter !== 'all' || priority !== 'all') && (
          <div className="flex gap-2 wrap items-center mt-3">
            {taskType !== 'all' && <span className="badge b-indigo">{taskType}</span>}
            {dueFilter !== 'all' && <span className="badge b-red">{dueFilter}</span>}
            {priority !== 'all' && <span className="badge b-amber">{priority}</span>}
            <button className="btn sm ghost" onClick={() => { setTaskType('all'); setDueFilter('all'); setPriority('all'); }}>Clear filters</button>
          </div>
        )}
      </div>

      {isEmpty ? (
        <div className="card card-pad"><div className="empty-state">No items require your attention right now — enjoy the calm.</div></div>
      ) : (
        <>
          {renderSection('Overdue — past deadline', sections.overdue, '#dc2626')}
          {renderSection('Due Soon — next 7 days', sections.dueSoon, '#d97706')}
          {renderSection('Waiting for Me — your approval or decision', sections.waiting, '#4f46e5')}
          {renderSection('Requires Action — your active tasks', sections.requiresAction, '#0284c7')}
          {renderSection('Due This Week', (data.items || []).filter(i => i.dueThisWeek && !i.overdue && !i.isCompleted), '#7c3aed')}
          {renderSection('Recently Updated — changed in the last 7 days', sections.recentlyUpdated, '#64748b')}
          {renderSection('Completed — last 14 days (reference)', sections.completed, '#16a34a')}
        </>
      )}

      {/* History keeps everything — recently updated is informational, not filtered out */}
      <div className="muted small" style={{ textAlign: 'center', marginTop: 16 }}>
        Showing {data.filteredTotal} of {data.total} item(s) · auto-updates every 30 seconds
      </div>
    </div>
  );
}
