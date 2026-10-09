import React, { useState } from 'react';
import { useAuth } from '../App';
import { LogoMark, Wordmark } from '../components/Logo';

const DEMO = [
  ['Administrator', 'admin@qms.io', 'Admin123!'],
  ['Quality Manager', 'qm@qms.io', 'Qm12345!'],
  ['Executive Mgmt', 'management@qms.io', 'Exec12345!'],
  ['Auditor', 'auditor@qms.io', 'Audit123!'],
  ['Standard User', 'employee@qms.io', 'Emp12345!']
];

const PILLARS = [
  ['QUALITY', 'M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z'],
  ['RISK', 'M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z'],
  ['COMPLIANCE', 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6'],
  ['PEOPLE', 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zm14 10v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75'],
  ['OPERATIONS', 'M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z'],
  ['PERFORMANCE', 'M3 3v18h18M7 15l4-4 3 3 5-6']
];

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('admin@qms.io');
  const [password, setPassword] = useState('Admin123!');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState(false);
  const [needTotp, setNeedTotp] = useState(false);
  const [totp, setTotp] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(''); setUnverified(false); setResent(false); setNeedTotp(false);
    try { await login(email, password, totp.trim() || undefined); }
    catch (ex) {
      setErr(ex.message);
      if (/not verified/i.test(ex.message)) setUnverified(true);
      if (ex.code === 'TOTP_REQUIRED' || ex.code === 'TOTP_INVALID') { setNeedTotp(true); setErr(ex.message + (ex.code === 'TOTP_INVALID' ? ' Try again.' : '')); }
    }
    setBusy(false);
  }

  async function resend() {
    await api.post('/auth/resend-verification', { email });
    setResent(true);
  }

  return (
    <div className="login-shell">
      <div className="login-hero">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <LogoMark size={72} />
          <div>
            <Wordmark size={40} />
            <div style={{ fontSize: 11.5, color: '#9fb4e8', letterSpacing: 2.6, marginTop: 4, fontWeight: 600 }}>
              QUALITY · RISK · COMPLIANCE · EXCELLENCE
            </div>
          </div>
        </div>

        <p style={{ color: '#cfe0ff', fontSize: 19, margin: '34px 0 26px', maxWidth: 560 }}>
          One System. Connected Intelligence.{' '}
          <span style={{ color: '#7ed957', fontWeight: 700 }}>Better Decisions.</span>
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, maxWidth: 560, marginBottom: 30 }}>
          {PILLARS.map(([label, path]) => (
            <div key={label} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              border: '1px solid rgba(110,140,220,.35)', borderRadius: 10,
              padding: '7px 12px', fontSize: 11.5, fontWeight: 700, letterSpacing: 1,
              color: '#dbe7ff', background: 'rgba(20,32,80,.45)'
            }}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#7ed957" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>
              {label}
            </div>
          ))}
        </div>

        {[
          'AI-powered insights grounded in live data — never invented',
          'Configurable workflows with human approvals & audit trail',
          'Automated reminders, escalations and expiry tracking',
          'Role-based access for every organizational role'
        ].map(f => (
          <div key={f} className="hero-feature"><span className="hero-check">✓</span>{f}</div>
        ))}
      </div>

      <div className="login-form-side">
        <form className="login-card" onSubmit={submit}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <LogoMark size={38} />
            <Wordmark size={26} light={false} />
          </div>
          <h2 style={{ margin: '0 0 4px' }}>Sign in</h2>
          <p className="muted small mb-4">Use your QMS account credentials.</p>
          {err && (
            <div className="alert danger mb-3">
              {err}
              {unverified && !resent && (
                <div style={{ marginTop: 8 }}>
                  <button type="button" className="btn sm" onClick={resend}>Resend verification email</button>
                </div>
              )}
              {resent && <div className="small mt-2">If the address is valid, a new verification link has been sent.</div>}
            </div>
          )}
          <div className="field mb-3">
            <label>Email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" autoFocus />
          </div>
          <div className="field mb-3">
            <label>Password</label>
            <input value={password} onChange={e => setPassword(e.target.value)} type="password" />
          </div>
          {needTotp && (
            <div className="field mb-3">
              <label>Authenticator code (6 digits, or a backup code)</label>
              <input value={totp} onChange={e => setTotp(e.target.value.replace(/\s/g, '').slice(0, 11))} placeholder="123456" inputMode="numeric" autoFocus style={{ fontSize: 18, letterSpacing: 4 }} />
            </div>
          )}
          <button className="btn primary" style={{ width: '100%', justifyContent: 'center', padding: '11px' }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <div className="demo-creds">
            <b>Demo accounts</b> (click to fill):
            {DEMO.map(([role, em, pw]) => (
              <div key={em} style={{ cursor: 'pointer', marginTop: 3 }} onClick={() => { setEmail(em); setPassword(pw); }}>
                {role}: <b>{em}</b> / {pw}
              </div>
            ))}
          </div>
        </form>
      </div>
    </div>
  );
}
