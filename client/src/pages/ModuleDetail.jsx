import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, downloadFile } from '../lib/api';
import { ImpactPanel, PreApprovalCheck } from '../components/ImpactPanel';
import { Icon, Badge, RiskPill, Spinner, EmptyState, Modal, showToast, fmtDate, fmtDateTime, daysBadge } from '../lib/ui';
import { useAuth } from '../App';
import { RecordForm } from './ModuleList';
import { renderText } from '../components/AiAssistant';

const TYPE_TO_ROUTE = {
  NC: 'nonconformances', CAPA: 'nonconformances', INC: 'nonconformances', Risk: 'risks', Supplier: 'suppliers',
  Document: 'documents', Policy: 'policies', Equipment: 'equipment', Audit: 'audits', KPI: 'goals', Objective: 'goals',
  Compliance: 'compliance', Employee: 'employees', Person: null, Action: 'actions', 'Design review': 'design',
  Training: 'trainings', 'Mgmt review': 'mgmt-reviews', Version: null, Evaluation: null, Incident: null,
  Qualification: 'equipment', Finding: null, Requirement: null, Data: null
};

const REL_PRESETS = ['related to', 'caused by', 'controlled by', 'evidence for', 'supports', 'blocks', 'supersedes', 'similar to', 'raised from', 'affects'];

function RelatedInfo({ type, code, selfType, selfId }) {
  const { metaModules, user } = useAuth();
  const [graph, setGraph] = useState(null);
  const [links, setLinks] = useState(null);
  const [adding, setAdding] = useState(false);
  const [linkModule, setLinkModule] = useState('');
  const [linkSearch, setLinkSearch] = useState('');
  const [linkOptions, setLinkOptions] = useState([]);
  const [linkTarget, setLinkTarget] = useState(null);
  const [linkRel, setLinkRel] = useState('related to');

  useEffect(() => { api.get(`/ai/related/${encodeURIComponent(type)}/${code}`).then(setGraph).catch(() => setGraph({ nodes: [] })); }, [type, code]);
  useEffect(() => { api.get(`/links/${selfType}/${selfId}`).then(d => setLinks(d.rows)).catch(() => setLinks([])); }, [selfType, selfId]);

  useEffect(() => {
    if (!linkModule) { setLinkOptions([]); return; }
    const t = setTimeout(() => {
      api.get(`/${linkModule}?limit=25${linkSearch ? `&q=${encodeURIComponent(linkSearch)}` : ''}`)
        .then(d => setLinkOptions(d.rows.filter(r => String(r.id) !== String(selfId))))
        .catch(() => setLinkOptions([]));
    }, 250);
    return () => clearTimeout(t);
  }, [linkModule, linkSearch]);

  async function addLink() {
    if (!linkTarget) return;
    try {
      await api.post('/links', { fromType: selfType, fromId: selfId, toType: linkModule, toId: linkTarget.id, rel: linkRel });
      showToast(`Connected to ${linkTarget.code || linkTarget.title || 'record'}`);
      setLinkTarget(null); setLinkSearch(''); setAdding(false);
      api.get(`/links/${selfType}/${selfId}`).then(d => setLinks(d.rows)).catch(() => {});
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function removeLink(id) {
    try { await api.del(`/links/${id}`); setLinks(ls => ls.filter(l => l.id !== id)); showToast('Connection removed'); }
    catch (e) { showToast(e.message, 'error'); }
  }

  const moduleNames = metaModules ? Object.entries(metaModules).map(([k, m]) => [k, m.title]) : [];

  return (
    <div>
      {/* Manual connections */}
      <div className="mb-3">
        <div className="flex justify-between items-center" style={{ padding: '4px 0' }}>
          <div className="gs-section" style={{ padding: 0 }}>Your connections ({(links || []).length})</div>
          {!adding && <button className="btn sm" onClick={() => setAdding(true)}><Icon name="plus" size={12} /> Connect a record</button>}
        </div>
        {links && links.length === 0 && !adding && <div className="muted small">No manual connections yet — link any record from any module below.</div>}
        {(links || []).map(l => (
          <div key={l.id} className="attention-row">
            <span className="badge" style={{ background: 'var(--primary-soft)', color: 'var(--primary-dark)' }}>{l.direction === 'out' ? '→' : '←'} {l.rel}</span>
            <div style={{ flex: 1 }}>
              <Link to={l.link}><b>{l.code || l.typeLabel}</b> {l.title}</Link>
              <div className="muted small">{l.typeLabel}{l.status ? ` · ${String(l.status).replace(/_/g, ' ')}` : ''} · by {l.created_by_name || 'unknown'}</div>
            </div>
            {l.canDelete && <button className="btn sm ghost" title="Remove connection" onClick={() => removeLink(l.id)}><Icon name="x" size={12} /></button>}
          </div>
        ))}
        {adding && (
          <div className="card card-pad mb-2" style={{ background: 'var(--bg)' }}>
            <div className="flex gap-2 wrap mb-2">
              <select className="input" style={{ maxWidth: 220 }} value={linkModule} onChange={e => { setLinkModule(e.target.value); setLinkTarget(null); }}>
                <option value="">Choose module…</option>
                {moduleNames.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
              </select>
              <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="Search records…" value={linkSearch} onChange={e => setLinkSearch(e.target.value)} disabled={!linkModule} />
            </div>
            {linkModule && (
              <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                {linkOptions.length === 0 && <div className="muted small" style={{ padding: 8 }}>No matches</div>}
                {linkOptions.map(o => (
                  <div key={o.id} className="gs-row" style={{ padding: '6px 10px', background: linkTarget?.id === o.id ? 'var(--primary-soft)' : 'transparent' }}
                    onClick={() => setLinkTarget(o)}>
                    <span className="gs-code">{o.code}</span>
                    <span style={{ flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{o.title || o.name}</span>
                    {o.status && <Badge value={o.status} />}
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 wrap mt-2 items-center">
              <input className="input" style={{ maxWidth: 220 }} list="rel-presets" placeholder="Relationship…" value={linkRel} onChange={e => setLinkRel(e.target.value)} />
              <datalist id="rel-presets">{REL_PRESETS.map(r => <option key={r} value={r} />)}</datalist>
              <button className="btn sm primary" disabled={!linkTarget} onClick={addLink}>Connect</button>
              <button className="btn sm" onClick={() => { setAdding(false); setLinkTarget(null); }}>Cancel</button>
              {linkTarget && <span className="small muted">Linking to <b>{linkTarget.code}</b></span>}
            </div>
          </div>
        )}
      </div>

      {/* Automatic system-detected connections */}
      <div className="gs-section" style={{ padding: '4px 0' }}>System-detected connections</div>
      {!graph || graph.nodes.length <= 1 ? <div className="muted small">No automatic connections found.</div> : (() => {
        const byType = {};
        for (const n of graph.nodes.filter(n => n.rel !== 'query origin')) {
          if (!byType[n.type]) byType[n.type] = [];
          byType[n.type].push(n);
        }
        return Object.entries(byType).map(([t, items]) => (
          <div key={t} className="mb-3">
            <div className="gs-section" style={{ padding: '4px 0' }}>{t}</div>
            {items.map((n, i) => {
              const route = TYPE_TO_ROUTE[n.type];
              const prefix = String(n.code || '').split('-')[0];
              const routeFromCode = route || ({ NC: 'nonconformances', CAPA: 'nonconformances', RSK: 'risks', SUP: 'suppliers', DOC: 'documents', POL: 'policies', AUD: 'audits', EQ: 'equipment', KPI: 'goals', ACT: 'actions', CR: 'compliance', DR: 'design', MR: 'mgmt-reviews' })[prefix];
              return (
                <div key={i} className="attention-row">
                  <Icon name="link" size={13} />
                  <div style={{ flex: 1 }}>
                    {routeFromCode && n.code ? <Link to={`/${routeFromCode}`}><b>{n.code}</b> {String(n.label).replace(n.code, '')}</Link> : <span>{n.label}</span>}
                    <div className="muted small">{n.rel}</div>
                  </div>
                </div>
              );
            })}
          </div>
        ));
      })()}
    </div>
  );
}

export default function ModuleDetail() {
  const { module: moduleKey, id } = useParams();
  const { metaModules, user } = useAuth();
  const nav = useNavigate();
  const apiKeyName = moduleKey.includes('-') ? moduleKey.replace(/-/g, '_') : moduleKey;
  const cfg = metaModules?.[apiKeyName];
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);
  const [transitioning, setTransitioning] = useState(null);
  const [note, setNote] = useState('');
  const [tab, setTab] = useState('related');
  const [comment, setComment] = useState('');
  const [childForms, setChildForms] = useState({});
  const fileInput = useRef(null);
  const [uploadMeta, setUploadMeta] = useState({ category: 'general' });

  async function load() {
    try { setD(await api.get(`/${apiKeyName}/${id}`)); setErr(''); }
    catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, [moduleKey, id]);

  if (!metaModules) return <Spinner />;
  if (!cfg) return <div className="page-wrap"><EmptyState>Unknown module.</EmptyState></div>;
  if (err) return <div className="page-wrap"><div className="alert critical">{err}</div><button className="btn mt-3" onClick={() => nav(-1)}>Go back</button></div>;
  if (!d) return <Spinner />;

  const row = d.row;
  const title = row.title || row.name || row.code;
  const isRisk = moduleKey === 'risks';

  async function doTransition() {
    try {
      await api.post(`/${apiKeyName}/${id}/status`, { status: transitioning, note });
      showToast(`Status changed to ${transitioning}`);
      setTransitioning(null); setNote(''); load();
    } catch (e) { showToast(e.message, 'error'); setTransitioning(null); }
  }

  async function addComment() {
    if (!comment.trim()) return;
    await api.post(`/${apiKeyName}/${id}/comments`, { body: comment });
    setComment(''); load();
  }

  async function uploadFile(file) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('entity_type', apiKeyName);
    fd.append('entity_id', id);
    fd.append('category', uploadMeta.category);
    try { await api.upload('/files/upload', fd); showToast('File attached'); load(); }
    catch (e) { showToast(e.message, 'error'); }
  }

  async function deleteFile(fid) {
    if (!confirm('Delete this file?')) return;
    await api.del(`/files/${fid}`); load();
  }

  async function addChild(colKey, fields) {
    const body = childForms[colKey] || {};
    try {
      const r = await api.post(`/${apiKeyName}/${id}/children/${colKey}`, body);
      showToast(r.madeAction ? `Saved — action ${r.madeAction.code} created for major finding` : 'Entry added');
      setChildForms(f => ({ ...f, [colKey]: {} }));
      load();
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function askAiAboutThis() {
    nav(`/ai?q=${encodeURIComponent(`Summarize ${row.code} and show what needs attention`)}`);
  }

  const kvFields = cfg.fields.filter(f => !['body', 'description'].includes(f.name));
  return (
    <div className="page-wrap">
      <div style={{ marginBottom: 14 }}>
        <button className="btn ghost sm" onClick={() => nav(`/${moduleKey}`)}>← {cfg.title}</button>
      </div>
      <div className="page-head">
        <div>
          <h1 className="page-title"><span className="code-chip">{row.code}</span> {title}</h1>
          <div className="page-sub flex gap-2 items-center wrap">
            <Badge value={row.status} />
            {row.severity && <Badge value={row.severity} />}
            {row.priority && <Badge value={row.priority} />}
            {isRisk && <RiskPill score={row.residual_score} rating={row.residual_rating} />}
            {(moduleKey === 'nonconformances') && row.supplier_name && <span className="muted small">Supplier: <b>{row.supplier_name}</b></span>}
            <button className="btn sm" onClick={async () => {
              try { await downloadFile(`/pdf/record/${apiKeyName}/${id}`, `${row.code}.pdf`); showToast('PDF downloaded'); }
              catch (e) { showToast(e.message, 'error'); }
            }}><Icon name="download" size={13} /> PDF</button>
            {askAiAboutThis && <button className="btn sm" onClick={askAiAboutThis}><Icon name="ai" size={13} /> Ask AI about this record</button>}
          </div>
        </div>
        <div className="flex gap-2">
          {d.perms.update && <button className="btn" onClick={() => setEditing(true)}><Icon name="document" size={15} /> Edit</button>}
          {d.perms.delete && ['closed', 'obsolete', 'archived', 'issued'].includes(row.status) &&
            <button className="btn danger" onClick={async () => { if (confirm('Permanently delete this record? This is audited.')) { await api.del(`/${apiKeyName}/${id}`); nav(`/${moduleKey}`); } }}>Delete</button>}
        </div>
      </div>

          {/* Workflow bar */}
          {d.workflow.transitions.length > 0 && (
            <div className="card card-pad mb-3" style={{ padding: '12px 18px' }}>
              <div className="flex items-center gap-2 wrap">
                <span className="small muted">Workflow:</span>
                <span className="badge b-indigo">{row.status}</span>
                {d.workflow.transitions.map(t => {
                  const needsApprover = ['approved', 'closed', 'issued', 'disqualified'].includes(t);
                  const allowed = !needsApprover || d.workflow.canApprove;
                  return (
                    <button key={t} className={`btn sm ${['approved', 'closed', 'issued'].includes(t) ? 'success' : ''}`}
                      disabled={!allowed}
                      title={allowed ? '' : 'Requires an authorized approver'}
                      onClick={() => setTransitioning(t)}>
                      → {t.replace(/_/g, ' ')}
                    </button>
                  );
                })}
                {d.workflow.closeRequires && <span className="muted small">Closing requires: {d.workflow.closeRequires.join(', ')}</span>}
              </div>
              {/* Pre-approval impact check for controlled changes */}
              {['approved', 'closed', 'issued'].some(t => d.workflow.transitions.includes(t)) && (
                <div className="mt-3">
                  <PreApprovalCheck moduleKey={apiKeyName} recordId={id} />
                </div>
              )}
            </div>
          )}

      <div className="detail-grid">
        <div>
          <div className="card card-pad mb-3">
            <h3 className="card-title">Record details</h3>
            <div className="kv-list">
              {kvFields.map(f => {
                const v = row[f.name + '_name'] ?? row[f.name];
                if (v === null || v === undefined || v === '') return null;
                return (
                  <div className="kv-row" key={f.name}>
                    <span className="kv-key">{f.label}</span>
                    <span className="kv-val">
                      {f.name === 'status' || f.name === 'severity' || f.name === 'priority' ? <Badge value={v} /> :
                        isRisk && f.name.startsWith('residual_') || isRisk && f.name.startsWith('inherent_') ? v :
                        /_date|review_date|expiry_date/.test(f.name) || typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? fmtDate(v) :
                        f.type === 'boolean' ? (v ? 'Yes' : 'No') : String(v)}
                    </span>
                  </div>
                );
              })}
              {isRisk && <>
                <div className="kv-row"><span className="kv-key">Inherent risk</span><span className="kv-val"><RiskPill score={row.inherent_score} rating={row.inherent_rating} /></span></div>
                <div className="kv-row"><span className="kv-key">Residual risk</span><span className="kv-val"><RiskPill score={row.residual_score} rating={row.residual_rating} /></span></div>
              </>}
              {row.due_date && <div className="kv-row"><span className="kv-key">Due</span><span className="kv-val">{fmtDate(row.due_date)} {daysBadge(row.due_date_days)}</span></div>}
              {(cfg.dueField && row[cfg.dueField]) && <div className="kv-row"><span className="kv-key">{cfg.dueField.replace(/_/g, ' ')}</span><span className="kv-val">{fmtDate(row[cfg.dueField])} {daysBadge(row[cfg.dueField + '_days'])}</span></div>}
            </div>
            {(row.description || row.body) && <div className="mt-3 small" style={{ whiteSpace: 'pre-wrap' }}><b>Description</b><br />{row.description || row.body}</div>}
            {row.controls && <div className="mt-3 small" style={{ whiteSpace: 'pre-wrap' }}><b>Controls</b><br />{row.controls}</div>}
            {row.root_cause && <div className="mt-3 alert warning"><div><b>Root cause</b><br />{row.root_cause}</div></div>}
          </div>

          <div className="card card-pad mb-3">
            <h3 className="card-title">Linked actions ({d.actions.length})</h3>
            {d.actions.length === 0 && <div className="muted small">No tracked actions linked to this record.</div>}
            {d.actions.map(a => (
              <Link key={a.id} to={`/actions?focus=${a.id}`} style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
                <div className="attention-row">
                  <span className="code-chip">{a.code}</span>
                  <div style={{ flex: 1 }}><span className="small">{a.title}</span><div className="muted small">due {fmtDate(a.due_date)}</div></div>
                  <Badge value={a.status} /><Badge value={a.priority} />
                </div>
              </Link>
            ))}
          </div>

          <div className="card card-pad">
            <h3 className="card-title">Approval history</h3>
            {d.approvals.length === 0 && <div className="muted small">No workflow transitions recorded yet.</div>}
            {d.approvals.map(ap => (
              <div key={ap.id} className="tl-item">
                <span className="tl-dot" style={{ background: ap.to_state === 'approved' || ap.to_state === 'closed' ? 'var(--success)' : 'var(--info)' }} />
                <div><b>{ap.approver_name}</b> moved <Badge value={ap.from_state} /> → <Badge value={ap.to_state} />
                  {ap.comment && <div className="tl-muted">“{ap.comment}”</div>}</div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="tabs">
            <span className={`tab ${tab === 'related' ? 'active' : ''}`} onClick={() => setTab('related')}><Icon name="link" size={14} /> Related information</span>
            {d.children && Object.keys(d.children).map(k => {
              const cc = cfg.childCollections.find(c => c.key === k);
              return <span key={k} className={`tab ${tab === 'child:' + k ? 'active' : ''}`} onClick={() => setTab('child:' + k)}>{cc?.label || k} ({d.children[k].length})</span>;
            })}
            <span className={`tab ${tab === 'files' ? 'active' : ''}`} onClick={() => setTab('files')}>Files ({d.files.length})</span>
            <span className={`tab ${tab === 'comments' ? 'active' : ''}`} onClick={() => setTab('comments')}>Comments ({d.comments.length})</span>
            <span className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>History</span>
          </div>

          <div className="card card-pad">
            {tab === 'related' && <RelatedInfo type={{ policies: 'Policy', goals: 'KPI', risks: 'Risk', suppliers: 'Supplier', employees: 'Employee', competencies: 'Employee', trainings: 'Training', records: 'Document', documents: 'Document', design: 'Design review', equipment: 'Equipment', nonconformances: row.type === 'capa' ? 'CAPA' : row.type === 'incident' ? 'INC' : 'NC', audits: 'Audit', compliance: 'Compliance', mgmt_reviews: 'Mgmt review' }[apiKeyName] || 'Record'} code={row.code} selfType={apiKeyName} selfId={row.id} />}
            {tab.startsWith('child:') && (() => {
              const k = tab.slice(6);
              const cc = cfg.childCollections.find(c => c.key === k);
              const rows = d.children[k] || [];
              return (
                <div>
                  {!cc.readOnly && (
                    <div className="filter-bar">
                      {cc.fields.map(f => (
                        <input key={f} className="input" style={{ minWidth: 130 }}
                          placeholder={f.replace(/_/g, ' ').replace('_id', '')}
                          type={/date/.test(f) ? 'date' : /score|level|hours|value/.test(f) ? 'number' : 'text'}
                          value={(childForms[k] || {})[f] ?? ''}
                          onChange={e => setChildForms(cf => ({ ...cf, [k]: { ...(cf[k] || {}), [f]: e.target.value } }))} />
                      ))}
                      <button className="btn sm primary" onClick={() => addChild(k, cc.fields)}><Icon name="plus" size={13} /> Add</button>
                    </div>
                  )}
                  {rows.length === 0 ? <EmptyState>No entries yet.</EmptyState> : (
                    <table className="data">
                      <thead><tr>{Object.keys(rows[0]).filter(x => !['id', k.endsWith('_id') ? k : '__'].includes(x) && !x.endsWith('_id')).slice(0, 8).map(h => <th key={h}>{h.replace(/_/g, ' ')}</th>)}</tr></thead>
                      <tbody>
                        {rows.map((r2, i) => (
                          <tr key={i}>
                            {Object.keys(rows[0]).filter(x => !x.endsWith('_id') && x !== 'id').slice(0, 8).map(h => (
                              <td key={h}>{typeof r2[h] === 'string' && /^\d{4}-\d{2}-\d{2}/.test(r2[h]) ? fmtDate(r2[h]) : h === 'status' ? <Badge value={r2[h]} /> : (r2[h] ?? '—')}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })()}
            {tab === 'files' && (
              <div>
                <div className="flex gap-2 items-center mb-3 wrap">
                  <select className="input" style={{ width: 160 }} value={uploadMeta.category} onChange={e => setUploadMeta(m => ({ ...m, category: e.target.value }))}>
                    {['evidence', 'report', 'certificate', 'drawing', 'photo', 'agreement', 'general'].map(o => <option key={o}>{o}</option>)}
                  </select>
                  <button className="btn primary sm" onClick={() => fileInput.current.click()}><Icon name="plus" size={13} /> Attach file</button>
                  <input ref={fileInput} type="file" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) uploadFile(e.target.files[0]); e.target.value = ''; }} />
                </div>
                {d.files.length === 0 ? <EmptyState>No files attached.</EmptyState> : (
                  <table className="data">
                    <thead><tr><th>Name</th><th>Category</th><th>Size</th><th>Uploaded</th><th></th></tr></thead>
                    <tbody>
                      {d.files.map(f => (
                        <tr key={f.id}>
                          <td>{f.original_name}</td>
                          <td><Badge value={f.category} /></td>
                          <td className="mono">{Math.round((f.size || 0) / 1024)} KB</td>
                          <td>{fmtDateTime(f.created_at)}<div className="muted small">{f.uploaded_by_name}</div></td>
                          <td>
                            <a className="btn sm" href={`/api/files/${f.id}/download`}>Download</a>
                            {['admin', 'quality_manager'].includes(user.role) && <button className="btn sm danger" onClick={() => deleteFile(f.id)}>Delete</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
            {tab === 'comments' && (
              <div>
                <div className="flex gap-2 mb-3">
                  <input className="input" style={{ flex: 1 }} placeholder="Add a comment…" value={comment} onChange={e => setComment(e.target.value)} onKeyDown={e => e.key === 'Enter' && addComment()} />
                  <button className="btn primary" onClick={addComment}>Post</button>
                </div>
                {d.comments.length === 0 && <EmptyState>No comments yet.</EmptyState>}
                {d.comments.map(cm => (
                  <div key={cm.id} className="alert info" style={{ marginBottom: 10, alignItems: 'flex-start' }}>
                    <div>
                      <b>{cm.user_name || cm.user_id}</b> <span className="muted small">{fmtDateTime(cm.created_at)}</span>
                      <div>{cm.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {tab === 'history' && (
              <div className="timeline">
                {d.history.length === 0 && <EmptyState>No history yet.</EmptyState>}
                {d.history.map(h => (
                  <div key={h.id} className="tl-item">
                    <span className="tl-dot" style={{ background: h.action.includes('delete') ? 'var(--danger)' : h.action.startsWith('status') ? 'var(--info)' : 'var(--primary)' }} />
                    <div>
                      <b>{h.user_name || 'System'}</b> <span className="badge b-gray">{h.action.replace(/_/g, ' ')}</span>
                      {h.details && <div className="mono muted small" style={{ marginTop: 3, wordBreak: 'break-all' }}>{String(h.details).slice(0, 220)}</div>}
                      <div className="tl-muted">{fmtDateTime(h.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {editing && (
        <Modal wide title={`Edit ${row.code}`} onClose={() => setEditing(false)}>
          <RecordForm moduleKey={apiKeyName} cfg={cfg} initial={row} onCancel={() => setEditing(false)}
            onSaved={() => { setEditing(false); load(); }} />
        </Modal>
      )}
      {transitioning && (
        <Modal title={`Move to "${transitioning.replace(/_/g, ' ')}"`} onClose={() => setTransitioning(null)}
          footer={<>
            <button className="btn" onClick={() => setTransitioning(null)}>Cancel</button>
            <button className="btn primary" onClick={doTransition}>Confirm transition</button>
          </>}>
          {['approved', 'closed', 'issued'].includes(transitioning)
            ? <div className="alert success">You are performing a formal approval. Your name, decision and note will be permanently recorded in the audit trail.</div>
            : <div className="alert info">This transition will be recorded in the audit trail with your identity.</div>}
          <div className="field mt-3">
            <label>Note / rationale (recommended)</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Why is this transition being made?" />
          </div>
        </Modal>
      )}
    </div>
  );
}
