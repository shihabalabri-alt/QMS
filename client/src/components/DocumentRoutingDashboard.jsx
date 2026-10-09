import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Icon, Badge, Spinner, EmptyState, showToast, fmtDate } from '../lib/ui';

export function DocumentRoutingDashboard() {
  const [dashboard, setDashboard] = useState(null);
  const [executions, setExecutions] = useState({ rows: [], total: 0 });
  const [rules, setRules] = useState([]);
  const [escalationRules, setEscalationRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [execStatus, setExecStatus] = useState('');
  const [selectedExec, setSelectedExec] = useState(null);
  const [execAudit, setExecAudit] = useState(null);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState(null);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [d, e, r, er] = await Promise.all([
        api.get('/routing/dashboard'),
        api.get('/routing/executions?limit=50'),
        api.get('/routing/rules'),
        api.get('/routing/escalation-rules')
      ]);
      setDashboard(d);
      setExecutions(e);
      setRules(r.rows);
      setEscalationRules(er.rows);
    } catch (err) {
      showToast(err.message, 'error');
    }
    setLoading(false);
  }

  async function seedDefaults() {
    try {
      await api.post('/routing/rules/seed-defaults');
      showToast('Default routing rules seeded');
      loadAll();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function checkEscalation() {
    try {
      const res = await api.post('/routing/escalation/check');
      showToast(`Checked ${res.checked} executions, escalated ${res.escalated}`);
      loadAll();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function viewExecution(id) {
    try {
      const [exec, audit] = await Promise.all([
        api.get(`/routing/executions/${id}`),
        api.get(`/routing/audit/${id}`)
      ]);
      setSelectedExec(exec);
      setExecAudit(audit.rows);
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function advanceExecution(execId, action, note) {
    try {
      await api.post(`/routing/executions/${execId}/advance`, { action, note });
      showToast('Execution advanced');
      loadAll();
      if (selectedExec?.execution?.id === execId) viewExecution(execId);
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <div className="page-wrap">
      <div className="page-head">
        <div>
          <h1 className="page-title"><Icon name="arrow-right" /> Document Routing Dashboard</h1>
          <div className="page-sub">Monitor document routing workflows, escalations & audit trails</div>
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={checkEscalation}><Icon name="refresh" size={14} /> Check Escalations</button>
          <button className="btn primary" onClick={seedDefaults}><Icon name="database" size={14} /> Seed Default Rules</button>
          <button className="btn" onClick={() => { setEditingRule(null); setShowRuleModal(true); }}><Icon name="plus" size={14} /> New Routing Rule</button>
        </div>
      </div>

      {loading ? <Spinner /> : (
        <>
          <div className="card-grid" style={{ marginBottom: 20 }}>
            <div className="card stat-card">
              <div className="stat-icon" style={{ background: 'var(--info)' }}><Icon name="activity" size={20} /></div>
              <div className="stat-value" style={{ color: 'var(--info)' }}>{dashboard?.activeExecutions || 0}</div>
              <div className="stat-label">Active Executions</div>
            </div>
            <div className="card stat-card">
              <div className="stat-icon" style={{ background: 'var(--success)' }}><Icon name="check" size={20} /></div>
              <div className="stat-value" style={{ color: 'var(--success)' }}>{dashboard?.completedToday || 0}</div>
              <div className="stat-label">Completed Today</div>
            </div>
            <div className="card stat-card stat-alert">
              <div className="stat-icon" style={{ background: 'var(--warning)' }}><Icon name="alert" size={20} /></div>
              <div className="stat-value" style={{ color: 'var(--warning)' }}>{dashboard?.overdue || 0}</div>
              <div className="stat-label">Overdue</div>
            </div>
            <div className="card stat-card stat-alert">
              <div className="stat-icon" style={{ background: 'var(--danger)' }}><Icon name="arrow-up" size={20} /></div>
              <div className="stat-value" style={{ color: 'var(--danger)' }}>{dashboard?.escalated || 0}</div>
              <div className="stat-label">Escalated</div>
            </div>
            <div className="card stat-card">
              <div className="stat-icon" style={{ background: 'var(--primary)' }}><Icon name="timer" size={20} /></div>
              <div className="stat-value" style={{ color: 'var(--primary)' }}>{Math.round(dashboard?.avgCycleTime || 0)}</div>
              <div className="stat-label">Avg Cycle (days)</div>
            </div>
          </div>

          <div className="card-grid" style={{ marginBottom: 20 }}>
            <div className="card card-pad span-2">
              <div className="card-title">Active by Step</div>
              <div className="flex gap-2 wrap" style={{ marginTop: 12 }}>
                {(dashboard?.byStep || []).map(s => (
                  <div key={s.current_step} className="stage-pill" style={{ background: 'var(--info-soft)', borderColor: 'var(--info)' }}>
                    <span className="stage-name">Step {s.current_step}</span>
                    <span className="stage-count">{s.c}</span>
                  </div>
                ))}
                {(dashboard?.byStep || []).length === 0 && <span className="muted small">No active executions</span>}
              </div>
            </div>

            <div className="card card-pad">
              <div className="card-title">By Routing Rule</div>
              <div className="flex flex-col gap-2" style={{ marginTop: 12 }}>
                {(dashboard?.byRule || []).map(r => (
                  <div key={r.rule_name} className="flex justify-between">
                    <span className="small">{r.rule_name}</span>
                    <Badge value={r.c}>{r.c}</Badge>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card card-pad" style={{ marginBottom: 20 }}>
            <div className="flex justify-between items-center mb-3">
              <div className="card-title">Active Routing Executions</div>
              <select className="input" style={{ width: 180 }} value={execStatus} onChange={e => setExecStatus(e.target.value)}>
                <option value="">All statuses</option>
                <option value="in_progress">In Progress</option>
                <option value="on_hold">On Hold</option>
                <option value="escalated">Escalated</option>
                <option value="completed">Completed</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
            {executions.rows.length === 0 ? (
              <EmptyState>No routing executions found.</EmptyState>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Execution</th>
                    <th>Document</th>
                    <th>Rule</th>
                    <th>Step</th>
                    <th>Status</th>
                    <th>Assigned To</th>
                    <th>Due</th>
                    <th>Escalation</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {executions.rows.map(e => (
                    <tr key={e.id}>
                      <td className="code-chip">{e.id}</td>
                      <td>
                        <div className="code-chip">{e.document_code}</div>
                        <div className="small muted">{e.doc_title}</div>
                      </td>
                      <td className="small">{e.rule_name}</td>
                      <td className="mono">Step {e.current_step}</td>
                      <td><Badge value={e.status} /></td>
                      <td className="small">{e.assigned_to || '—'}</td>
                      <td className="small">{e.due_at ? fmtDate(e.due_at) : '—'}</td>
                      <td>
                        {e.escalated && <Badge value={`Level ${e.escalation_level}`} />}
                        {!e.escalated && <span className="muted small">—</span>}
                      </td>
                      <td>
                        <button className="btn sm" onClick={() => viewExecution(e.id)}>View</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card card-pad">
            <div className="card-title">Routing Rules ({rules.length})</div>
            {rules.length === 0 ? (
              <EmptyState>No routing rules defined. Click "Seed Default Rules" to create standard rules.</EmptyState>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Department</th>
                    <th>Trigger</th>
                    <th>Steps</th>
                    <th>Active</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map(r => (
                    <tr key={r.id}>
                      <td><b>{r.name}</b></td>
                      <td>{r.document_category || 'All'}</td>
                      <td>{r.department || 'All'}</td>
                      <td className="small">{r.trigger_event}</td>
                      <td className="mono">{r.steps?.length || 0} steps</td>
                      <td><Badge value={r.active ? 'Active' : 'Inactive'} /></td>
                      <td>
                        <button className="btn sm" onClick={() => { setEditingRule(r); setShowRuleModal(true); }}>Edit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card card-pad">
            <div className="card-title">Escalation Rules ({escalationRules.length})</div>
            {escalationRules.length === 0 ? (
              <EmptyState>No escalation rules defined.</EmptyState>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Trigger After (days)</th>
                    <th>Levels</th>
                    <th>Notify Roles</th>
                    <th>Active</th>
                  </tr>
                </thead>
                <tbody>
                  {escalationRules.map(r => (
                    <tr key={r.id}>
                      <td><b>{r.name}</b></td>
                      <td className="mono">{r.trigger_after_days}</td>
                      <td className="small">{r.escalation_levels?.join(', ') || '—'}</td>
                      <td className="small">{r.notify_roles?.join(', ') || '—'}</td>
                      <td><Badge value={r.active ? 'Active' : 'Inactive'} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {selectedExec && (
        <div className="modal-overlay" onClick={() => { setSelectedExec(null); setExecAudit(null); }}>
          <div className="modal wide" style={{ maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <h2>Execution #{selectedExec.execution.id} · {selectedExec.execution.document_code}</h2>
              <button className="btn ghost" onClick={() => { setSelectedExec(null); setExecAudit(null); }}><Icon name="x" size={16} /></button>
            </div>
            <div className="card card-pad mb-3" style={{ background: 'var(--bg)' }}>
              <div className="flex gap-4 wrap">
                <div><b>Rule:</b> {selectedExec.rule?.name}</div>
                <div><b>Status:</b> <Badge value={selectedExec.execution.status} /></div>
                <div><b>Current Step:</b> {selectedExec.execution.current_step}</div>
                <div><b>Assigned:</b> {selectedExec.execution.assigned_to || '—'}</div>
                <div><b>Due:</b> {selectedExec.execution.due_at ? fmtDate(selectedExec.execution.due_at) : '—'}</div>
                <div><b>Escalation:</b> {selectedExec.execution.escalated ? `Level ${selectedExec.execution.escalation_level}` : 'None'}</div>
              </div>
            </div>
            {selectedExec.rule?.steps && (
              <div className="card card-pad mb-3">
                <div className="card-title">Routing Steps</div>
                <table className="data">
                  <thead><tr><th>Step</th><th>Name</th><th>Role</th><th>Days</th><th>Required</th></tr></thead>
                  <tbody>
                    {selectedExec.rule.steps.map((s, i) => (
                      <tr key={i} style={{ background: i < selectedExec.execution.current_step ? 'var(--success-soft)' : i === selectedExec.execution.current_step ? 'var(--info-soft)' : '' }}>
                        <td>{s.step}</td>
                        <td>{s.name}</td>
                        <td>{s.role}{s.department ? ` (${s.department})` : ''}</td>
                        <td className="mono">{s.days}</td>
                        <td>{s.required ? 'Yes' : 'No'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="card card-pad mb-3">
              <div className="card-title">Audit Trail ({execAudit?.length || 0})</div>
              {execAudit && execAudit.length > 0 ? (
                <table className="data">
                  <thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>From → To</th><th>Details</th></tr></thead>
                  <tbody>
                    {execAudit.map((a, i) => (
                      <tr key={i}>
                        <td className="small">{fmtDate(a.timestamp)}</td>
                        <td><Badge value={a.action} /></td>
                        <td>{a.actor_name || 'System'}</td>
                        <td>{a.from_step} → {a.to_step}</td>
                        <td className="mono small">{a.details ? String(a.details).slice(0, 100) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <EmptyState>No audit entries.</EmptyState>}
            </div>
            {selectedExec.execution.status === 'in_progress' && (
              <div className="flex gap-2 justify-end">
                <button className="btn danger" onClick={() => advanceExecution(selectedExec.execution.id, 'reject', prompt('Rejection reason:') || '')}>Reject</button>
                <button className="btn" onClick={() => advanceExecution(selectedExec.execution.id, 'hold', prompt('Hold reason:') || '')}>Hold</button>
                <button className="btn primary" onClick={() => advanceExecution(selectedExec.execution.id, 'advance', prompt('Advancement note:') || '')}>Advance</button>
              </div>
            )}
          </div>
        </div>
      )}

      {showRuleModal && (
        <div className="modal-overlay" onClick={() => { setShowRuleModal(false); setEditingRule(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <h2>{editingRule ? 'Edit' : 'Create'} Routing Rule</h2>
              <button className="btn ghost" onClick={() => { setShowRuleModal(false); setEditingRule(null); }}><Icon name="x" size={16} /></button>
            </div>
            <RoutingRuleForm rule={editingRule} onSave={loadAll} onClose={() => { setShowRuleModal(false); setEditingRule(null); }} />
          </div>
        </div>
      )}
    </div>
  );
}

function RoutingRuleForm({ rule, onSave, onClose }) {
  const [form, setForm] = useState({
    name: rule?.name || '',
    description: rule?.description || '',
    module: 'documents',
    document_category: rule?.document_category || '',
    department: rule?.department || '',
    trigger_event: rule?.trigger_event || 'submitted_for_review',
    conditions: rule?.conditions || {},
    steps: rule?.steps || [],
    active: rule?.active !== 0
  });
  const [stepForms, setStepForms] = useState(rule?.steps?.map((s, i) => ({
    step: i + 1,
    name: s.name || '',
    role: s.role || '',
    department: s.department || '',
    days: s.days || 3,
    required: s.required !== false
  })) || []);

  function addStep() {
    setStepForms(prev => [...prev, { step: prev.length + 1, name: '', role: '', department: '', days: 3, required: true }]);
  }

  function removeStep(idx) {
    setStepForms(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, step: i + 1 })));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      const steps = stepForms.map(s => ({
        step: s.step,
        name: s.name,
        role: s.role,
        department: s.department,
        days: Number(s.days),
        required: s.required
      }));
      const payload = { ...form, steps };
      if (editingRule) {
        await api.put(`/routing/rules/${editingRule.id}`, payload);
      } else {
        await api.post('/routing/rules', payload);
      }
      showToast(editingRule ? 'Rule updated' : 'Rule created');
      onSave();
      onClose();
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-grid">
        <div className="field span-2">
          <label>Name <span className="req">*</span></label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
        </div>
        <div className="field span-2">
          <label>Description</label>
          <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </div>
        <div className="field">
          <label>Module</label>
          <input value={form.module} onChange={e => setForm(f => ({ ...f, module: e.target.value }))} disabled />
        </div>
        <div className="field">
          <label>Document Category</label>
          <select value={form.document_category} onChange={e => setForm(f => ({ ...f, document_category: e.target.value }))}>
            <option value="">All</option>
            <option value="Manual">Manual</option>
            <option value="Procedure">Procedure</option>
            <option value="Work Instruction">Work Instruction</option>
            <option value="Specification">Specification</option>
            <option value="Protocol">Protocol</option>
            <option value="Form">Form</option>
            <option value="Plan">Plan</option>
          </select>
        </div>
        <div className="field">
          <label>Department</label>
          <select value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))}>
            <option value="">All</option>
            <option value="Quality">Quality</option>
            <option value="Operations">Operations</option>
            <option value="Engineering">Engineering</option>
            <option value="Supply Chain">Supply Chain</option>
            <option value="HR">HR</option>
            <option value="IT">IT</option>
          </select>
        </div>
        <div className="field">
          <label>Trigger Event</label>
          <select value={form.trigger_event} onChange={e => setForm(f => ({ ...f, trigger_event: e.target.value }))}>
            <option value="submitted_for_review">Submitted for Review</option>
            <option value="created">Created</option>
            <option value="status_change">Status Change</option>
          </select>
        </div>
        <div className="field">
          <label>Active</label>
          <select value={String(form.active)} onChange={e => setForm(f => ({ ...f, active: e.target.value === 'true' }))}>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </div>
      </div>

      <div className="card card-pad mb-3" style={{ background: 'var(--bg)' }}>
        <div className="flex justify-between items-center mb-3">
          <div className="card-title">Steps ({stepForms.length})</div>
          <button type="button" className="btn sm" onClick={addStep}><Icon name="plus" size={12} /> Add Step</button>
        </div>
        {stepForms.map((s, i) => (
          <div key={i} className="filter-bar" style={{ marginBottom: 8, background: 'var(--bg)', padding: 12, borderRadius: 8 }}>
            <input className="input" style={{ width: 60 }} type="number" value={s.step} readOnly />
            <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="Step name" value={s.name} onChange={e => setStepForms(st => { const n = [...st]; n[i] = { ...n[i], name: e.target.value }; return n; })} required />
            <select className="input" style={{ width: 160 }} value={s.role} onChange={e => setStepForms(st => { const n = [...st]; n[i] = { ...n[i], role: e.target.value }; return n; })}>
              <option value="">Role</option>
              <option value="qa">QA</option>
              <option value="quality_manager">Quality Manager</option>
              <option value="doc_controller">Document Controller</option>
              <option value="manager">Manager</option>
              <option value="supplier_manager">Supplier Manager</option>
              <option value="compliance_manager">Compliance Manager</option>
              <option value="management">Management</option>
            </select>
            <select className="input" style={{ width: 140 }} value={s.department} onChange={e => setStepForms(st => { const n = [...st]; n[i] = { ...n[i], department: e.target.value }; return n; })}>
              <option value="">Department (opt)</option>
              <option value="Quality">Quality</option>
              <option value="Operations">Operations</option>
              <option value="Engineering">Engineering</option>
              <option value="Supply Chain">Supply Chain</option>
            </select>
            <input className="input" style={{ width: 80 }} type="number" min="0" max="30" placeholder="Days" value={s.days} onChange={e => setStepForms(st => { const n = [...st]; n[i] = { ...n[i], days: e.target.value }; return n; })} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <input type="checkbox" checked={s.required} onChange={e => setStepForms(st => { const n = [...st]; n[i] = { ...n[i], required: e.target.checked }; return n; })} /> Required
            </label>
            <button type="button" className="btn sm danger" onClick={() => removeStep(i)}><Icon name="x" size={12} /></button>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn primary">{editingRule ? 'Save Changes' : 'Create Rule'}</button>
      </div>
    </form>
  );
}