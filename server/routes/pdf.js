// PDF download endpoints: single records, reports, and the system connections map.
const express = require('express');
const db = require('../db');
const { MODULES } = require('../modules');
const { authRequired } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const ai = require('../ai/brain');
const { recordPdf, reportPdf, networkPdf } = require('../pdf');

const r = express.Router();
r.use(authRequired);

const LABEL_TYPE = { policies: 'Policy', goals: 'KPI', risks: 'Risk', suppliers: 'Supplier', employees: 'Employee', competencies: 'Employee', trainings: 'Training', records: 'Document', documents: 'Document', design: 'Design review', equipment: 'Equipment', nonconformances: 'NC', audits: 'Audit', compliance: 'Compliance', mgmt_reviews: 'Mgmt review', actions: 'Action' };
const ROUTE = { policies: 'policies', goals: 'goals', risks: 'risks', suppliers: 'suppliers', employees: 'employees', competencies: 'competencies', trainings: 'trainings', records: 'records', documents: 'documents', design: 'design', equipment: 'equipment', nonconformances: 'nonconformances', audits: 'audits', compliance: 'compliance', mgmt_reviews: 'mgmt-reviews', actions: 'actions' };

r.get('/record/:module/:id', (req, res) => {
  const key = (req.params.module || '').replace(/-/g, '_');
  const m = MODULES[key];
  if (!m || Number.isNaN(Number(req.params.id))) return res.status(404).json({ error: 'Not found' });
  const readable = m.perms.read === 'all' || (Array.isArray(m.perms.read) && m.perms.read.includes(req.user.role));
  if (!readable) return res.status(403).json({ error: 'No access' });
  const row = db.prepare(`SELECT * FROM ${m.table} WHERE id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Not found' });

  const userName = id => (db.prepare('SELECT name FROM users WHERE id = ?').get(id) || {}).name || null;
  const title = row.title || row.name || row.code;

  // Related information via the AI knowledge graph
  const label = LABEL_TYPE[key] || 'Record';
  let related = [];
  try {
    const g = ai.graph(label, row.code, req.user, 1);
    related = g.nodes.filter(n => n.rel !== 'query origin').map(n => ({ type: n.type, label: n.label, rel: n.rel }));
  } catch {}
  // Manual user-made links
  try {
    const links = db.prepare('SELECT * FROM links WHERE (from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?)').all(key, String(row.id), key, String(row.id));
    for (const l of links) {
      const outgoing = l.from_type === key && String(l.from_id) === String(row.id);
      const otherType = outgoing ? l.to_type : l.from_type;
      const otherId = outgoing ? l.to_id : l.from_id;
      const om = MODULES[otherType];
      if (!om) continue;
      const orow = db.prepare(`SELECT * FROM ${om.table} WHERE id = ?`).get(Number(otherId));
      if (!orow) continue;
      related.push({ type: om.title.replace(/s$/, ''), label: `${orow.code || ''} ${orow.title || orow.name || ''}`.trim(), rel: `${outgoing ? '' : '← '}${l.rel || 'linked'}` });
    }
  } catch {}

  const actions = db.prepare('SELECT a.*, u.name AS owner_name FROM actions a LEFT JOIN users u ON u.id = a.owner_id WHERE a.source_code = ? ORDER BY a.due_date').all(row.code);

  const children = [];
  let childrenLabel = '', childColumns = [];
  const defs = [];
  if (m.child) defs.push({ key: m.child.key || m.child.table, ...m.child });
  if (m.children) m.children.forEach(c => defs.push({ key: c.key || c.table, ...c }));
  for (const cd of defs) {
    const rows = db.prepare(`SELECT * FROM ${cd.table} WHERE ${cd.fk} = ? ORDER BY id DESC LIMIT 30`).all(row.id)
      .map(cr => cd.fields.map(f => {
        let v = cr[f];
        if (v === null || v === undefined || v === '') return '—';
        if (f.endsWith('_id')) v = userName(v) || v;
        return String(v);
      }));
    if (rows.length) {
      children.length = 0;
      children.push(...rows);
      childrenLabel = cd.label;
      childColumns = cd.fields.map(f => ({ label: f.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), w: Math.max(14, f.length * 1.6 + 6) }));
      break;
    }
  }

  const comments = db.prepare('SELECT c.body, c.created_at, u.name AS who FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.entity_type = ? AND c.entity_id = ? ORDER BY c.id DESC LIMIT 8').all(m.table, String(row.id))
    .map(c => ({ body: c.body, who: c.who || 'Unknown', when: (c.created_at || '').slice(0, 10) }));
  const history = db.prepare('SELECT action, created_at AS at_time, entity_label AS label, user_name FROM (SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id) a WHERE a.entity_type = ? AND a.entity_id = ? ORDER BY a.id DESC LIMIT 10').all(m.table, String(row.id))
    .map(h => ({ ...h, when: (h.at_time || '').slice(0, 10) }));

  const keep = ['status', 'severity', 'priority', 'department', 'category', 'version', 'owner_id', 'raised_by', 'occurred_at', 'due_date', 'review_date', 'effective_date', 'next_calibration', 'next_maintenance', 'supplier_id', 'framework', 'clause', 'treatment', 'result', 'stage', 'risk_level', 'frequency', 'target_value', 'confidentiality', 'retention_years', 'type', 'source', 'source_ref'];
  const fields = [];
  for (const k of keep) {
    if (row[k] === undefined || row[k] === null || row[k] === '') continue;
    let v = row[k];
    if (k.endsWith('_id')) v = userName(v) || v;
    fields.push([k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), String(v).slice(0, 300)]);
  }

  const doc = recordPdf({
    code: row.code, title, moduleTitle: m.title, status: row.status,
    requestedBy: `${req.user.name} (${req.user.email})`,
    description: row.description || row.body || null,
    fields, related, actions, comments, history,
    children, childrenLabel, childColumns
  });
  audit(req, 'pdf_export', m.table, row.id, `${row.code} PDF`, {});
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${row.code}.pdf"`);
  doc.pipe(res);
  doc.end();
});

r.get('/report/:key', (req, res) => {
  const { REPORTS } = require('./reports');
  const rp = REPORTS[req.params.key];
  if (!rp) return res.status(404).json({ error: 'Unknown report' });
  if (!['admin', 'quality_manager', 'management', 'manager', 'qa', 'investigator', 'auditor', 'risk_manager', 'compliance_manager', 'doc_controller', 'competency_manager', 'supplier_manager', 'equipment_manager'].includes(req.user.role))
    return res.status(403).json({ error: 'Not authorized to export' });
  const data = rp.build();
  const notes = [];
  if (data.overdue?.length) notes.push(`${data.overdue.length} OVERDUE item(s) included below/flagged.`);
  if (data.lowPerformers?.length) notes.push(`${data.lowPerformers.length} supplier evaluation(s) below threshold.`);
  if (data.reviewOverdue?.length) notes.push(`${data.reviewOverdue.length} document review(s) overdue.`);
  const doc = reportPdf({ title: rp.title, rows: data.rows, columns: data.columns, notes });
  audit(req, 'pdf_export', 'reports', null, rp.title, { rows: data.rows.length });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.key}-report.pdf"`);
  doc.pipe(res);
  doc.end();
});

r.get('/network', (req, res) => {
  const network = ai.buildNetwork(req.user);
  audit(req, 'pdf_export', 'network', null, 'Connections map', { nodes: network.nodes.length });
  const doc = networkPdf(network);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="qualicore-connections.pdf"');
  doc.pipe(res);
  doc.end();
});

module.exports = r;
