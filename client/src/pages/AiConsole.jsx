import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Icon, Spinner, Badge, Modal, showToast } from '../lib/ui';
import { AnswerBody, applyClientAction, speechSupported, useVoiceInput } from '../components/AiAssistant';

const QUICK = [
  'Brief me',
  'Watch RSK-0001',
  'What needs my signature?',
  'Open documents on Quality Manual',
  'Take me to the risk register',
  'Create an action to call the supplier',
  'Show me what needs attention',
  'Escalate all overdue actions',
  'Are we better than last month?',
  'Are we ready for an audit?',
  'What changed this week?',
  'Who is overloaded?',
  'What is at risk of slipping?',
  'What if EQ-0007 fails?',
  'Why does this keep happening?',
  'Prep me for the management review',
  'Who is not qualified?',
  'Turn on dark mode'
];

export default function AiConsole() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState(params.get('q') || '');
  const [busy, setBusy] = useState(false);
  const [insights, setInsights] = useState(null);
  const [last, setLast] = useState(null); // previous answer => follow-ups ("open the second one")
  const [thinking, setThinking] = useState(''); // visible deep-think for big messages
  const [listening, toggleListen] = useVoiceInput(setInput);

  const THINK_STEPS = ['Reading your request…', 'Breaking it into jobs…', 'Checking the live data…', 'Writing the answer…'];

  const ask = async (question) => {
    if (!question.trim() || busy) return;
    setInput('');
    setMsgs(m => [...m, { role: 'user', text: question }]);
    setBusy(true);
    const timers = [];
    if (question.trim().length > 140) {
      THINK_STEPS.forEach((step, i) => timers.push(setTimeout(() => setThinking(step), 500 * (i + 1))));
    }
    try {
      const d = await api.post('/ai/ask', { question, context: last ? { intent: last.intent, facts: (last.facts || []).slice(0, 8), citations: (last.citations || []).slice(0, 10) } : null });
      setMsgs(m => [...m, { role: 'ai', answer: d.answer }]);
      setLast(d.answer);
      // The AI does things: auto-run its primary action (open page / record / theme).
      try {
        const acts = (d.answer && d.answer.actions) || [];
        for (const a of acts.filter(x => x.auto)) applyClientAction(a);
        const go = acts.find(x => x.auto && x.link);
        if (go) { showToast('Opening: ' + (go.label || go.link)); setTimeout(() => nav(go.link), 900); }
      } catch {}
    } catch (e) { setMsgs(m => [...m, { role: 'ai', error: e.message }]); }
    timers.forEach(clearTimeout);
    setThinking('');
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
      {busy && (thinking
        ? <div className="card card-pad mb-3"><div className="ai-thinking"><span className="ai-thinking-dot" />{thinking}</div></div>
        : <Spinner />)}

      <div className="flex gap-2 mt-3" style={{ position: 'sticky', bottom: 10 }}>
        <input className="input" style={{ flex: 1, padding: 13 }} placeholder="e.g. Show everything connected to RSK-0001 · Summarize SUP-0004 — or tap 🎤 and talk"
          value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && ask(input)} />
        {speechSupported() && <button className={`btn ${listening ? 'danger' : ''}`} style={{ padding: '0 14px' }} title={listening ? 'Stop listening' : 'Talk instead of typing'} onClick={() => toggleListen(last && last.lang === 'ar' ? 'ar-SA' : undefined)}><Icon name="mic" /></button>}
        <button className="btn primary" style={{ padding: '0 22px' }} disabled={busy} onClick={() => ask(input)}><Icon name="send" /></button>
      </div>
    </div>
  );
}
