// Global Impact Engine — analyzes the ripple effect of any QMS record across all modules.
// Built entirely from real database relationships — no hardcoded links.
const express = require('express');
const db = require('../db');
const { MODULES } = require('../modules');
const { authRequired } = require('../middleware/auth');
const { audit } = require('../middleware/audit');

const r = express.Router();
r.use(authRequired);

const ROUTE = { policies: 'policies', goals: 'goals', risks: 'risks', suppliers: 'suppliers', employees: 'employees', competencies: 'competencies', trainings: 'trainings', records: 'records', documents: 'documents', design: 'design', equipment: 'equipment', nonconformances: 'nonconformances', audits: 'audits', compliance: 'compliance', mgmt_reviews: 'mgmt-reviews', actions: 'actions' };
const TITLE_COL = { suppliers: 'name', equipment: 'name', competencies: 'name', employees: 'name' };

function resolveRecord(typeKey, id) {
  const key = (typeKey || '').includes('-') ? typeKey.replace(/-/g, '_') : typeKey;
  const m = MODULES[key];
  if (!m) return null;
  const row = db.prepare('SELECT * FROM ' + m.table + ' WHERE id = ?').get(Number(id));
  if (!row) return null;
  return { key, table: m.table, id: row.id, code: row.code, title: row.title || row.name || row.code, status: row.status, typeLabel: m.title.replace(/s$/, ''), row };
}

function ownerName(id) {
  if (!id) return null;
  return (db.prepare('SELECT name FROM users WHERE id = ?').get(id) || {}).name || null;
}

// Determine impact level for an affected record
function impactLevel(rel, affectedRow, sourceRow) {
  // Critical: source is critical severity or the affected record is blocking something
  if (sourceRow.severity === 'critical' || sourceRow.priority === 'critical') return 'critical';
  if (affectedRow && (affectedRow.severity === 'critical' || affectedRow.priority === 'critical')) return 'critical';
  // High: direct dependency (action from this record, NC on this supplier)
  if (['raised action', 'quality event', 'supplier involved', 'audited supplier', 'linked policy'].includes(rel)) return 'high';
  if (affectedRow && (affectedRow.priority === 'high' || affectedRow.severity === 'major')) return 'high';
  // Medium: indirect relationship
  if (['measured by', 'linked policy', 'assessed competency', 'assessed person', 'attended training', 'participant', 'finding', 'requires', 'qualified by'].includes(rel)) return 'medium';
  // Low: text mentions, weak associations
  return rel && rel.includes('references') ? 'low' : 'medium';
}

function recommendedAction(rel, affectedStatus, sourceStatus) {
  if (affectedStatus === 'closed' || affectedStatus === 'obsolete' || affectedStatus === 'archived') return null;
  if (rel === 'raised action' && ['open', 'in_progress'].includes(affectedStatus)) return 'Review and update this action — the source record has changed';
  if (rel === 'quality event' && ['open', 'investigation'].includes(affectedStatus)) return 'Assess whether this NC is affected by the change';
  if (rel === 'supplier involved' && affectedStatus !== 'closed') return 'Notify supplier of the change';
  if (rel === 'linked policy' || rel === 'measured by') return 'Verify alignment with the updated record';
  if (rel === 'assessed competency' || rel === 'assessed person') return 'Review if re-assessment is needed';
  if (rel === 'audited supplier') return 'Check if audit scope is affected';
  if (rel && rel.includes('references')) return 'Verify the reference is still valid';
  return 'Review for potential impact';
}

// Build the full impact analysis for a record
function buildImpact(typeKey, id, user) {
  const self = resolveRecord(typeKey, id);
  if (!self) return null;

  const affected = [];
  const seen = new Set();
  const addAffected = (relKey, relId, rel, extraStatus) => {
    const rec = resolveRecord(relKey, relId);
    if (!rec || (rec.key === self.key && String(rec.id) === String(self.id))) return;
    const dedupeKey = rec.key + ':' + rec.id;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    const level = impactLevel(rel, rec.row, self.row);
    const ownerCol = rec.row.owner_id ? rec.row.owner_id : rec.row.chair_id || rec.row.lead_auditor_id || null;
    affected.push({
      module: rec.key, moduleLabel: rec.typeLabel, code: rec.code, title: rec.title,
      status: rec.status || 'unknown', owner: ownerName(ownerCol),
      rel, level, route: ROUTE[rec.key] || rec.key,
      link: `/${ROUTE[rec.key] || rec.key}/${rec.id}`,
      recommended: recommendedAction(rel, rec.status, self.status),
      requiredAction: level === 'critical' || level === 'high' ? `Review ${rec.code} for impact from ${self.code} change` : null
    });
  };

  // 1. Actions sourced from this record
  for (const a of db.prepare('SELECT id FROM actions WHERE source_code = ?').all(self.code))
    addAffected('actions', a.id, 'raised action');

  // 2. Type-specific structured relations
  if (self.key === 'nonconformances' && self.row.supplier_id) addAffected('suppliers', self.row.supplier_id, 'supplier involved');
  if (self.key === 'suppliers') {
    for (const n of db.prepare('SELECT id FROM nonconformances WHERE supplier_id = ?').all(id)) addAffected('nonconformances', n.id, 'quality event');
    for (const a of db.prepare('SELECT id FROM audits WHERE supplier_id = ?').all(id)) addAffected('audits', a.id, 'audited supplier');
  }
  if (self.key === 'policies') for (const g of db.prepare('SELECT id FROM goals WHERE policy_id = ?').all(id)) addAffected('goals', g.id, 'measured by');
  if (self.key === 'goals' && self.row.policy_id) addAffected('policies', self.row.policy_id, 'linked policy');
  if (self.key === 'employees') {
    for (const a of db.prepare('SELECT competency_id FROM assessments WHERE employee_id = ?').all(id)) addAffected('competencies', a.competency_id, 'assessed competency');
    for (const tp of db.prepare('SELECT training_id FROM training_participants WHERE employee_id = ?').all(id)) addAffected('trainings', tp.training_id, 'attended training');
  }
  if (self.key === 'competencies') for (const a of db.prepare('SELECT employee_id FROM assessments WHERE competency_id = ?').all(id)) addAffected('employees', a.employee_id, 'assessed person');
  if (self.key === 'trainings') for (const tp of db.prepare('SELECT employee_id FROM training_participants WHERE training_id = ?').all(id)) addAffected('employees', tp.employee_id, 'participant');
  if (self.key === 'audits' && self.row.supplier_id) addAffected('suppliers', self.row.supplier_id, 'audited supplier');

  // 3. Manual links
  for (const l of db.prepare('SELECT * FROM links WHERE (from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?)').all(self.key, String(id), self.key, String(id))) {
    const outgoing = l.from_type === self.key && l.from_id === String(id);
    const other = resolveRecord(outgoing ? l.to_type : l.from_type, outgoing ? l.to_id : l.from_id);
    if (other) addAffected(other.key, other.id, (outgoing ? '' : '← ') + (l.rel || 'linked'));
  }

  // 4. Text mentions of this record's code across other modules
  if (self.code && self.code.length >= 4) {
    for (const [mk, m] of Object.entries(MODULES)) {
      if (mk === self.key || !m.search) continue;
      if (!canRead(user, mk)) continue;
      try {
        const cond = m.search.map(f => `${f} LIKE ?`).join(' OR ');
        const mentions = db.prepare(`SELECT id FROM ${m.table} WHERE (${cond}) LIMIT 5`).all(...m.search.map(() => `%${self.code}%`));
        for (const mr of mentions) addAffected(mk, mr.id, `references ${self.code}`);
      } catch {}
    }
  }

  // Calculate overall impact level
  const levels = affected.map(a => a.level);
  const overall = levels.includes('critical') ? 'critical' : levels.includes('high') ? 'high' : levels.includes('medium') ? 'medium' : levels.length ? 'low' : 'none';

  // Group by module for structured display
  const byModule = {};
  for (const a of affected) {
    if (!byModule[a.moduleLabel]) byModule[a.moduleLabel] = [];
    byModule[a.moduleLabel].push(a);
  }

  return {
    source: { type: self.key, typeLabel: self.typeLabel, code: self.code, title: self.title, status: self.status, id: self.id },
    overallImpact: overall,
    totalAffected: affected.length,
    criticalCount: levels.filter(l => l === 'critical').length,
    highCount: levels.filter(l => l === 'high').length,
    mediumCount: levels.filter(l => l === 'medium').length,
    lowCount: levels.filter(l => l === 'low').length,
    byModule,
    affected,
    recommendation: overall === 'critical' || overall === 'high'
      ? 'This record has significant connections. A qualified reviewer should assess all affected records before approving any change.'
      : overall === 'medium'
      ? 'Several records are connected. Review affected items for alignment.'
      : affected.length ? 'Limited impact detected. Standard review process is sufficient.'
      : 'No connected records found. Changes have minimal ripple effect.',
    generatedAt: new Date().toISOString()
  };
}

function canRead(user, key) {
  if (key === 'records') return ['admin', 'quality_manager', 'management', 'manager', 'compliance_manager', 'doc_controller'].includes(user.role);
  if (key === 'mgmt_reviews') return ['admin', 'quality_manager', 'management', 'manager', 'qa', 'investigator', 'auditor', 'compliance_manager', 'risk_manager'].includes(user.role);
  return true;
}

// GET /:type/:id — full impact analysis
r.get('/:type/:id', (req, res) => {
  const result = buildImpact(req.params.type, req.params.id, req.user);
  if (!result) return res.status(404).json({ error: 'Record not found' });
  audit(req, 'impact_analysis', result.source.type, result.source.id, `${result.source.code} impact analysis`, { affected: result.totalAffected, level: result.overallImpact });
  res.json(result);
});

// GET /pre-approval/:type/:id — lightweight check before status change
r.get('/pre-approval/:type/:id', (req, res) => {
  const result = buildImpact(req.params.type, req.params.id, req.user);
  if (!result) return res.status(404).json({ error: 'Record not found' });
  const needsReview = result.criticalCount > 0 || result.highCount > 0;
  res.json({
    overallImpact: result.overallImpact,
    totalAffected: result.totalAffected,
    needsReview,
    message: needsReview
      ? `⚠️ This change may affect ${result.totalAffected} record(s) including ${result.criticalCount} critical and ${result.highCount} high-impact items. Please review before approving.`
      : result.totalAffected > 0
      ? `${result.totalAffected} connected record(s) may be affected. Standard review is recommended.`
      : 'No connected records found. Minimal impact.',
    topAffected: result.affected.filter(a => a.level === 'critical' || a.level === 'high').slice(0, 5)
  });
});

module.exports = r;
module.exports.buildImpact = buildImpact;
