import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Icon, Spinner, Badge, Modal, showToast } from '../lib/ui';
import { AnswerBody, applyClientAction } from '../components/AiAssistant';

const QUICK = [
  'Open documents on Quality Manual',
  'Take me to the risk register',
  'Create an action to call the supplier',
  'Show me what needs attention',
  'Which risks are getting worse?',
  'Which documents need review?',
  'Turn on dark mode'
];

export default function AiConsole() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState(params.get('q') || '');
  const [busy, setBusy] = useState(false);
  const [insights, setInsights] = useState(null);

  const ask = async (question) => {
    if (!question.trim() || busy) return;
    setInput('');
    setMsgs(m => [...m, { role: 'user', text: question }]);
    setBusy(true);
    try {
      const d = await api.post('/ai/ask', { question });
      setMsgs(m => [...m, { role: 'ai', answer: d.answer }]);
      // The AI does things: auto-run its primary action (open page / record / theme).
      try {
        const acts = (d.answer && d.answer.actions) || [];
        for (const a of acts.filter(x => x.auto)) applyClientAction(a);
        const go = acts.find(x => x.auto && x.link);
        if (go) { showToast('Opening: ' + (go.label || go.link)); setTimeout(() => nav(go.link), 900); }
      } catch {}
    } catch (e) { setMsgs(m => [...m, { role: 'ai', error: e.message }]); }
    setBusy(false);
  };

  useEffect(() => {
    api.get('/ai/insights').then(d => setInsights(d.insights)).catch(() => {});
    if (params.get('q')) ask(params.get('q'));
  }, []);

  return (
    <div className="page-wrap">
      <div className="page-head">
        <div>
          <h1 className="page-title"><Icon name="ai" /> AI Assistant</h1>
          <div className="page-sub">Understands relationships across all modules. Grounded in live authorized data — facts are cited, never invented.</div>
        </div>
      </div>

      {insights && (
        <div className="card card-pad mb-3">
          <h3 className="card-title">Proactive insights — latest scan</h3>
          <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
            {insights.map((ins, i) => (
              <div key={i} className={`alert ${ins.severity}`}>
                <Icon name={ins.severity === 'critical' ? 'alert' : 'risk'} size={16} />
                <div><b>{ins.title}</b><div className="small">{ins.body}</div></div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="chips">{QUICK.map(q => <span key={q} className="chip" onClick={() => ask(q)}>{q}</span>)}</div>

      {msgs.length === 0 && !busy && <div className="card card-pad"><div className="empty-state">Ask a question above to see the AI Brain in action.</div></div>}
      {msgs.map((m, i) => (
        m.role === 'user'
          ? <div key={i} className="alert info mb-3" style={{ background: 'var(--primary-soft)', borderColor: '#c7d2fe', color: 'var(--primary-dark)' }}><b>You:</b> {m.text}</div>
          : <div key={i} className="card card-pad mb-3">{m.error ? <span style={{ color: 'var(--danger)' }}>{m.error}</span> : <AnswerBody answer={m.answer} />}</div>
      ))}
      {busy && <Spinner />}

      <div className="flex gap-2 mt-3" style={{ position: 'sticky', bottom: 10 }}>
        <input className="input" style={{ flex: 1, padding: 13 }} placeholder="e.g. Show everything connected to RSK-0001 · Summarize SUP-0004"
          value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && ask(input)} />
        <button className="btn primary" style={{ padding: '0 22px' }} disabled={busy} onClick={() => ask(input)}><Icon name="send" /></button>
      </div>
    </div>
  );
}
