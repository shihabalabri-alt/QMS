import React, { useEffect, useState } from 'react';
import { api, setToken } from '../lib/api';
import { Icon, Spinner, showToast } from '../lib/ui';
import { useAuth } from '../App';

export default function SecurityPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState(null);
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState(null);
  const [disablePw, setDisablePw] = useState('');
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/auth/2fa/status').then(setStatus).catch(() => {});
  useEffect(() => { load(); }, []);

  async function startSetup() {
    setErr(''); setBusy(true);
    try { setSetup(await api.post('/auth/2fa/setup')); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function confirmEnable() {
    setErr(''); setBusy(true);
    try {
      const r = await api.post('/auth/2fa/enable', { code: code.trim() });
      setBackupCodes(r.backupCodes);
      setSetup(null); setCode('');
      showToast('Two-factor authentication enabled');
      load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function disable2fa() {
    setErr(''); setBusy(true);
    try {
      await api.post('/auth/2fa/disable', { password: disablePw });
      setDisablePw('');
      showToast('Two-factor authentication disabled');
      load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function changePassword() {
    setErr(''); setBusy(true);
    try {
      if (!pw.next || pw.next !== pw.confirm) throw new Error('New passwords do not match');
      const r = await api.post('/auth/change-password', { current: pw.current, next: pw.next });
      if (r.token) setToken(r.token);
      setPw({ current: '', next: '', confirm: '' });
      showToast('Password changed — other sessions signed out');
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  if (!status) return <Spinner />;

  return (
    <div className="page-wrap" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title"><Icon name="settings" /> My Security</h1>
          <div className="page-sub">Protect your account with two-factor authentication and a strong password.</div>
        </div>
      </div>
      {err && <div className="alert critical mb-3">{err}</div>}

      {/* Two-factor */}
      <div className="card card-pad mb-3">
        <div className="flex justify-between items-center mb-2">
          <h3 className="card-title" style={{ margin: 0 }}>Two-factor authentication (TOTP)</h3>
          {status.enabled ? <span className="badge b-green">enabled</span> : <span className="badge b-amber">not enabled</span>}
        </div>

        {!status.enabled && !setup && (
          <>
            <p className="muted small">Add a second layer of protection: after entering your password you will also need a rotating 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…).</p>
            <button className="btn primary sm" onClick={startSetup} disabled={busy}><Icon name="check" size={14} /> Set up 2FA</button>
          </>
        )}

        {setup && !backupCodes && (
          <div>
            <ol className="small" style={{ paddingLeft: 18 }}>
              <li>Open your authenticator app and choose <b>"Enter a setup key"</b>.</li>
              <li>Paste this secret key:</li>
            </ol>
            <code className="mono" style={{ display: 'block', background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, wordBreak: 'break-all', fontSize: 15, letterSpacing: 1 }}>{setup.secret}</code>
            <div className="muted small mt-2" style={{ wordBreak: 'break-all' }}>Or use this URI in apps that accept it: {setup.uri}</div>
            <div className="field mt-3" style={{ maxWidth: 240 }}>
              <label>Enter the current 6-digit code</label>
              <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" inputMode="numeric" style={{ fontSize: 20, letterSpacing: 6 }} />
            </div>
            <div className="flex gap-2 mt-3">
              <button className="btn primary sm" onClick={confirmEnable} disabled={busy || code.length !== 6}>Verify & enable</button>
              <button className="btn sm" onClick={() => { setSetup(null); setCode(''); }}>Cancel</button>
            </div>
          </div>
        )}

        {backupCodes && (
          <div>
            <div className="alert warning mb-2"><b>Save these backup codes now!</b> Each works exactly once if you lose access to your authenticator. They are shown only this once.</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {backupCodes.map(c => <code key={c} className="mono" style={{ background: 'var(--bg)', padding: '7px 10px', borderRadius: 8 }}>{c}</code>)}
            </div>
            <button className="btn sm mt-3" onClick={() => { navigator.clipboard.writeText(backupCodes.join('\n')); showToast('Backup codes copied'); }}>Copy all codes</button>
          </div>
        )}

        {status.enabled && !backupCodes && (
          <div>
            <p className="muted small">Your account requires a 6-digit authenticator code at every sign-in. Lost device? Use one of your backup codes, or contact an administrator.</p>
            <input type="password" className="input mb-2" style={{ maxWidth: 280 }} placeholder="Confirm your password to disable"
              value={disablePw} onChange={e => setDisablePw(e.target.value)} />
            <button className="btn danger sm" disabled={!disablePw || busy} onClick={disable2fa}>Disable 2FA</button>
          </div>
        )}
      </div>

      {/* Password */}
      <div className="card card-pad">
        <h3 className="card-title">Change password</h3>
        <div className="form-grid">
          <div className="field"><label>Current password</label><input type="password" value={pw.current} onChange={e => setPw(p => ({ ...p, current: e.target.value }))} /></div>
          <div />
          <div className="field"><label>New password (8+ chars, upper & lower case + number)</label><input type="password" value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} /></div>
          <div className="field"><label>Confirm new password</label><input type="password" value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} /></div>
        </div>
        <button className="btn primary sm mt-3" disabled={busy || !pw.current || !pw.next} onClick={changePassword}>Change password</button>
        <div className="muted small mt-2">Changing your password signs out all other devices instantly.</div>
      </div>
    </div>
  );
}
