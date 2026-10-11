import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Icon, Badge, fmtDateTime } from '../lib/ui';

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

function SectionLabel({ kind }) {
  const map = {
    facts: ['Facts (from live data)', 'sl-facts', 'check'],
    findings: ['Possible findings', 'sl-findings', 'alert'],
    recommendations: ['Recommendations', 'sl-recs', 'action'],
    actions: ['AI action — tap to go', 'sl-recs', 'link'],
    evidence: ['Evidence & citations', 'sl-evidence', 'link']
  };
  const [label, cls, icon] = map[kind] || [kind, 'sl-evidence', 'link'];
  return <div className={`ai-section-label ${cls}`}><Icon name={icon} size={12} /> {label}</div>;
}

export function AnswerBody({ answer }) {
  const nav = useNavigate();
  return (
    <div>
      <div className="muted small mb-2" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <span className="code-chip">intent: {answer.intent}</span>
        <span className="code-chip">scope: {answer.scope}</span>
      </div>
      {answer.actions?.length > 0 && <><SectionLabel kind="actions" /><ActionButtons actions={answer.actions} /></>}
      {answer.facts.length > 0 && <>
        <SectionLabel kind="facts" />
        <ul className="ai-list">{answer.facts.map((f, i) => <li key={i}>{renderText(f, nav)}</li>)}</ul>
      </>}
      {answer.evidence?.length > 0 && <>
        <SectionLabel kind="evidence" />
        <ul className="ai-list muted small">{answer.evidence.slice(0, 8).map((f, i) => <li key={i}>{typeof f === 'string' ? f : JSON.stringify(f)}</li>)}</ul>
      </>}
      {answer.findings.length > 0 && <>
        <SectionLabel kind="findings" />
        <ul className="ai-list">{answer.findings.map((f, i) => <li key={i}>{renderText(f, nav)}</li>)}</ul>
      </>}
      {answer.recommendations.length > 0 && <>
        <SectionLabel kind="recommendations" />
        <ul className="ai-list">{answer.recommendations.map((f, i) => <li key={i}>{renderText(f, nav)}</li>)}</ul>
      </>}
      {answer.citations.length > 0 && <CitationRow citations={answer.citations} />}
      <div className="muted small mt-3" style={{ borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
        ⚠ Advisory only. Facts come from your authorized live database. Changes require human approval.
      </div>
    </div>
  );
}

export function applyClientAction(a) {
  if (!a || a.kind !== 'client') return false;
  if (a.op === 'theme' && (a.value === 'dark' || a.value === 'light')) {
    document.documentElement.dataset.theme = a.value;
    try { localStorage.setItem('qms-theme', a.value); } catch {}
    return true;
  }
  return false;
}

export function ActionButtons({ actions }) {
  const nav = useNavigate();
  if (!actions || !actions.length) return null;
  return (
    <div className="mb-3" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {actions.map((a, i) => a.kind === 'client'
        ? <button key={i} className={`btn ${a.primary ? 'primary' : ''}`} onClick={() => applyClientAction(a)}><Icon name="send" size={14} /> {a.label}</button>
        : <button key={i} className={`btn ${a.primary ? 'primary' : ''}`} onClick={() => a.link && nav(a.link)}><Icon name="link" size={14} /> {a.label} →</button>
      )}
    </div>
  );
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
      const d = await api.post('/ai/ask', { question });
      setMsgs(m => [...m, { role: 'ai', answer: d.answer }]);
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
            <input placeholder="e.g. Show everything connected to NC-0005…" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && ask(input)} />
            <button className="btn primary" disabled={busy || !input.trim()} onClick={() => ask(input)}><Icon name="send" size={15} /></button>
          </div>
        </div>
      )}
    </>
  );
}
