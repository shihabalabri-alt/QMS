import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Icon, Badge, fmtDateTime, showToast } from '../lib/ui';

const QUICK = [
  'Show me what needs attention',
  'Which risks are getting worse?',
  'Which suppliers have repeated problems?',
  'Which documents need review?',
  'What information is missing?',
  'Prepare a management review summary',
  'Show overdue actions',
  'How are the KPIs trending?'
];

function SectionLabel({ kind, lang }) {
  const map = {
    facts: ['Facts (from live data)', 'sl-facts', 'check'],
    findings: ['Possible findings', 'sl-findings', 'alert'],
    recommendations: ['Recommendations', 'sl-recs', 'action'],
    actions: ['AI action — tap to go', 'sl-recs', 'link'],
    evidence: ['Evidence & citations', 'sl-evidence', 'link']
  };
  const arMap = {
    facts: 'الحقائق (من البيانات الحية)',
    findings: 'ملاحظات محتملة',
    recommendations: 'توصيات',
    actions: 'إجراء — اضغط للانتقال',
    evidence: 'الأدلة والمراجع'
  };
  const [label, cls, icon] = map[kind] || [kind, 'sl-evidence', 'link'];
  return <div className={`ai-section-label ${cls}`}><Icon name={icon} size={12} /> {lang === 'ar' && arMap[kind] ? arMap[kind] : label}</div>;
}

export function AnswerBody({ answer }) {
  const nav = useNavigate();
  const rtl = answer.lang === 'ar';
  return (
    <div dir={rtl ? 'rtl' : 'ltr'}>
      <div className="muted small mb-2" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="code-chip">intent: {answer.intent}</span>
        <span className="code-chip">scope: {answer.scope}</span>
        <button className="icon-btn" style={{ width: 26, height: 26 }} title={rtl ? 'استمع للإجابة' : 'Listen to this answer'} onClick={() => speakText(answer)}><Icon name="volume" size={15} /></button>
      </div>
      {answer.actions?.length > 0 && <><SectionLabel kind="actions" lang={answer.lang} /><ActionButtons actions={answer.actions} /></>}
      {answer.facts.length > 0 && <>
        <SectionLabel kind="facts" lang={answer.lang} />
        <ul className="ai-list">{answer.facts.map((f, i) => <li key={i}>{renderText(f, nav)}</li>)}</ul>
      </>}
      {answer.evidence?.length > 0 && <>
        <SectionLabel kind="evidence" lang={answer.lang} />
        <ul className="ai-list muted small">{answer.evidence.slice(0, 8).map((f, i) => <li key={i}>{typeof f === 'string' ? f : JSON.stringify(f)}</li>)}</ul>
      </>}
      {answer.findings.length > 0 && <>
        <SectionLabel kind="findings" lang={answer.lang} />
        <ul className="ai-list">{answer.findings.map((f, i) => <li key={i}>{renderText(f, nav)}</li>)}</ul>
      </>}
      {answer.recommendations.length > 0 && <>
        <SectionLabel kind="recommendations" lang={answer.lang} />
        <ul className="ai-list">{answer.recommendations.map((f, i) => <li key={i}>{renderText(f, nav)}</li>)}</ul>
      </>}
      {answer.citations.length > 0 && <CitationRow citations={answer.citations} />}
      <div className="muted small mt-3" style={{ borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
        {rtl ? '⚠ استشاري فقط. الحقائق من قاعدة بياناتك الحية. التغييرات تحتاج موافقة بشرية.' : '⚠ Advisory only. Facts come from your authorized live database. Changes require human approval.'}
      </div>
    </div>
  );
}

export function applyClientAction(a) {
  if (!a || a.kind !== 'client') return false;
  if (a.op === 'print') { setTimeout(() => { try { window.print(); } catch {} }, 150); return true; }
  if (a.op === 'theme' && (a.value === 'dark' || a.value === 'light')) {
    document.documentElement.dataset.theme = a.value;
    try { localStorage.setItem('qms-theme', a.value); } catch {}
    return true;
  }
  return false;
}

export function ActionButtons({ actions }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!actions || !actions.length) return null;
  const runApi = async (a) => {
    if (busy) return;
    setBusy(true);
    try {
      if (a.kind === 'api-bulk' && Array.isArray(a.ops)) {
        let ok = 0, fail = 0;
        for (const op of a.ops.slice(0, 10)) {
          try {
            const fn = (op.method === 'PUT' ? api.put : api.post);
            await fn(op.url, op.body || {});
            ok++;
          } catch { fail++; }
        }
        showToast(fail ? `Bulk done: ${ok} changed, ${fail} failed` : `Bulk done: ${ok} changed`, fail ? 'error' : undefined);
        if (a.navigateTo) nav(a.navigateTo);
      } else {
        const d = a.method === 'DELETE' ? await api.del(a.url) : await api.post(a.url, a.body);
        const row = d.row || d;
        showToast(a.doneText || `Created ${row.code || 'record'}`);
        if (row && row.id && a.navigateTo) nav(`${a.navigateTo}/${row.id}`);
        else if (a.navigateTo) nav(a.navigateTo);
      }
    } catch (e) { showToast(e.message, 'error'); }
    setBusy(false);
  };
  return (
    <div className="mb-3" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {actions.map((a, i) => a.kind === 'client'
        ? <button key={i} className={`btn ${a.primary ? 'primary' : ''}`} onClick={() => applyClientAction(a)}><Icon name={a.op === 'print' ? 'printer' : 'send'} size={14} /> {a.label}</button>
        : a.kind === 'api'
        ? <button key={i} className={`btn ${a.primary ? 'primary' : ''}`} disabled={busy} onClick={() => runApi(a)}><Icon name="plus" size={14} /> {busy ? 'Creating…' : a.label}</button>
        : <button key={i} className={`btn ${a.primary ? 'primary' : ''}`} onClick={() => a.link && nav(a.link)}><Icon name="link" size={14} /> {a.label} →</button>
      )}
    </div>
  );
}
/* ---------- Voice: talk instead of typing (free, built into the browser) ---------- */
export function speechSupported() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function useVoiceInput(setInput) {
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);
  useEffect(() => () => { try { recRef.current && recRef.current.abort(); } catch {} }, []);
  const toggle = (lang) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { showToast('Voice input is not supported in this browser — please type instead.', 'error'); return; }
    if (listening) { try { recRef.current && recRef.current.stop(); } catch {} return; }
    try {
      const rec = new SR();
      rec.lang = lang || navigator.language || 'en-US';
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => { let t = ''; for (const r of e.results) t += r[0].transcript; setInput(t); };
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      recRef.current = rec;
      rec.start();
      setListening(true);
    } catch { setListening(false); }
  };
  return [listening, toggle];
}

export function speakText(answer) {
  try {
    if (!('speechSynthesis' in window)) { showToast('Voice output is not supported in this browser.', 'error'); return; }
    const lang = answer && answer.lang === 'ar' ? 'ar-SA' : 'en-US';
    const text = ((answer && answer.facts) || []).join('. ').replace(/[•⚠]/g, '').slice(0, 600);
    if (!text.trim()) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    window.speechSynthesis.speak(u);
  } catch {}
}

export function renderText(text, nav) {
  const parts = String(text).split(/(\b(?:NC|CAPA|INC|RSK|SUP|DOC|POL|ACT|EQ|AUD|KPI|OBJ|ASM|TRN|REC|DR|CR|MR|EMP|CMP)-\d{1,6}\b)/g);
  return parts.map((p, i) => {
    if (/^[A-Z]{2,4}-\d{1,6}$/.test(p)) {
      const route = { NC: 'nonconformances', CAPA: 'nonconformances', INC: 'nonconformances', RSK: 'risks', SUP: 'suppliers', DOC: 'documents', POL: 'policies', AUD: 'audits', EQ: 'equipment', KPI: 'goals', OBJ: 'goals', DR: 'design', CR: 'compliance', MR: 'mgmt-reviews', TRN: 'trainings', REC: 'records', CMP: 'competencies' }[p.split('-')[0]];
      if (!route) return <b key={i}>{p}</b>;
      return <Link key={i} to={`/${route}`} style={{ fontWeight: 700 }}>{p}</Link>;
    }
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}

export function CitationRow({ citations }) {
  const nav = useNavigate();
  return (
    <div className="mt-3">
      <SectionLabel kind="evidence" />
      <div className="chips">
        {citations.slice(0, 14).map((c, i) => (
          <span key={i} className="chip" title={c.title} onClick={() => c.link && nav(c.link)}>
            <Icon name="link" size={11} /> {c.code}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null); // previous answer => follow-ups ("open the second one")
  const [listening, toggleListen] = useVoiceInput(setInput);
  const [params] = useSearchParams();
  const nav = useNavigate();
  const endRef = useRef(null);

  useEffect(() => {
    const q = params.get('q');
    if (q && !open) { setOpen(true); ask(q); nav('/ai'); }
  }, [params]);

  async function ask(question) {
    if (!question.trim() || busy) return;
    setInput('');
    setMsgs(m => [...m, { role: 'user', text: question }]);
    setBusy(true);
    try {
      const d = await api.post('/ai/ask', { question, context: last ? { intent: last.intent, facts: (last.facts || []).slice(0, 8), citations: (last.citations || []).slice(0, 10) } : null });
      setMsgs(m => [...m, { role: 'ai', answer: d.answer }]);
      setLast(d.answer);
      // The AI does things: auto-run its primary action (open page / record / theme).
      try {
        const acts = (d.answer && d.answer.actions) || [];
        for (const a of acts.filter(x => x.auto)) applyClientAction(a);
        const go = acts.find(x => x.auto && x.link);
        if (go) setTimeout(() => nav(go.link), 900);
      } catch {}
    } catch (e) {
      setMsgs(m => [...m, { role: 'ai', error: e.message }]);
    }
    setBusy(false);
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }

  return (
    <>
      {!open && <button className="ai-fab" title="AI Assistant" onClick={() => setOpen(true)}><Icon name="ai" size={24} /></button>}
      {open && (
        <div className="ai-panel">
          <div className="ai-head">
            <div>
              <div style={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="ai" /> QMS AI Brain</div>
              <div className="ai-head-sub">Grounded in your live data · human stays in control</div>
            </div>
            <button className="icon-btn" style={{ color: '#fff' }} onClick={() => setOpen(false)}><Icon name="x" /></button>
          </div>
          <div className="ai-msgs">
            {msgs.length === 0 && (
              <>
                <div className="ai-bubble"><b>Ask me anything about your QMS.</b><br /><span className="muted">I analyze relationships across incidents, risks, suppliers, equipment, documents, actions and reviews — using only real system data, with cited evidence.</span></div>
                <div className="chips">{QUICK.map(q => <span key={q} className="chip" onClick={() => ask(q)}>{q}</span>)}</div>
              </>
            )}
            {msgs.map((m, i) => m.role === 'user'
              ? <div key={i} className="ai-bubble ai-q">{m.text}</div>
              : <div key={i} className="ai-bubble">{m.error ? <span style={{ color: 'var(--danger)' }}>{m.error}</span> : <AnswerBody answer={m.answer} />}</div>
            )}
            {busy && <div className="spinner" style={{ margin: '10px auto' }} />}
            <div ref={endRef} />
          </div>
          <div className="ai-input-bar">
            <input placeholder="e.g. Show everything connected to NC-0005… — or tap 🎤" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && ask(input)} />
            {speechSupported() && <button className={`btn ${listening ? 'danger' : ''}`} title={listening ? 'Stop listening' : 'Talk instead of typing'} onClick={() => toggleListen(last && last.lang === 'ar' ? 'ar-SA' : undefined)}><Icon name="mic" size={15} /></button>}
            <button className="btn primary" disabled={busy || !input.trim()} onClick={() => ask(input)}><Icon name="send" size={15} /></button>
          </div>
        </div>
      )}
    </>
  );
}
