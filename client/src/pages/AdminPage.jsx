import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Icon, Spinner, Badge, Modal, showToast, fmtDateTime, StatCard } from '../lib/ui';
import { useAuth } from '../App';

const TABS = [
  { key: 'users', label: 'Users & Roles', adminOnly: true },
  { key: 'security', label: 'Security Monitor', adminOnly: false },
  { key: 'audit', label: 'Audit Trail', adminOnly: false },
  { key: 'integrations', label: 'Integrations', adminOnly: true },
  { key: 'system', label: 'System & AI Decisions', adminOnly: true }
];

export default function AdminPage() {
  const { tab = 'audit' } = useParams();
  const { user: me } = useAuth();
  const isAdmin = me.role === 'admin';
  const nav = useNavigate();

  return (
    <div className="page-wrap">
      <div className="page-head">
        <div>
          <h1 className="page-title"><Icon name="settings" /> Administration</h1>
          <div className="page-sub">Users, audit trail, integrations & system settings</div>
        </div>
      </div>
      {!isAdmin && (
        <div className="alert warning mb-3">You have view access to the audit log. Full administration requires the Administrator role.</div>
      )}
      <div className="tabs mb-3">
        {TABS.filter(t => !t.adminOnly || isAdmin).map(t => (
          <span key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => nav(`/admin/${t.key}`)}>{t.label}</span>
        ))}
      </div>
      {tab === 'users' && isAdmin && <Users />}
      {tab === 'security' && <SecurityMonitor />}
      {tab === 'audit' && <AuditLog />}
      {tab === 'integrations' && isAdmin && <Integrations />}
      {tab === 'system' && isAdmin && <System />}
    </div>
  );
}

function Users() {
  const [d, setD] = useState(null);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [verifyInfo, setVerifyInfo] = useState(null);
  const load = () => api.get('/admin/users').then(setD);
  useEffect(() => { load(); }, []);
  if (!d) return <Spinner />;

  async function sendVerification(u) {
    try {
      const r = await api.post(`/admin/users/${u.id}/send-verification`);
      if (r.delivered) showToast(`Verification email sent to ${u.email}`);
      else setVerifyInfo({ email: u.email, link: r.devLink });
    } catch (e) { showToast(e.message, 'error'); }
  }

  return (
    <div>
      <div className="flex justify-between mb-3">
        <h3 className="card-title">{d.rows.length} users · role-based access control · email verification enforced</h3>
        <button className="btn primary sm" onClick={() => setCreating(true)}><Icon name="plus" size={13} /> Add user</button>
      </div>
      {verifyInfo && (
        <div className="alert warning mb-3">
          <div><b>SMTP not configured.</b> Forward this activation link to <b>{verifyInfo.email}</b>:<br />
            <code className="mono" style={{ wordBreak: 'break-all' }}>{verifyInfo.link}</code>
            <div className="mt-2"><button className="btn sm" onClick={() => { navigator.clipboard.writeText(verifyInfo.link); showToast('Link copied'); }}>Copy link</button></div>
          </div>
        </div>
      )}
      <div className="card table-wrap">
        <table className="data">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Email</th><th>Last login</th><th></th></tr></thead>
          <tbody>
            {d.rows.map(u => {
              const locked = u.locked_until && new Date(u.locked_until.replace(' ', 'T') + 'Z') > new Date();
              return (
                <tr key={u.id}>
                  <td><b>{u.name}</b><div className="muted small">{u.job_title}</div></td>
                  <td>{u.email}</td>
                  <td><Badge value={u.role} /></td>
                  <td>{u.active ? <span className="badge b-green">active</span> : <span className="badge b-red">disabled</span>}
                    {locked && <span className="badge b-amber" style={{ marginLeft: 4 }}>locked</span>}</td>
                  <td>{u.email_verified
                    ? <span className="badge b-green" title="Verified">verified</span>
                    : <span className="badge b-amber" title="Must verify before sign-in">unverified</span>}</td>
                  <td className="muted small">{fmtDateTime(u.last_login)}</td>
                  <td className="flex gap-2 wrap">
                    <button className="btn sm" onClick={() => setEditing(u)}>Edit</button>
                    {!u.email_verified && <button className="btn sm" onClick={() => sendVerification(u)}>Verify…</button>}
                    {(locked || (u.failed_attempts || 0) > 0) &&
                      <button className="btn sm" onClick={async () => { await api.post(`/admin/users/${u.id}/unlock`); showToast('Account unlocked'); load(); }}>Unlock</button>}
                    {me.id !== u.id && <button className={`btn sm ${u.active ? 'danger' : 'success'}`}
                      onClick={async () => { await api.post(`/admin/users/${u.id}/toggle`); load(); }}>{u.active ? 'Disable' : 'Enable'}</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(editing || creating) && (
        <UserModal user={editing} roles={d.roles} onClose={() => { setEditing(null); setCreating(false); }} onSaved={() => { setEditing(null); setCreating(false); load(); }} onCreated={r => {
          if (r && r.verification && !r.verification.delivered && r.verification.devLink) {
            setVerifyInfo({ email: '', link: r.verification.devLink });
          }
        }} />
      )}
    </div>
  );
}

function UserModal({ user, roles, onClose, onSaved }) {
  const [form, setForm] = useState(user ? { ...user } : { name: '', email: '', password: '', role: 'employee', department: 'Quality', job_title: '' });
  const [err, setErr] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  async function save() {
    try {
      if (user) await api.put(`/admin/users/${user.id}`, form);
      else await api.post('/admin/users', form);
      showToast(user ? 'User updated' : 'User created'); onSaved();
    } catch (e) { setErr(e.message); }
  }
  return (
    <Modal title={user ? `Edit ${user.name}` : 'Create user'} onClose={onClose}>
      {err && <div className="alert critical mb-3">{err}</div>}
      <div className="form-grid">
        <div className="field"><label>Name</label><input value={form.name || ''} onChange={e => set('name', e.target.value)} /></div>
        <div className="field"><label>Email</label><input value={form.email || ''} onChange={e => set('email', e.target.value)} /></div>
        <div className="field"><label>Role</label><select value={form.role} onChange={e => set('role', e.target.value)}>{roles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></div>
        <div className="field"><label>Department</label><input value={form.department || ''} onChange={e => set('department', e.target.value)} /></div>
        <div className="field"><label>Job title</label><input value={form.job_title || ''} onChange={e => set('job_title', e.target.value)} /></div>
        {!user && <div className="field"><label>Password (8+ chars)</label><input type="password" value={form.password || ''} onChange={e => set('password', e.target.value)} /></div>}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Save</button>
      </div>
    </Modal>
  );
}

function SecurityMonitor() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/admin/security/events').then(setD).catch(e => showToast(e.message, 'error')); }, []);
  if (!d) return <Spinner />;
  const ACTION_STYLE = { login: 'b-green', login_failed: 'b-red', account_locked: 'b-red', login_blocked_locked: 'b-amber', login_blocked_unverified: 'b-amber', rate_limited: 'b-amber', rate_limited_login: 'b-amber', unlock_account: 'b-blue', reset_password: 'b-indigo', change_password: 'b-indigo', email_verified: 'b-green' };
  return (
    <div>
      <div className="stat-grid mb-3">
        <StatCard label="Failed logins / blocks today" value={d.stats.failedToday} accent={d.stats.failedToday ? 'danger' : 'success'} icon="alert" />
        <StatCard label="Accounts currently locked" value={d.stats.lockedNow} accent={d.stats.lockedNow ? 'warning' : 'success'} icon="lock" />
        <StatCard label="Users awaiting email verification" value={d.stats.unverified} accent={d.stats.unverified ? 'info' : 'success'} icon="people" />
      </div>
      <h3 className="card-title">Security events — sign-ins, lockouts, rate limits, credential & file changes</h3>
      <div className="card table-wrap">
        <table className="data">
          <thead><tr><th>When</th><th>User</th><th>Event</th><th>Detail</th></tr></thead>
          <tbody>
            {d.rows.map(a => (
              <tr key={a.id}>
                <td className="muted small" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(a.created_at)}</td>
                <td>{a.user_name || (a.entity_label || 'Unknown')}</td>
                <td><span className={`badge ${ACTION_STYLE[a.action] || 'b-gray'}`}>{a.action.replace(/_/g, ' ')}</span></td>
                <td className="mono muted small">{(a.details || '').slice(0, 90)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AuditLog() {
  const [d, setD] = useState(null);
  const [q, setQ] = useState('');
  const [action, setAction] = useState('all');
  useEffect(() => {
    const t = setTimeout(() => {
      const qs = new URLSearchParams(); if (q) qs.set('q', q); if (action !== 'all') qs.set('action', action);
      api.get(`/admin/audit-log?${qs}`).then(setD);
    }, 250);
    return () => clearTimeout(t);
  }, [q, action]);
  if (!d) return <Spinner />;
  return (
    <div>
      <h3 className="card-title">Complete audit trail — every change is recorded with identity and timestamp</h3>
      <div className="filter-bar">
        <input className="input" style={{ minWidth: 220 }} placeholder="Search details / entities…" value={q} onChange={e => setQ(e.target.value)} />
        <select className="input" value={action} onChange={e => setAction(e.target.value)}>
          <option value="all">All actions</option>
          {d.actions.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
        </select>
      </div>
      <div className="card table-wrap">
        <table className="data">
          <thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
          <tbody>
            {d.rows.map(a => (
              <tr key={a.id}>
                <td style={{ whiteSpace: 'nowrap' }} className="muted small">{fmtDateTime(a.created_at)}</td>
                <td>{a.user_name || 'System'}</td>
                <td><span className={`badge ${String(a.action).includes('delete') ? 'b-red' : String(a.action).startsWith('status') ? 'b-blue' : String(a.action).startsWith('ai') ? 'b-indigo' : 'b-gray'}`}>{a.action.replace(/_/g, ' ')}</span></td>
                <td>{a.entity_label ? <>{a.entity_type} <b>{a.entity_label}</b></> : a.entity_type}</td>
                <td className="mono muted small" style={{ maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.details}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Integrations() {
  const [keys, setKeys] = useState(null);
  const [hooks, setHooks] = useState(null);
  const [newKey, setNewKey] = useState(null);
  const [keyName, setKeyName] = useState('');
  const [hookUrl, setHookUrl] = useState('');
  const load = () => { api.get('/admin/api-keys').then(setKeys); api.get('/admin/webhooks').then(d => setHooks(d)); };
  useEffect(load, []);

  if (!keys || !hooks) return <Spinner />;
  return (
    <div className="grid-2">
      <div>
        <h3 className="card-title">API keys — external read API (/api/v1)</h3>
        <div className="flex gap-2 mb-3">
          <input className="input" placeholder="Key name (e.g. ERP integration)" value={keyName} onChange={e => setKeyName(e.target.value)} />
          <button className="btn primary sm" onClick={async () => { const r = await api.post('/admin/api-keys', { name: keyName }); setNewKey(r.key); setKeyName(''); load(); }}>Generate</button>
        </div>
        {newKey && <div className="alert success mb-3">New key (copy now, shown once):<br /><code className="mono">{newKey}</code></div>}
        <div className="card table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th>Prefix</th><th>Status</th><th>Last used</th><th></th></tr></thead>
            <tbody>
              {keys.rows.map(k => (
                <tr key={k.id}><td>{k.name}</td><td className="mono">{k.prefix}…</td>
                  <td>{k.active ? <span className="badge b-green">active</span> : <span className="badge b-red">revoked</span>}</td>
                  <td className="muted small">{fmtDateTime(k.last_used)}</td>
                  <td>{k.active && <button className="btn sm danger" onClick={async () => { await api.post(`/admin/api-keys/${k.id}/revoke`); load(); }}>Revoke</button>}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <h3 className="card-title">Webhooks — event notifications to external systems</h3>
        <div className="flex gap-2 mb-3">
          <input className="input" placeholder="https://your-system.com/hooks/qms" value={hookUrl} onChange={e => setHookUrl(e.target.value)} />
          <button className="btn primary sm" onClick={async () => { await api.post('/admin/webhooks', { url: hookUrl, events: [] }); setHookUrl(''); load(); }}>Add</button>
        </div>
        {hooks.rows.map(w => (
          <div key={w.id} className="insight-card">
            <div style={{ flex: 1 }}>
              <b className="small mono">{w.url}</b>
              <div className="muted small">{w.events.length ? w.events.join(', ') : 'all events'} · {w.description || 'no description'}</div>
            </div>
            <button className="btn sm" onClick={async () => { const r = await api.post(`/admin/webhooks/${w.id}/test`); showToast(r.ok ? 'Test delivered' : 'Test failed', r.ok ? 'ok' : 'error'); }}>Test</button>
            <button className="btn sm danger" onClick={async () => { await api.del(`/admin/webhooks/${w.id}`); load(); }}>Delete</button>
          </div>
        ))}
        {hooks.log.slice(0, 8).map(l => (
          <div key={l.id} className="muted small" style={{ padding: '3px 0' }}>{l.event} → {l.ok ? '✓' : '✗'} ({l.status_code}) · {fmtDateTime(l.created_at)}</div>
        ))}
      </div>
    </div>
  );
}

function System() {
  const [ov, setOv] = useState(null);
  const [settings, setSettings] = useState(null);
  const [recs, setRecs] = useState(null);
  const load = () => { api.get('/admin/overview').then(setOv); api.get('/admin/settings').then(d => setSettings(d.settings)); api.get('/ai/recommendations?status=all').then(d => setRecs(d.rows)); };
  useEffect(load, []);
  if (!ov || !settings) return <Spinner />;
  return (
    <div>
      <div className="stat-grid mb-4">
        <div className="stat-card"><div className="stat-value">{ov.users}</div><div className="stat-label">Active users</div></div>
        <div className="stat-card"><div className="stat-value">{Math.round(ov.storageBytes / 1024)} KB</div><div className="stat-label">File storage ({ov.files} files)</div></div>
        <div className="stat-card"><div className="stat-value">{ov.auditEntries}</div><div className="stat-label">Audit entries</div></div>
        <div className="stat-card"><div className="stat-value">{ov.openActions}</div><div className="stat-label">Open actions</div></div>
        <div className="stat-card"><div className="stat-value small" style={{ fontSize: 15 }}>{ov.lastJobRun || '—'}</div><div className="stat-label">Last automation sweep</div></div>
      </div>

      <div className="grid-2">
        <div className="card card-pad">
          <h3 className="card-title">System settings</h3>
          {['org_name', 'alert_days', 'escalate_days'].map(k => (
            <div className="field mb-2" key={k}>
              <label>{k.replace(/_/g, ' ')}</label>
              <input value={settings[k] ?? ''} onChange={e => setSettings(s => ({ ...s, [k]: e.target.value }))} />
            </div>
          ))}
          <button className="btn primary sm" onClick={async () => { await api.put('/admin/settings', settings); showToast('Settings saved'); }}>Save settings</button>
          <div className="muted small mt-3">Automation sweeps run automatically every {ov.jobIntervalMinutes} minutes: overdue reminders → escalations → expiry notifications.</div>
        </div>

        <div className="card card-pad">
          <h3 className="card-title">AI recommendations — human decisions ({(recs || []).filter(r => r.status === 'proposed').length} pending)</h3>
          {(recs || []).slice(0, 10).map(r => (
            <div key={r.id} className="insight-card" style={{ alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <b className="small">{r.op_label}</b>
                <div className="muted small">{r.op_description}</div>
                <div className="muted small">Rationale: {r.rationale}</div>
              </div>
              <Badge value={r.status} />
              {r.status === 'proposed' && r.can_decide && (
                <Decide id={r.id} onDone={load} />
              )}
            </div>
          ))}
          {(!recs || recs.length === 0) && <div className="empty-state">No AI recommendations yet. The AI proposes changes; humans approve or reject them here.</div>}
        </div>
      </div>
    </div>
  );
}

function Decide({ id, onDone }) {
  const [note, setNote] = useState('');
  return (
    <div className="flex gap-2">
      <input className="input" style={{ width: 130 }} placeholder="decision note" value={note} onChange={e => setNote(e.target.value)} />
      <button className="btn sm success" onClick={async () => { const r = await api.post(`/ai/recommendations/${id}/decide`, { decision: 'approve', note }); showToast(r.error || !r.ok ? `Failed: ${r.error}` : 'Approved & executed', r.ok ? 'ok' : 'error'); onDone(); }}>Approve</button>
      <button className="btn sm danger" onClick={async () => { await api.post(`/ai/recommendations/${id}/decide`, { decision: 'reject', note }); showToast('Rejected'); onDone(); }}>Reject</button>
    </div>
  );
}
