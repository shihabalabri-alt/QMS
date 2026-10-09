import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Icon, Spinner, StatCard } from '../lib/ui';

export default function CompetencyMatrix() {
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [dept, setDept] = useState('all');
  const [err, setErr] = useState('');

  useEffect(() => { api.get('/competency-matrix').then(setData).catch(e => setErr(e.message)); }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    return dept === 'all' ? data.grid : data.grid.filter(e => e.department === dept);
  }, [data, dept]);

  if (err) return <div className="page-wrap"><div className="alert critical">{err}</div></div>;
  if (!data) return <Spinner />;

  const cellColor = (s) => {
    if (s.expired) return '#dc2626';
    if (s.gap) return '#f59e0b';
    if (s.level >= s.required) return '#16a34a';
    return '#e2e8f0';
  };

  return (
    <div className="page-wrap" style={{ maxWidth: 1300 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title"><Icon name="competency" /> Competency Matrix</h1>
          <div className="page-sub">Visual grid of employee skills vs required levels — gaps highlighted.</div>
        </div>
        <select className="input" style={{ width: 180 }} value={dept} onChange={e => setDept(e.target.value)}>
          <option value="all">All departments</option>
          {data.departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      <div className="stat-grid mb-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <StatCard label="Total skill gaps" value={data.stats.totalGaps} accent={data.stats.totalGaps > 0 ? 'warning' : 'success'} icon="alert" />
        <StatCard label="Expired certifications" value={data.stats.totalExpired} accent={data.stats.totalExpired > 0 ? 'danger' : 'success'} icon="risk" />
        <StatCard label="Fully covered skills" value={data.stats.totalCovered} accent="success" icon="check" />
        <StatCard label="Active employees" value={data.stats.totalEmployees} accent="info" icon="people" />
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="data" style={{ minWidth: 800 }}>
          <thead>
            <tr>
              <th style={{ minWidth: 160 }}>Employee</th>
              <th>Department</th>
              {data.competencies.map(c => (
                <th key={c.id} style={{ minWidth: 60, fontSize: 9, textAlign: 'center' }} title={`${c.code} — required level ${c.required}`}>
                  {c.name.split(' ').map(w => w[0]).join('').slice(0, 6)}<br />
                  <span style={{ fontSize: 8, fontWeight: 400 }}>req {c.required}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(emp => (
              <tr key={emp.id}>
                <td>
                  <Link to={`/employees/${emp.id}`} style={{ fontWeight: 600 }}>{emp.name}</Link>
                  <div className="muted small">{emp.job_title}</div>
                </td>
                <td className="muted small">{emp.department}</td>
                {emp.skills.map((s, i) => {
                  const c = data.competencies[i];
                  return (
                    <td key={i} style={{ textAlign: 'center', padding: '6px 2px' }}>
                      <div style={{ display: 'inline-grid', placeItems: 'center', width: 32, height: 32, borderRadius: 8, background: cellColor(s), color: s.level > 0 || s.gap || s.expired ? '#fff' : '#cbd5e1', fontWeight: 700, fontSize: 13 }}
                        title={s.level > 0 ? `Level ${s.level}/${s.required}${s.expiry ? ' · expires ' + s.expiry : ''}` : 'Not assessed'}>
                        {s.level > 0 ? s.level : '–'}
                      </div>
                      {s.gap && !s.expired && <div style={{ fontSize: 8, color: '#d97706', fontWeight: 700 }}>GAP</div>}
                      {s.expired && <div style={{ fontSize: 8, color: '#dc2626', fontWeight: 700 }}>EXPIRED</div>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-3 mt-3 small">
        <span><span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 4, background: '#16a34a', marginRight: 4 }} />Meets requirement</span>
        <span><span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 4, background: '#f59e0b', marginRight: 4 }} />Below required (GAP)</span>
        <span><span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 4, background: '#dc2626', marginRight: 4 }} />Expired</span>
        <span><span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 4, background: '#e2e8f0', marginRight: 4 }} />Not assessed</span>
      </div>
    </div>
  );
}
