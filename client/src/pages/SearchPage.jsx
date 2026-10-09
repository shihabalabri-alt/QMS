import React from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Icon, Spinner } from '../lib/ui';

export default function SearchPage() {
  const [q] = React.useState(() => new URLSearchParams(location.search).get('q') || '');
  const [data, setData] = React.useState(null);
  React.useEffect(() => { if (q) api.get('/search?q=' + encodeURIComponent(q)).then(setData).catch(() => setData({ groups: [] })); }, [q]);
  if (!q) return <div className="page-wrap"><div className="empty-state">Type a search in the top bar — try "NC-0001" or "overdue critical actions"</div></div>;
  if (!data) return <Spinner />;
  if (!data.groups.length) return <div className="page-wrap"><div className="empty-state">No results for "{q}"</div></div>;
  return (
    <div className="page-wrap" style={{ maxWidth: 900 }}>
      <h1 className="page-title"><Icon name="search" /> Search results for "{q}"</h1>
      {data.direct && <div className="alert info mb-3">Exact match: <Link to={data.direct.link} style={{ fontWeight: 700 }}>{data.direct.code} — {data.direct.title}</Link></div>}
      {data.groups.map(g => (
        <div key={g.module} className="card card-pad mb-3">
          <div className="gs-section" style={{ padding: 0 }}>{g.moduleTitle} ({g.rows.length})</div>
          {g.rows.map(r => (
            <div key={g.module + r.id} className="attention-row" style={{ cursor: 'pointer' }} onClick={() => location.href = r.link}>
              {r.code ? <span className="code-chip">{r.code}</span> : <Icon name="search" size={13} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{r.title}</span>
                {r.status && <span className="badge b-gray" style={{ marginLeft: 6, textTransform: 'capitalize' }}>{String(r.status).replace(/_/g, ' ')}</span>}
                <div className="muted small">{r.owner || r.status || ''}</div>
              </div>
              <Icon name="link" size={13} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
