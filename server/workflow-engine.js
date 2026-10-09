// Dynamic Workflow Engine — evaluates configurable rules against real QMS records.
// Core capability used across the entire application.
const db = require('./db');
const { notify } = require('./middleware/audit');
const { pad, today, addDays } = require('./utils');
const { MODULES } = require('./modules');

// Evaluate a single condition against a record
function evalCondition(condition, record) {
  const { field, operator, value } = condition;
  const recordValue = field.split('.').reduce((obj, f) => obj?.[f], record);
  switch (operator) {
    case 'equals': return String(recordValue) === String(value);
    case 'not_equals': return String(recordValue) !== String(value);
    case 'gt': return Number(recordValue) > Number(value);
    case 'gte': return Number(recordValue) >= Number(value);
    case 'lt': return Number(recordValue) < Number(value);
    case 'lte': return Number(recordValue) <= Number(value);
    case 'in': return Array.isArray(value) && value.includes(String(recordValue));
    case 'not_in': return Array.isArray(value) && !value.includes(String(recordValue));
    case 'contains': return String(recordValue || '').toLowerCase().includes(String(value).toLowerCase());
    case 'is_empty': return recordValue === null || recordValue === undefined || recordValue === '';
    case 'is_not_empty': return recordValue !== null && recordValue !== undefined && recordValue !== '';
    case 'gte_computed': {
      // For computed fields like residual_score
      const parts = value.split('*');
      if (parts.length === 2) {
        const a = Number(record[parts[0].trim()]) || 0;
        const b = Number(record[parts[1].trim()]) || 0;
        return (a * b) >= Number(condition.threshold || 0);
      }
      return false;
    }
    default: return false;
  }
}

// Evaluate all conditions for a rule — ALL must pass (AND logic)
function evalConditions(conditions, record) {
  if (!conditions || !conditions.length) return true;
  return conditions.every(c => evalCondition(c, record));
}

// Execute a single workflow action
function executeAction(action, record, rule, user) {
  const { type, params } = action;
  switch (type) {
    case 'create_action': {
      const title = interpolate(params.title || `Action from ${rule.name}`, record);
      const max = db.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(code,5) AS INTEGER)),0) m FROM actions WHERE code LIKE 'ACT-%'").get().m;
      const code = `ACT-${pad(max + 1, 4)}`;
      const owner = params.owner_field ? record[params.owner_field] : (params.owner_id || null);
      const due = params.due_days ? addDays(today(), params.due_days) : null;
      const id = db.prepare('INSERT INTO actions (code, title, description, source_type, source_code, owner_id, priority, due_date, created_by) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(code, title, params.description || `Auto-created by workflow rule "${rule.name}"`, record.__module || 'manual', record.code || null, owner, params.priority || 'medium', due, user?.id || null).lastInsertRowid;
      if (owner) {
        const { notify } = require('./middleware/audit');
        notify(owner, `Action assigned: ${code}`, `${title} (from workflow: ${rule.name})`, `/actions?focus=${id}`, params.priority === 'critical' ? 'critical' : 'warning', 'actions', `wf-action:${code}`, 'actions', code, String(id));
      }
      return { type: 'create_action', code, id, title };
    }
    case 'notify_role': {
      const { notify } = require('./middleware/audit');
      const users = db.prepare('SELECT id FROM users WHERE role = ? AND active = 1').all(params.role);
      const message = interpolate(params.message || `Workflow "${rule.name}" triggered`, record);
      users.forEach(u => notify(u.id, title2(rule.name, record), message, params.link || `/nonconformances/${record.id}`, params.severity || 'info', params.category || 'general', `wf:${rule.id}:${record.id}:${u.id}`));
      return { type: 'notify_role', role: params.role, notified: users.length };
    }
    case 'notify_user': {
      const { notify } = require('./middleware/audit');
      const uid = params.user_field ? record[params.user_field] : params.user_id;
      if (uid) notify(uid, title2(rule.name, record), interpolate(params.message || '', record), params.link || null, params.severity || 'info', params.category || 'general', `wf:${rule.id}:${record.id}:${uid}`);
      return { type: 'notify_user', user: uid };
    }
    case 'set_field': {
      const field = params.field;
      const value = params.value === '{{today}}' ? today() : params.value;
      if (field && record.__table) {
        db.prepare(`UPDATE ${record.__table} SET ${field} = ? WHERE id = ?`).run(value, record.id);
        return { type: 'set_field', field, value };
      }
      return null;
    }
    case 'require_evidence': {
      // Record a requirement in the workflow log — UI can display this
      return { type: 'require_evidence', message: interpolate(params.message || 'Evidence required', record) };
    }
    case 'link_records': {
      // Link this record to another record by code
      const target = params.target_code;
      if (target && record.code) {
        const existing = db.prepare('SELECT id FROM links WHERE from_type=? AND from_id=? AND to_type=? AND to_id=?').get(record.__module, String(record.id), params.target_module, String(target));
        if (!existing) {
          db.prepare('INSERT INTO links (from_type, from_id, to_type, to_id, rel, created_by) VALUES (?,?,?,?,?,?)')
            .run(record.__module, String(record.id), params.target_module, String(target), params.rel || 'related', user?.id || null);
          return { type: 'link_records', target };
        }
      }
      return null;
    }
    case 'escalate': {
      const { notify } = require('./middleware/audit');
      const users = db.prepare('SELECT id FROM users WHERE role IN (\'quality_manager\',\'management\') AND active = 1').all();
      const message = `ESCALATION: ${rule.name} — ${record.code || record.id} requires attention`;
      users.forEach(u => notify(u.id, message, interpolate(params.message || 'Automatic escalation triggered', record), params.link || null, 'critical', params.category || 'general', `wf-escalate:${rule.id}:${record.id}:${u.id}`));
      return { type: 'escalate', notified: users.length };
    }
    default: return null;
  }
}

function title2(ruleName, record) {
  return `Workflow: ${ruleName} — ${record.code || record.id}`;
}

function interpolate(template, record) {
  return String(template).replace(/\{\{(\w+)\}\}/g, (_, field) => record[field] ?? '');
}

// Main entry: evaluate and execute workflows for a record change
function evaluate(moduleKey, event, record, user) {
  const m = MODULES[moduleKey];
  if (!m) return [];
  const rules = db.prepare('SELECT * FROM workflow_rules WHERE module = ? AND trigger_event = ? AND active = 1 ORDER BY id').all(moduleKey, event);
  if (!rules.length) return [];

  // Prevent duplicate processing
  const dedupeTag = `wf:${moduleKey}:${event}:${record.id}:${Date.now()}`;
  const results = [];

  // Prepare record with metadata
  const enrichedRecord = { ...record, __module: moduleKey, __table: m.table, __event: event };

  for (const rule of rules) {
    try {
      const conditions = JSON.parse(rule.conditions || '[]');
      const actions = JSON.parse(rule.actions || '[]');
      if (!actions.length) continue;

      const conditionsPassed = evalConditions(conditions, enrichedRecord);
      const executedActions = [];

      if (conditionsPassed) {
        for (const action of actions) {
          try {
            const result = executeAction(action, enrichedRecord, rule, user);
            if (result) executedActions.push(result);
          } catch (actionErr) {
            executedActions.push({ type: action.type, error: actionErr.message, status: 'failed' });
          }
        }
      }

      // Log execution for traceability
      db.prepare('INSERT INTO workflow_executions (rule_id, rule_name, record_type, record_id, record_code, trigger_event, conditions_evaluated, actions_taken, status, executed_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(rule.id, rule.name, moduleKey, String(record.id), record.code || null, event,
          JSON.stringify({ passed: conditionsPassed, conditions }),
          JSON.stringify(executedActions),
          conditionsPassed ? 'completed' : 'skipped_conditions_not_met',
          user?.name || 'system');

      results.push({
        ruleId: rule.id, ruleName: rule.name,
        conditionsPassed,
        actions: executedActions,
        status: conditionsPassed ? 'executed' : 'skipped'
      });
    } catch (ruleErr) {
      // Log the failure clearly
      db.prepare('INSERT INTO workflow_executions (rule_id, rule_name, record_type, record_id, trigger_event, status, error, executed_by) VALUES (?,?,?,?,?,?,?,?)')
        .run(rule.id, rule.name, moduleKey, String(record.id), event, 'failed', ruleErr.message, user?.name || 'system');
      results.push({ ruleId: rule.id, ruleName: rule.name, status: 'failed', error: ruleErr.message });
    }
  }
  return results;
}

// Check if an action has open dependencies
function checkDependencies(actionId) {
  const deps = db.prepare(`
    SELECT ad.depends_on_id, a.code, a.title, a.status
    FROM action_dependencies ad
    JOIN actions a ON a.id = ad.depends_on_id
    WHERE ad.action_id = ? AND a.status NOT IN ('completed', 'verified', 'cancelled')
  `).all(actionId);
  return { blocked: deps.length > 0, dependencies: deps };
}

module.exports = { evaluate, evalCondition, evalConditions, executeAction, checkDependencies };
