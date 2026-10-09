import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { LogoMark } from '../components/Logo';

export default function VerifyEmail() {
  const { token } = useParams();
  const [state, setState] = useState('verifying'); // verifying | ok | error
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch(`/api/auth/verify-email/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setState('ok'); setMsg(d.message || 'Email verified'); }
        else { setState('error'); setMsg(d.error || 'Verification failed'); }
      })
      .catch(() => { setState('error'); setMsg('Network error — please try again.'); });
  }, [token]);

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)', padding: 20 }}>
      <div className="card card-pad" style={{ maxWidth: 440, textAlign: 'center' }}>
        <div style={{ display: 'grid', placeItems: 'center', marginBottom: 12 }}><LogoMark size={54} /></div>
        {state === 'verifying' && <>
          <div className="spinner" />
          <h2>Verifying your email…</h2>
        </>}
        {state === 'ok' && <>
          <div className="alert success mb-3" style={{ justifyContent: 'center' }}>✓ Email verified</div>
          <h2 style={{ marginTop: 0 }}>{msg}</h2>
          <Link to="/" className="btn primary mt-3" style={{ display: 'inline-block' }}>Go to sign in</Link>
        </>}
        {state === 'error' && <>
          <div className="alert critical mb-3">✗ Verification failed</div>
          <p>{msg}</p>
          <p className="muted small">Ask your administrator to send a new verification link from Administration → Users.</p>
          <Link to="/" className="btn mt-3" style={{ display: 'inline-block' }}>Back to sign in</Link>
        </>}
      </div>
    </div>
  );
}
