import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { Icon, Badge, fmtDateTime } from '../lib/ui';
import { useAuth } from '../App';
import { LogoMark, Wordmark } from './Logo';
import AiAssistant from './AiAssistant';


const NAV = [
  { group: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: 'dashboard', end: true }, { to: '/ai', label: 'AI Assistant', icon: 'ai' }, { to: '/inbox', label: 'Inbox', icon: 'bell' }, { to: '/notifications', label: 'Notifications', icon: 'bell' }] },
  { group: 'Govern', items: [
    { to: '/policies', label: 'Policies', icon: 'policy' },
    { to: '/goals', label: 'Objectives & KPIs', icon: 'goal' },
    { to: '/compliance', label: 'Compliance', icon: 'compliance' },
  ]},
  { group: 'Operate', items: [
    { to: '/risks', label: 'Risk Register', icon: 'risk' },
    { to: '/nonconformances', label: 'NC & Incidents', icon: 'nc' },
    { to: '/actions', label: 'Actions Hub', icon: 'action' },
    { to: '/audits', label: 'Audits', icon: 'audit' },
  ]},
  { group: 'Resources', items: [
    { to: '/documents', label: 'Documents', icon: 'document' },
    { to: '/records', label: 'Records', icon: 'record' },
    { to: '/suppliers', label: 'Suppliers', icon: 'supplier' },
    { to: '/equipment', label: 'Equipment', icon: 'equipment' },
    { to: '/design', label: 'Design Reviews', icon: 'design' },
  ]},
  { group: 'People', items: [
    { to: '/employees', label: 'People', icon: 'people' },
    { to: '/competency-matrix', label: 'Competency Matrix', icon: 'competency' },
    { to: '/competencies', label: 'Competencies', icon: 'competency' },
    { to: '/trainings', label: 'Training', icon: 'training' },
  ]},
  { group: 'Insight', items: [
    { to: '/mgmt-reviews', label: 'Management Review', icon: 'review' },
    { to: '/connections', label: 'Connections Map', icon: 'link' },
    { to: '/reports', label: 'Reports & Export', icon: 'report' },
    { to: '/calendar', label: 'Calendar', icon: 'calendar' },
  ]},
];

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [notifs, setNotifs] = useState({ rows: [], unread: 0 });
  const [inboxCount, setInboxCount] = useState(null);
  const [openNotif, setOpenNotif] = useState(false);
  const [openUser, setOpenUser] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const searchRef = useRef(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('qms-theme') || 'light');

  // Dark mode: apply to <html>, persist choice
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('qms-theme', theme);
  }, [theme]);

  // Browser tab title follows the current section
  useEffect(() => {
    const all = NAV.flatMap(g => g.items);
    const hit = all.find(it => it.end ? loc.pathname === it.to : (loc.pathname === it.to || loc.pathname.startsWith(it.to + '/')));
    document.title = hit ? `QualiCore — ${hit.label}` : 'QualiCore — Quality, Risk & Compliance Management';
  }, [loc.pathname]);

  // Press "/" anywhere to jump to global search
  useEffect(() => {
    const h = e => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      const inp = document.querySelector('.global-search input');
      if (inp) inp.focus();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Back-to-top button visibility
  const [showTop, setShowTop] = useState(false);
  useEffect(() => {
    const h = () => setShowTop(window.scrollY > 600);
    window.addEventListener('scroll', h, { passive: true });
    return () => window.removeEventListener('scroll', h);
  }, []);

  // Fetch notification count from the database
  const fetchNotifs = useCallback(() => {
    api.get('/notifications?limit=12').then(d => { setNotifs(d); }).catch(() => {});
  }, []);
  const fetchInboxCount = useCallback(() => {
    api.get('/inbox/count').then(d => { setInboxCount(d.attention); }).catch(() => {});
  }, []);

  // Initial load + poll every 15 seconds
  useEffect(() => {
    let live = true;
    const tick = () => {
      api.get('/notifications?limit=12').then(d => { if (live) setNotifs(d); }).catch(() => {});
      api.get('/inbox/count').then(d => { if (live) setInboxCount(d.attention); }).catch(() => {});
    };
    tick();
    const t = setInterval(tick, 15000);
    return () => { live = false; clearInterval(t); };
  }, []);

  // Listen for notification changes from any page (live sync)
  useEffect(() => {
    const handler = () => { fetchNotifs(); };
    window.addEventListener('qms-notif-changed', handler);
    return () => window.removeEventListener('qms-notif-changed', handler);
  }, [fetchNotifs]);

  useEffect(() => {
    if (q.trim().length < 2) { setResults(null); return; }
    setSearching(true);
    const t = setTimeout(() => {
      api.get(`/search?q=${encodeURIComponent(q)}`).then(setResults).catch(() => {}).finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => { setSidebarOpen(false); setQ(''); setResults(null); }, [loc.pathname]);

  const go = (link) => { nav(link); setQ(''); setResults(null); };

  async function markRead(id) {
    await api.post(`/notifications/${id}/read`);
    fetchNotifs();
    window.dispatchEvent(new Event('qms-notif-changed'));
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand">
          <LogoMark size={36} />
          <div>
            <Wordmark size={19} />
            <div className="brand-sub">Connected Intelligence</div>
          </div>
        </div>
        {NAV.map(g => (
          <React.Fragment key={g.group}>
            <div className="nav-group-label">{g.group}</div>
            {g.items.map(it => {
              const active = it.end ? loc.pathname === it.to : loc.pathname.startsWith(it.to);
              return (
                <a key={it.to} href={it.to} className={`nav-item ${active ? 'active' : ''}`} onClick={e => { e.preventDefault(); nav(it.to); }}>
                  <Icon name={it.icon} /> {it.label}
                </a>
              );
            })}
          </React.Fragment>
        ))}
        {(user.role === 'admin' || user.role === 'quality_manager' || user.role === 'management') && (
          <>
            <div className="nav-group-label">System</div>
            <a href="/admin" className={`nav-item ${loc.pathname.startsWith('/admin') ? 'active' : ''}`} onClick={e => { e.preventDefault(); nav('/admin'); }}>
              <Icon name="settings" /> Administration
            </a>
          </>
        )}
        <div className="sidebar-footer">{user.name} · {user.roleLabel}</div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)}><Icon name="menu" /></button>
          <div className="global-search" ref={searchRef}>
            <Icon name="search" className="gs-icon" size={16} />
            <svg className="gs-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 19a8 8 0 100-16 8 8 0 000 16zm10 2l-4.35-4.35"/></svg>
            <input
              placeholder="Search everything — codes, titles, or ask a question…"
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && q.trim()) go(`/ai?q=${encodeURIComponent(q)}`); }}
            />
            {results && (results.groups.length > 0 || results.direct) && (
              <div className="gs-dropdown">
                {results.direct && (
                  <div className="gs-row" onClick={() => go(results.direct.link)}>
                    <span className="gs-code">{results.direct.code}</span>
                    <b>{results.direct.title}</b>
                    <Badge value={results.direct.module} />
                  </div>
                )}
                {results.groups.map(g => (
                  <React.Fragment key={g.module}>
                    <div className="gs-section">{g.moduleTitle}</div>
                    {g.rows.map(r => (
                      <div key={r.link} className="gs-row" onClick={() => go(r.link)}>
                        {r.code && <span className="gs-code">{r.code}</span>}
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
                        {r.status && <Badge value={r.status} />}
                      </div>
                    ))}
                  </React.Fragment>
                ))}
                <div className="gs-row" style={{ color: 'var(--primary)', fontWeight: 600 }} onClick={() => go(`/ai?q=${encodeURIComponent(q)}`)}>
                  <Icon name="ai" size={15} /> Ask the AI about “{q}”
                </div>
              </div>
            )}
          </div>

          <button className="icon-btn" title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>

          <div style={{ position: 'relative' }}>
            <button className="icon-btn" title="Notifications" onClick={() => setOpenNotif(!openNotif)}>
              <Icon name="bell" />
              {notifs.unread > 0 && <span className="badge-dot">{notifs.unread}</span>}
            </button>
            {openNotif && (
              <div className="popover">
                <div className="flex justify-between items-center" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                  <b style={{ fontSize: 13.5 }}>Notifications</b>
                  <div className="flex gap-2">
                    <button className="btn sm ghost" onClick={() => { setOpenNotif(false); nav('/notifications'); }}>View all →</button>
                    <button className="btn sm ghost" onClick={async () => { await api.post('/notifications/read-all'); fetchNotifs(); window.dispatchEvent(new Event('qms-notif-changed')); }}>✓ All</button>
                  </div>
                </div>
                {notifs.rows.length === 0 && <div className="empty-state">You're all caught up.</div>}
                {notifs.rows.map(n => (
                  <div key={n.id} className={`notif-row ${n.read ? '' : 'unread'}`} onClick={() => { markRead(n.id); fetchNotifs(); window.dispatchEvent(new Event('qms-notif-changed')); setOpenNotif(false); if (n.link) nav(n.link); }}>
                    <div style={{ flex: 1 }}>
                      <div className="notif-title">{n.title}</div>
                      <div className="notif-body">{n.body}</div>
                      <div className="notif-time">{fmtDateTime(n.created_at)}</div>
                    </div>
                    {!n.read && <span style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--primary)', marginTop: 6 }} />}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ position: 'relative' }}>
            <button className="user-chip" style={{ cursor: 'pointer' }} onClick={() => setOpenUser(!openUser)}>
              <div className="avatar">{user.name.split(' ').map(x => x[0]).slice(0, 2).join('')}</div>
              <div className="user-meta" style={{ textAlign: 'left' }}>
                <div className="user-name">{user.name}</div>
                <div className="user-role">{user.roleLabel}</div>
              </div>
            </button>
            {openUser && (
              <div className="popover" style={{ width: 230 }}>
                <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
                  <b>{user.email}</b>
                  <div className="muted small">{user.department} · {user.job_title}</div>
                </div>
                <div className="gs-row" onClick={() => nav('/security')}><Icon name="settings" size={15} /> My security (password & 2FA)</div>
                <div className="gs-row" onClick={() => { logout(); }}><Icon name="logout" size={15} /> Sign out</div>
              </div>
            )}
          </div>
        </header>

        <Outlet />
        {showTop && <button className="back-top no-print" title="Back to top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>↑</button>}

        <AiAssistant />
      </div>
    </div>
  );
}
