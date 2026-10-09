import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Icon, Spinner, Badge, fmtDate } from '../lib/ui';

const TYPE_CLASS = { 'Action due': 'ce-action', 'Document review': 'ce-review', 'Policy review': 'ce-review', 'Risk review': 'ce-review', 'Compliance review': 'ce-review', 'KPI review': 'ce-review', Audit: 'ce-audit', 'Supplier audit': 'ce-audit', Training: 'ce-other', Calibration: 'ce-audit', Maintenance: 'ce-other', 'Certification expiry': 'ce-expiry', 'Management review': 'ce-review', 'Design review': 'ce-other' };

export default function CalendarPage() {
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [cursor, setCursor] = useState(() => new Date());
  const [filterType, setFilterType] = useState('all');

  useEffect(() => {
    const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1).toISOString().slice(0, 10);
    const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).toISOString().slice(0, 10);
    api.get(`/calendar?from=${from}&to=${to}`).then(setData);
  }, [cursor]);

  const cells = useMemo(() => {
    if (!data) return [];
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startDow = (first.getDay() + 6) % 7; // Monday-first
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const arr = [];
    for (let i = 0; i < startDow; i++) arr.push({ empty: true });
    for (let dnum = 1; dnum <= daysInMonth; dnum++) {
      const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(dnum).padStart(2, '0')}`;
      arr.push({
        day: dnum,
        dateStr,
        today: dateStr === new Date().toISOString().slice(0, 10),
        items: data.items.filter(i => i.date === dateStr && (filterType === 'all' || i.type === filterType))
      });
    }
    while (arr.length % 7 !== 0) arr.push({ empty: true });
    return arr;
  }, [data, cursor, filterType]);

  if (!data) return <Spinner />;
  const types = [...new Set(data.items.map(i => i.type))];

  return (
    <div className="page-wrap">
      <div className="page-head">
        <div>
          <h1 className="page-title"><Icon name="calendar" /> Deadlines & Calendar</h1>
          <div className="page-sub">Every deadline across actions, reviews, audits, calibrations and certifications</div>
        </div>
        <div className="flex gap-2 items-center">
          <button className="btn sm" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>←</button>
          <b>{cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b>
          <button className="btn sm" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>→</button>
        </div>
      </div>

      <div className="filter-bar">
        <select className="input" value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="all">All event types ({data.items.length})</option>
          {types.map(t => <option key={t} value={t}>{t} ({data.items.filter(i => i.type === t).length})</option>)}
        </select>
      </div>

      <div className="card card-pad">
        <div className="cal-grid mb-3" style={{ marginBottom: 8 }}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textAlign: 'center' }}>{d.toUpperCase()}</div>)}
        </div>
        <div className="cal-grid">
          {cells.map((c, i) => c.empty ? <div key={i} style={{ minHeight: 92 }} /> : (
            <div key={i} className={`cal-cell ${c.today ? 'cal-today' : ''}`}>
              <div className="flex justify-between"><span className="cal-day-num">{c.day}</span>{c.today && <span className="badge b-indigo">today</span>}</div>
              {c.items.slice(0, 3).map((ev, j) => (
                <div key={j} className={`cal-event ${TYPE_CLASS[ev.type] || 'ce-other'}`} title={`${ev.type}: ${ev.label}`} onClick={() => ev.link && nav(ev.link)}>{ev.label.length > 26 ? ev.label.slice(0, 26) + '…' : ev.label}</div>
              ))}
              {c.items.length > 3 && <span className="muted" style={{ fontSize: 10.5 }}>+{c.items.length - 3} more</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="card card-pad mt-4">
        <h3 className="card-title">This month as a list ({filtered(data, filterType).length})</h3>
        {filtered(data, filterType).slice(0, 40).map((ev, i) => (
          <div key={i} className="attention-row" style={{ cursor: 'pointer' }} onClick={() => ev.link && nav(ev.link)}>
            <span className="badge b-blue">{fmtDate(ev.date)}</span>
            <b style={{ minWidth: 130 }}>{ev.type}</b>
            <span style={{ flex: 1 }}>{ev.label}</span>
            <Badge value={ev.status || 'scheduled'} />
          </div>
        ))}
      </div>
    </div>
  );
}
function filtered(data, t) { return data.items.filter(i => t === 'all' || i.type === t); }
