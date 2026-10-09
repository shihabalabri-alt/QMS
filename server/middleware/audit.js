const db = require('../db');
const { nowIso } = require('../utils');

function audit(req, action, entityType, entityId, entityLabel, details) {
  try {
    db.prepare('INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id, entity_label, details, ip, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(req.user ? req.user.id : null, req.user ? req.user.name : 'System', action, entityType || null,
        entityId !== undefined && entityId !== null ? String(entityId) : null, entityLabel || null,
        details ? JSON.stringify(details).slice(0, 2000) : null, req.ip || null, nowIso());
  } catch (e) { console.error('audit error', e.message); }
}

function notify(userId, title, body, link, severity = 'info', category = 'general', dedupeKey = null, recordType = null, recordCode = null, recordId = null, priority = null) {
  if (!userId) return;
  const prio = priority || (severity === 'critical' ? 'critical' : severity === 'warning' ? 'high' : 'medium');
  try {
    if (dedupeKey) {
      const exists = db.prepare('SELECT 1 AS x FROM notifications WHERE user_id = ? AND dedupe_key = ?').get(userId, dedupeKey);
      if (exists) return; // same event already notified — never duplicate
    }
    db.prepare('INSERT INTO notifications (user_id, title, body, link, severity, category, dedupe_key, ref_type, ref_code, ref_id, priority, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(userId, title, body || '', link || '', severity || 'info', category || 'general', dedupeKey, recordType, recordCode, recordId, prio, nowIso());
  } catch (e) { console.error('notify error', e.message); }
}

const hooks = [];
function onEvent(event, handler) { hooks.push({ event, handler }); }
async function emit(event, payload) {
  for (const h of hooks) {
    if (h.event === event || h.event === '*') {
      try { await h.handler(payload); } catch (e) { console.error(`hook ${event} error`, e.message); }
    }
  }
}

module.exports = { audit, notify, onEvent, emit };
