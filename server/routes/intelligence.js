// Quality Event Intelligence Engine — duplicate detection, recurrence patterns, cross-module analysis.
const express = require('express');
const db = require('../db');
const { MODULES } = require('../modules');
const { authRequired } = require('../middleware/auth');
const { audit } = require('../middleware/audit');

const r = express.Router();
r.use(authRequired);

// --- Text similarity using word overlap (Jaccard index) ---
const STOPWORDS = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','by','from','is','are','was','were','been','has','had','have','do','does','did','will','would','could','should','may','might','not','no','this','that','these','those','it','its','as','if','then','than','so','very','just','about','into','over','under','after','before','between','during','without','within','along','across','behind','beyond','plus','except','up','down','out','off','again','further','once','here','there','when','where','why','how','all','any','both','each','few','more','most','other','some','such','only','own','same','too']);

function tokenize(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function similarity(textA, textB) {
  const a = new Set(tokenize(textA));
  const b = new Set(tokenize(textB));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter(w => b.has(w)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union; // 0 to 1
}

// --- Duplicate detection for a new record ---
r.get('/duplicates', (req, res) => {
  const { module: modKey, title = '', description = '', exclude_id } = req.query;
  if (!title || title.length < 5) return res.json({ duplicates: [] });

  const m = MODULES[modKey];
  if (!m) return res.status(400).json({ error: 'Unknown module' });
  const readable = m.perms.read === 'all' || (Array.isArray(m.perms.read) && m.perms.read.includes(req.user.role));
  if (!readable) return res.json({ duplicates: [] });

  const candidates = db.prepare(`SELECT * FROM ${m.table} WHERE id != ? ORDER BY id DESC LIMIT 100`).all(Number(exclude_id) || 0);
  const duplicates = [];
  for (const c of candidates) {
    const cTitle = c.title || c.name || '';
    const cDesc = c.description || '';
    const titleSim = similarity(title, cTitle);
    const descSim = description && cDesc ? similarity(description, cDesc) : 0;
    const combined = titleSim * 0.7 + descSim * 0.3;
    if (combined >= 0.3 || titleSim >= 0.5) {
      const tCol = cTitle ? 'title' : 'name';
      duplicates.push({
        id: c.id, code: c.code, title: cTitle, status: c.status,
        severity: c.severity || c.priority || null,
        department: c.department || null,
        occurred_at: c.occurred_at || c.created_at || null,
        similarity: Math.round(combined * 100),
        titleSimilarity: Math.round(titleSim * 100),
        reason: titleSim >= 0.5 ? `Title is ${Math.round(titleSim * 100)}% similar` : descSim >= 0.3 ? `Description is ${Math.round(descSim * 100)}% similar` : 'Similar content',
        link: `/nonconformances/${c.id}`
      });
    }
  }
  duplicates.sort((a, b) => b.similarity - a.similarity);
  res.json({ duplicates: duplicates.slice(0, 5) });
});

// --- Recurrence pattern detection across all quality events ---
r.get('/patterns', (req, res) => {
  const patterns = [];
  const ncs = db.prepare(`SELECT n.*, s.name AS supplier_name FROM nonconformances n LEFT JOIN suppliers s ON s.id = n.supplier_id WHERE n.status != 'closed' OR n.occurred_at >= date('now','-90 day')`).all();
  const actions = db.prepare(`SELECT a.*, u.name AS owner_name FROM actions a LEFT JOIN users u ON u.id = a.owner_id WHERE a.status IN ('open','in_progress')`).all();

  // Group NCs by supplier
  const bySupplier = {};
  for (const n of ncs) {
    if (!n.supplier_id || !n.supplier_name) continue;
    const k = n.supplier_name;
    if (!bySupplier[k]) bySupplier[k] = [];
    bySupplier[k].push(n);
  }
  for (const [supplier, events] of Object.entries(bySupplier)) {
    if (events.length >= 2) {
      const severities = [...new Set(events.map(e => e.severity))];
      const codes = events.map(e => e.code);
      patterns.push({
        type: 'recurring_supplier', title: `${events.length} quality events from ${supplier}`,
        severity: events.some(e => e.severity === 'critical') ? 'critical' : events.some(e => e.severity === 'major') ? 'warning' : 'info',
        description: `${events.length} NCs/incidents linked to supplier ${supplier} in the last 90 days. Severities: ${severities.join(', ')}.`,
        records: codes, link: `/suppliers/${events[0].supplier_id}`,
        suggestion: 'Consider supplier review, requalification, or escalated corrective action.',
        label: 'Detected Pattern — Requires Review'
      });
    }
  }

  // Group NCs by department
  const byDept = {};
  for (const n of ncs) {
    if (!n.department) continue;
    const k = n.department;
    if (!byDept[k]) byDept[k] = [];
    byDept[k].push(n);
  }
  for (const [dept, events] of Object.entries(byDept)) {
    if (events.length >= 3) {
      patterns.push({
        type: 'recurring_department', title: `${events.length} quality events in ${dept} department`,
        severity: events.filter(e => e.severity === 'critical').length > 0 ? 'critical' : 'warning',
        description: `${events.length} NCs/incidents recorded in the ${dept} department. This may indicate a systemic issue.`,
        records: events.map(e => e.code), link: null,
        suggestion: 'Investigate common root causes — consider departmental process review.',
        label: 'Detected Pattern — Requires Review'
      });
    }
  }

  // Group NCs by root cause category
  const byCause = {};
  for (const n of ncs) {
    if (!n.root_cause_category) continue;
    const k = n.root_cause_category;
    if (!byCause[k]) byCause[k] = [];
    byCause[k].push(n);
  }
  for (const [cause, events] of Object.entries(byCause)) {
    if (events.length >= 3) {
      patterns.push({
        type: 'recurring_cause', title: `${events.length} events with root cause: ${cause}`,
        severity: 'warning',
        description: `${events.length} NCs share the same root cause category: "${cause}". Previous corrective actions may not be effective.`,
        records: events.map(e => e.code), link: null,
        suggestion: 'Review previous corrective actions for effectiveness. Consider a systemic CAPA.',
        label: 'Possible Pattern — Requires Review'
      });
    }
  }

  // Group actions by source (repeated problems from same source)
  const bySource = {};
  for (const a of actions) {
    if (!a.source_code) continue;
    const k = a.source_code;
    if (!bySource[k]) bySource[k] = [];
    bySource[k].push(a);
  }
  for (const [source, acts] of Object.entries(bySource)) {
    if (acts.length >= 3) {
      patterns.push({
        type: 'recurring_source', title: `${acts.length} open actions from ${source}`,
        severity: 'warning',
        description: `${acts.length} actions are still open from the same source record. This may indicate the root cause has not been fully addressed.`,
        records: acts.map(a => a.code), link: null,
        suggestion: 'Review the effectiveness of previous actions. Consider escalating to a formal CAPA.',
        label: 'Detected Pattern — Requires Review'
      });
    }
  }

  // Equipment-related recurring events
  const equipmentMentions = db.prepare("SELECT code, title, description FROM nonconformances WHERE description LIKE '%equipment%' OR title LIKE '%equipment%' OR description LIKE '%machine%'").all();
  if (equipmentMentions.length >= 3) {
    patterns.push({
      type: 'equipment_cluster', title: `${equipmentMentions.length} events mentioning equipment issues`,
      severity: 'warning',
      description: `${equipmentMentions.length} NCs/incidents reference equipment problems. Cross-reference with Equipment module for calibration and maintenance status.`,
      records: equipmentMentions.map(e => e.code), link: '/equipment',
      suggestion: 'Review equipment maintenance records and calibration status for affected items.',
      label: 'Detected Pattern — Requires Review'
    });
  }

  // Sort by severity
  patterns.sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return (order[a.severity] || 3) - (order[b.severity] || 3);
  });

  res.json({ patterns, total: patterns.length });
});

// --- Full intelligence dashboard ---
r.get('/dashboard', (req, res) => {
  const patterns = db.prepare ? null : null; // placeholder
  // Reuse the patterns logic
  const ncCount = db.prepare('SELECT COUNT(*) c FROM nonconformances WHERE status != \'closed\'').get().c;
  const openActions = db.prepare("SELECT COUNT(*) c FROM actions WHERE status IN ('open','in_progress')").get().c;
  const overdueActions = db.prepare("SELECT COUNT(*) c FROM actions WHERE due_date < date('now') AND status IN ('open','in_progress')").get().c;
  const highRisks = db.prepare('SELECT COUNT(*) c FROM risks WHERE status != \'closed\' AND (residual_likelihood * residual_severity) >= 15').get().c;
  const agingNCs = db.prepare("SELECT COUNT(*) c FROM nonconformances WHERE status != 'closed' AND occurred_at < date('now','-30 day')").get().c;

  res.json({
    summary: {
      openQualityEvents: ncCount, openActions, overdueActions,
      highRisks, agingNCs,
      intelligenceLevel: patterns ? 'active' : 'basic'
    }
  });
});

module.exports = r;
