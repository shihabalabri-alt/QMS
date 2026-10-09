const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const config = require('./config');
const { pad, addDays, addMonths, today } = require('./utils');

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

const db = new Database(config.dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee', department TEXT DEFAULT 'Quality', job_title TEXT DEFAULT '',
  phone TEXT DEFAULT '', active INTEGER DEFAULT 1, last_login TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, user_name TEXT, action TEXT NOT NULL, entity_type TEXT, entity_id TEXT,
  entity_label TEXT, details TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT,
  severity TEXT DEFAULT 'info', read INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stored_name TEXT NOT NULL, original_name TEXT NOT NULL, mime TEXT, size INTEGER,
  entity_type TEXT, entity_id TEXT, category TEXT DEFAULT 'general',
  uploaded_by INTEGER, downloads INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, user_id INTEGER, body TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, from_state TEXT, to_state TEXT,
  approver_id INTEGER, approver_name TEXT, comment TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE,
  title TEXT NOT NULL, description TEXT,
  source_type TEXT, source_id TEXT, source_code TEXT,
  owner_id INTEGER, priority TEXT DEFAULT 'medium', due_date TEXT,
  status TEXT DEFAULT 'open', completed_at TEXT, verification_notes TEXT, verified_by INTEGER,
  recurrence TEXT DEFAULT 'none', next_instance INTEGER,
  created_by INTEGER, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ai_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT, intent TEXT,
  op TEXT NOT NULL, target_type TEXT, target_code TEXT, payload TEXT,
  rationale TEXT, risk_note TEXT,
  status TEXT DEFAULT 'proposed',
  proposed_by TEXT DEFAULT 'ai', proposed_at TEXT DEFAULT (datetime('now')),
  decided_by INTEGER, decided_at TEXT, decision_note TEXT
);
CREATE TABLE IF NOT EXISTS policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE,
  title TEXT NOT NULL, category TEXT DEFAULT 'Quality', version TEXT DEFAULT '1.0',
  status TEXT DEFAULT 'draft', owner_id INTEGER, department TEXT,
  effective_date TEXT, review_date TEXT, body TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE,
  type TEXT DEFAULT 'kpi', title TEXT NOT NULL, description TEXT,
  policy_id INTEGER, owner_id INTEGER, department TEXT,
  target_value REAL, target_unit TEXT DEFAULT '%', direction TEXT DEFAULT 'higher',
  baseline REAL, frequency TEXT DEFAULT 'monthly',
  status TEXT DEFAULT 'active', review_date TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS goal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, goal_id INTEGER NOT NULL,
  period TEXT NOT NULL, value REAL, note TEXT, recorded_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS risks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE,
  title TEXT NOT NULL, description TEXT, category TEXT DEFAULT 'Operational', department TEXT,
  owner_id INTEGER, inherent_likelihood INTEGER DEFAULT 3, inherent_severity INTEGER DEFAULT 3,
  controls TEXT, residual_likelihood INTEGER DEFAULT 2, residual_severity INTEGER DEFAULT 2,
  treatment TEXT DEFAULT 'mitigate', status TEXT DEFAULT 'open',
  review_date TEXT, last_reviewed TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE,
  name TEXT NOT NULL, category TEXT, status TEXT DEFAULT 'pending',
  contact_name TEXT, email TEXT, phone TEXT, website TEXT,
  risk_level TEXT DEFAULT 'medium', qualification_date TEXT, next_audit TEXT,
  approved_by INTEGER, notes TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS supplier_evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_id INTEGER NOT NULL,
  period TEXT NOT NULL, quality_score REAL, delivery_score REAL, communication_score REAL,
  total_score REAL, notes TEXT, evaluator_id INTEGER, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS supplier_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_id INTEGER NOT NULL,
  incident_date TEXT, description TEXT, impact TEXT, severity TEXT DEFAULT 'minor',
  status TEXT DEFAULT 'open', action_taken TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE,
  name TEXT NOT NULL, email TEXT, department TEXT, job_title TEXT,
  manager_id INTEGER, hire_date TEXT, status TEXT DEFAULT 'active',
  user_id INTEGER, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS competencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE,
  name TEXT NOT NULL, category TEXT, description TEXT, required_level INTEGER DEFAULT 3,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE,
  employee_id INTEGER NOT NULL, competency_id INTEGER NOT NULL,
  level INTEGER, assessment_date TEXT, expiry_date TEXT, assessor_id INTEGER,
  notes TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS trainings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE,
  title TEXT NOT NULL, provider TEXT, type TEXT DEFAULT 'technical',
  scheduled_date TEXT, hours REAL, status TEXT DEFAULT 'scheduled', notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS training_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT, training_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL, status TEXT DEFAULT 'invited', score REAL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE,
  title TEXT NOT NULL, category TEXT, format TEXT DEFAULT 'electronic',
  owner_id INTEGER, department TEXT, confidentiality TEXT DEFAULT 'internal',
  retention_years INTEGER DEFAULT 7, status TEXT DEFAULT 'active',
  retention_until TEXT, location TEXT, description TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE,
  title TEXT NOT NULL, category TEXT, department TEXT, owner_id INTEGER,
  status TEXT DEFAULT 'draft', version TEXT DEFAULT '0.1',
  effective_date TEXT, review_date TEXT, change_summary TEXT, description TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS document_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL,
  version TEXT, change_summary TEXT, status TEXT DEFAULT 'draft',
  approved_by INTEGER, approved_at TEXT, file_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS design_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE,
  project TEXT, title TEXT NOT NULL, stage TEXT DEFAULT 'concept',
  review_date TEXT, chair_id INTEGER, status TEXT DEFAULT 'planned',
  summary TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS design_requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT, review_id INTEGER NOT NULL,
  requirement TEXT NOT NULL, acceptance_criteria TEXT, verification_method TEXT,
  status TEXT DEFAULT 'open', created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS design_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, review_id INTEGER NOT NULL,
  description TEXT NOT NULL, severity TEXT DEFAULT 'minor',
  owner_id INTEGER, status TEXT DEFAULT 'open', due_date TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE,
  name TEXT NOT NULL, type TEXT, manufacturer TEXT, model TEXT, serial TEXT,
  location TEXT, status TEXT DEFAULT 'operational',
  installed_on TEXT, requires_calibration INTEGER DEFAULT 0,
  calibration_interval_days INTEGER, last_calibration TEXT, next_calibration TEXT,
  last_maintenance TEXT, next_maintenance TEXT, owner_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS equipment_qualifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_id INTEGER NOT NULL,
  type TEXT DEFAULT 'IQ', status TEXT DEFAULT 'pending', performed_by INTEGER,
  performed_on TEXT, result TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS nonconformances (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE,
  type TEXT DEFAULT 'nc', title TEXT NOT NULL, description TEXT,
  source TEXT DEFAULT 'internal', source_ref TEXT,
  severity TEXT DEFAULT 'minor', department TEXT, supplier_id INTEGER,
  raised_by INTEGER, owner_id INTEGER, occurred_at TEXT,
  status TEXT DEFAULT 'open',
  root_cause TEXT, root_cause_category TEXT, correction TEXT, preventive_action TEXT,
  verified_by INTEGER, verified_at TEXT, closed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE,
  title TEXT NOT NULL, type TEXT DEFAULT 'internal', standard TEXT DEFAULT 'ISO 9001:2015',
  scope TEXT, department TEXT, lead_auditor_id INTEGER, supplier_id INTEGER,
  status TEXT DEFAULT 'planned', planned_date TEXT, conducted_on TEXT,
  result TEXT, summary TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, audit_id INTEGER NOT NULL,
  clause TEXT, requirement TEXT, finding_type TEXT DEFAULT 'ok',
  description TEXT, owner_id INTEGER, status TEXT DEFAULT 'open', due_date TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS compliance_requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE,
  framework TEXT DEFAULT 'ISO 9001:2015', clause TEXT, title TEXT NOT NULL,
  description TEXT, status TEXT DEFAULT 'not_assessed', owner_id INTEGER,
  last_assessed TEXT, next_review TEXT, evidence TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS management_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE,
  title TEXT NOT NULL, review_date TEXT, chair_id INTEGER, attendees TEXT,
  status TEXT DEFAULT 'draft', summary TEXT, inputs TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, key_hash TEXT NOT NULL, prefix TEXT,
  created_by INTEGER, scopes TEXT DEFAULT 'read', active INTEGER DEFAULT 1,
  last_used TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL, events TEXT, active INTEGER DEFAULT 1, secret TEXT,
  description TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS webhook_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, webhook_id INTEGER, event TEXT,
  status_code INTEGER, ok INTEGER, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT
);
CREATE TABLE IF NOT EXISTS workflow_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  module TEXT NOT NULL,
  trigger_event TEXT NOT NULL,
  conditions TEXT DEFAULT '[]',
  actions TEXT NOT NULL DEFAULT '[]',
  active INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS workflow_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER,
  rule_name TEXT,
  record_type TEXT,
  record_id TEXT,
  record_code TEXT,
  trigger_event TEXT,
  conditions_evaluated TEXT DEFAULT '{}',
  actions_taken TEXT DEFAULT '[]',
  status TEXT DEFAULT 'completed',
  error TEXT,
  executed_by TEXT,
  executed_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS action_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id INTEGER NOT NULL,
  depends_on_id INTEGER NOT NULL,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(action_id, depends_on_id)
);
CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'Audit history is immutable — cannot modify audit records'); END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'Audit history is immutable — cannot delete audit records'); END;

CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_type TEXT NOT NULL, from_id TEXT NOT NULL,
  to_type TEXT NOT NULL, to_id TEXT NOT NULL,
  rel TEXT DEFAULT 'related to',
  created_by INTEGER, created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(from_type, from_id, to_type, to_id, rel)
);
CREATE INDEX IF NOT EXISTS idx_links_from ON links(from_type, from_id);
CREATE INDEX IF NOT EXISTS idx_links_to ON links(to_type, to_id);
CREATE TABLE IF NOT EXISTS workflow_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, description TEXT DEFAULT '',
  module TEXT NOT NULL, trigger_event TEXT NOT NULL,
  conditions TEXT DEFAULT '[]', actions TEXT DEFAULT '[]',
  active INTEGER DEFAULT 1, created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS workflow_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER, rule_name TEXT,
  record_type TEXT, record_id TEXT, record_code TEXT,
  trigger_event TEXT,
  conditions_evaluated TEXT DEFAULT '{}',
  actions_taken TEXT DEFAULT '[]',
  status TEXT DEFAULT 'completed', error TEXT,
  executed_by TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS action_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id INTEGER NOT NULL, depends_on_id INTEGER NOT NULL,
  created_by INTEGER, created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(action_id, depends_on_id)
);
CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, record_type TEXT NOT NULL, record_id TEXT NOT NULL,
  label TEXT, created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, record_type, record_id)
);
CREATE INDEX IF NOT EXISTS idx_actions_owner ON actions(owner_id);
CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status);
CREATE INDEX IF NOT EXISTS idx_nc_status ON nonconformances(status);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_files_entity ON files(entity_type, entity_id);
`;

function initSchema() {
  db.exec(SCHEMA);
  // Migrations for existing databases (guarded — run once each)
  const alters = [
    'ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN email_verify_token TEXT',
    'ALTER TABLE users ADD COLUMN email_verify_sent_at TEXT',
    'ALTER TABLE users ADD COLUMN failed_attempts INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN locked_until TEXT',
    'ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN totp_secret TEXT',
    'ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN backup_codes TEXT',
    'ALTER TABLE notifications ADD COLUMN category TEXT DEFAULT "system"',
    'ALTER TABLE notifications ADD COLUMN priority TEXT DEFAULT "medium"',
    'ALTER TABLE notifications ADD COLUMN ref_type TEXT',
    'ALTER TABLE notifications ADD COLUMN ref_id TEXT',
    'ALTER TABLE notifications ADD COLUMN ref_code TEXT',
    'ALTER TABLE notifications ADD COLUMN category TEXT DEFAULT \'general\'',
    'ALTER TABLE notifications ADD COLUMN priority TEXT DEFAULT \'info\'',
    'ALTER TABLE notifications ADD COLUMN dedupe_key TEXT'
  ];
  for (const sql of alters) { try { db.exec(sql); } catch { /* column exists */ } }
  // One-time backfill: pre-existing accounts are trusted; new ones must verify.
  const hasVerifSetting = db.prepare("SELECT 1 AS x FROM settings WHERE key = 'require_email_verification'").get();
  if (!hasVerifSetting || !hasVerifSetting.x) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('require_email_verification', '1')").run();
    db.prepare('UPDATE users SET email_verified = 1').run();
    console.log('[migration] Existing users marked email-verified; new accounts now require verification.');
  }

  // Document Control Tracking columns migration
  const docTrackingAlters = [
    'ALTER TABLE documents ADD COLUMN tracking_number TEXT',
    'ALTER TABLE documents ADD COLUMN revision_number TEXT DEFAULT \'0\'',
    'ALTER TABLE documents ADD COLUMN current_stage TEXT DEFAULT \'draft\'',
    'ALTER TABLE documents ADD COLUMN stage_entered_at TEXT',
    'ALTER TABLE documents ADD COLUMN stage_due_at TEXT',
    'ALTER TABLE documents ADD COLUMN assigned_reviewer_id INTEGER',
    'ALTER TABLE documents ADD COLUMN reviewer_department TEXT',
    'ALTER TABLE documents ADD COLUMN review_priority TEXT DEFAULT \'normal\'',
    'ALTER TABLE documents ADD COLUMN days_in_stage INTEGER DEFAULT 0',
    'ALTER TABLE documents ADD COLUMN total_review_cycles INTEGER DEFAULT 0',
    'ALTER TABLE documents ADD COLUMN last_action TEXT',
    'ALTER TABLE documents ADD COLUMN last_action_by INTEGER',
    'ALTER TABLE documents ADD COLUMN last_action_at TEXT',
    'ALTER TABLE documents ADD COLUMN sla_breached INTEGER DEFAULT 0',
    'ALTER TABLE documents ADD COLUMN escalation_level INTEGER DEFAULT 0',
    'ALTER TABLE documents ADD COLUMN routing_rule_id INTEGER',
    'ALTER TABLE documents ADD COLUMN routing_path TEXT',
    'ALTER TABLE documents ADD COLUMN current_step_index INTEGER DEFAULT 0',
    'ALTER TABLE documents ADD COLUMN routing_status TEXT DEFAULT \'pending\'',
    'ALTER TABLE documents ADD COLUMN routed_by INTEGER',
    'ALTER TABLE documents ADD COLUMN routed_at TEXT'
  ];
  for (const sql of docTrackingAlters) { try { db.exec(sql); } catch { /* column exists */ } }

  // Create document routing tables
  const routingTables = `
    CREATE TABLE IF NOT EXISTS document_routing_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      module TEXT NOT NULL,
      document_category TEXT,
      department TEXT,
      trigger_event TEXT NOT NULL,
      conditions TEXT DEFAULT '{}',
      steps TEXT DEFAULT '[]',
      active INTEGER DEFAULT 1,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS document_routing_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id INTEGER NOT NULL,
      rule_name TEXT,
      document_id TEXT NOT NULL,
      document_code TEXT,
      document_title TEXT,
      current_step INTEGER DEFAULT 0,
      status TEXT DEFAULT 'in_progress',
      step_history TEXT DEFAULT '[]',
      assigned_to INTEGER,
      assigned_at TEXT,
      due_at TEXT,
      completed_at TEXT,
      escalated INTEGER DEFAULT 0,
      escalation_level INTEGER DEFAULT 0,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS document_routing_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_id INTEGER NOT NULL,
      step_index INTEGER,
      action TEXT NOT NULL,
      actor_id INTEGER,
      actor_name TEXT,
      from_step INTEGER,
      to_step INTEGER,
      details TEXT,
      timestamp TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS document_escalation_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      routing_rule_id INTEGER,
      trigger_after_days INTEGER DEFAULT 7,
      escalation_levels TEXT DEFAULT '[]',
      notify_roles TEXT DEFAULT '[]',
      active INTEGER DEFAULT 1,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `;
  db.exec(routingTables);

  // Create indexes for tracking queries
  const trackingIndexes = [
    'CREATE INDEX IF NOT EXISTS idx_documents_tracking_number ON documents(tracking_number)',
    'CREATE INDEX IF NOT EXISTS idx_documents_current_stage ON documents(current_stage)',
    'CREATE INDEX IF NOT EXISTS idx_documents_assigned_reviewer ON documents(assigned_reviewer_id)',
    'CREATE INDEX IF NOT EXISTS idx_documents_review_priority ON documents(review_priority)',
    'CREATE INDEX IF NOT EXISTS idx_documents_sla_breached ON documents(sla_breached)',
    'CREATE INDEX IF NOT EXISTS idx_documents_routing_rule ON documents(routing_rule_id)',
    'CREATE INDEX IF NOT EXISTS idx_documents_routing_status ON documents(routing_status)',
    'CREATE INDEX IF NOT EXISTS idx_routing_executions_document ON document_routing_executions(document_id)',
    'CREATE INDEX IF NOT EXISTS idx_routing_executions_status ON document_routing_executions(status)',
    'CREATE INDEX IF NOT EXISTS idx_routing_executions_assigned ON document_routing_executions(assigned_to)',
    'CREATE INDEX IF NOT EXISTS idx_routing_audit_execution ON document_routing_audit(execution_id)',
    'CREATE INDEX IF NOT EXISTS idx_escalation_rules_routing ON document_escalation_rules(routing_rule_id)'
  ];
  for (const sql of trackingIndexes) { try { db.exec(sql); } catch { /* index exists */ } }
}

/* ---------------- SEED ---------------- */
function seed() {
  const reseed = process.argv.includes('--reseed');
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0 && !reseed) return;

  if (reseed) {
    const tables = ['webhook_log','webhooks','api_keys','management_reviews','compliance_requirements','audit_items','audits','nonconformances','equipment_qualifications','equipment','design_findings','design_requirements','design_reviews','document_versions','documents','records','training_participants','trainings','assessments','competencies','employees','supplier_incidents','supplier_evaluations','suppliers','risks','goal_entries','goals','policies','actions','comments','files','approvals','notifications','audit_log','users','settings'];
    db.exec('PRAGMA foreign_keys = OFF;');
    for (const t of tables) db.exec(`DELETE FROM ${t}; DELETE FROM sqlite_sequence WHERE name='${t}';`);
    db.exec('PRAGMA foreign_keys = ON;');
  }

  const T = today();
  const hash = p => bcrypt.hashSync(p, 10);
  const ins = (table, obj) => {
    const keys = Object.keys(obj);
    const r = db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => obj[k]));
    return r.lastInsertRowid;
  };

  // Users
  const users = {
    admin: ins('users', { name: 'Amara Osei', email: 'admin@qms.io', password_hash: hash('Admin123!'), role: 'admin', department: 'Quality', job_title: 'System Administrator', phone: '+1-555-0100' }),
    qm: ins('users', { name: 'Daniel Reyes', email: 'qm@qms.io', password_hash: hash('Qm12345!'), role: 'quality_manager', department: 'Quality', job_title: 'Quality Manager', phone: '+1-555-0101' }),
    mgr_ops: ins('users', { name: 'Priya Sharma', email: 'ops.manager@qms.io', password_hash: hash('Mgr12345!'), role: 'manager', department: 'Operations', job_title: 'Operations Manager', phone: '+1-555-0102' }),
    mgr_eng: ins('users', { name: 'Tom Becker', email: 'eng.manager@qms.io', password_hash: hash('Mgr12345!'), role: 'manager', department: 'Engineering', job_title: 'Engineering Manager', phone: '+1-555-0103' }),
    qa1: ins('users', { name: 'Lena Kowalski', email: 'qa@qms.io', password_hash: hash('Qa12345!'), role: 'qa', department: 'Quality', job_title: 'QA Engineer', phone: '+1-555-0104' }),
    auditor: ins('users', { name: 'Marcus Chen', email: 'auditor@qms.io', password_hash: hash('Audit123!'), role: 'auditor', department: 'Quality', job_title: 'Lead Auditor', phone: '+1-555-0105' }),
    emp1: ins('users', { name: 'Sofia Rossi', email: 'employee@qms.io', password_hash: hash('Emp12345!'), role: 'employee', department: 'Operations', job_title: 'Production Operator', phone: '+1-555-0106' }),
    emp2: ins('users', { name: 'James Park', email: 'tech@qms.io', password_hash: hash('Emp12345!'), role: 'employee', department: 'Engineering', job_title: 'Maintenance Technician', phone: '+1-555-0107' }),
    riskm: ins('users', { name: 'Elena Volkov', email: 'risk@qms.io', password_hash: hash('Risk12345!'), role: 'risk_manager', department: 'Quality', job_title: 'Risk Manager', phone: '+1-555-0108' }),
    comp: ins('users', { name: 'Robert Klein', email: 'compliance@qms.io', password_hash: hash('Comp12345!'), role: 'compliance_manager', department: 'Quality', job_title: 'Compliance Manager', phone: '+1-555-0109' }),
    docc: ins('users', { name: 'Hannah Yang', email: 'docs@qms.io', password_hash: hash('Docs12345!'), role: 'doc_controller', department: 'Quality', job_title: 'Document Controller', phone: '+1-555-0110' }),
    compet: ins('users', { name: 'Peter Nowak', email: 'competency@qms.io', password_hash: hash('Comp12345!'), role: 'competency_manager', department: 'HR', job_title: 'Competency Manager', phone: '+1-555-0111' }),
    supm: ins('users', { name: 'Aisha Mohammed', email: 'supplier@qms.io', password_hash: hash('Supp12345!'), role: 'supplier_manager', department: 'Supply Chain', job_title: 'Supplier Manager', phone: '+1-555-0112' }),
    eqm: ins('users', { name: 'Carlos Mendes', email: 'equipment@qms.io', password_hash: hash('Equip123!'), role: 'equipment_manager', department: 'Engineering', job_title: 'Equipment Manager', phone: '+1-555-0113' }),
    exec: ins('users', { name: 'Isabelle Fontaine', email: 'management@qms.io', password_hash: hash('Exec12345!'), role: 'management', department: 'Executive', job_title: 'Chief Executive', phone: '+1-555-0114' }),
    inv: ins('users', { name: 'Dmitri Petrov', email: 'investigator@qms.io', password_hash: hash('Invest123!'), role: 'investigator', department: 'Quality', job_title: 'Senior Investigator', phone: '+1-555-0115' }),
    operator: ins('users', { name: 'System Operator', email: 'operator@qualicore.com', password_hash: hash('Operator@2026!'), role: 'admin', department: 'Operations', job_title: 'System Operator (Full Access)', phone: '+1-555-0200' })
  };

  db.prepare(`INSERT INTO settings (key, value) VALUES ('org_name', ?), ('alert_days', '30'), ('escalate_days', '7')`)
    .run(config.org.name);
  db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('require_email_verification', '1')`).run();
  // Seeded demo accounts are pre-verified so nothing is locked out.
  db.prepare('UPDATE users SET email_verified = 1').run();

  // Employees
  const emp = {};
  emp.priya = ins('employees', { code: 'EMP-0001', name: 'Priya Sharma', email: 'ops.manager@qms.io', department: 'Operations', job_title: 'Operations Manager', hire_date: '2019-03-11', status: 'active', user_id: users.mgr_ops });
  emp.tom = ins('employees', { code: 'EMP-0002', name: 'Tom Becker', email: 'eng.manager@qms.io', department: 'Engineering', job_title: 'Engineering Manager', hire_date: '2018-06-04', status: 'active', user_id: users.mgr_eng });
  emp.lena = ins('employees', { code: 'EMP-0003', name: 'Lena Kowalski', email: 'qa@qms.io', department: 'Quality', job_title: 'QA Engineer', hire_date: '2021-01-18', status: 'active', user_id: users.qa1 });
  emp.marcus = ins('employees', { code: 'EMP-0004', name: 'Marcus Chen', email: 'auditor@qms.io', department: 'Quality', job_title: 'Lead Auditor', hire_date: '2020-09-01', status: 'active', user_id: users.auditor });
  emp.sofia = ins('employees', { code: 'EMP-0005', name: 'Sofia Rossi', email: 'employee@qms.io', department: 'Operations', job_title: 'Production Operator', hire_date: '2022-05-16', status: 'active', user_id: users.emp1 });
  emp.james = ins('employees', { code: 'EMP-0006', name: 'James Park', email: 'tech@qms.io', department: 'Engineering', job_title: 'Maintenance Technician', hire_date: '2023-02-20', status: 'active', user_id: users.emp2 });
  emp.daniel = ins('employees', { code: 'EMP-0007', name: 'Daniel Reyes', email: 'qm@qms.io', department: 'Quality', job_title: 'Quality Manager', hire_date: '2017-11-06', status: 'active', user_id: users.qm });
  emp.amara = ins('employees', { code: 'EMP-0008', name: 'Amara Osei', email: 'admin@qms.io', department: 'Quality', job_title: 'System Administrator', hire_date: '2020-04-13', status: 'active', user_id: users.admin });
  emp.nina = ins('employees', { code: 'EMP-0009', name: 'Nina Dubois', email: 'nina.dubois@qms.io', department: 'Operations', job_title: 'Production Operator', hire_date: '2023-08-28', status: 'active' });
  emp.omar = ins('employees', { code: 'EMP-0010', name: 'Omar Hassan', email: 'omar.hassan@qms.io', department: 'Supply Chain', job_title: 'Procurement Specialist', hire_date: '2021-10-05', status: 'active' });
  emp.grace = ins('employees', { code: 'EMP-0011', name: 'Grace Lin', email: 'grace.lin@qms.io', department: 'Engineering', job_title: 'Design Engineer', hire_date: '2022-01-31', status: 'active' });
  emp.victor = ins('employees', { code: 'EMP-0012', name: 'Victor Alvarez', email: 'victor.alvarez@qms.io', department: 'Supply Chain', job_title: 'Warehouse Lead', hire_date: '2019-07-22', status: 'active' });

  // Policies
  const pol = {};
  pol.quality = ins('policies', { code: 'POL-0001', title: 'Quality Policy', category: 'Quality', version: '3.0', status: 'approved', owner_id: users.qm, department: 'Quality', effective_date: addMonths(T, -14), review_date: addMonths(T, 10), body: 'QualiCore is committed to delivering medical devices and services that consistently meet customer and regulatory requirements. Management provides resources, maintains a process approach, and drives continual improvement across the quality management system. All personnel are responsible for quality in their daily work.' });
  pol.risk = ins('policies', { code: 'POL-0002', title: 'Risk Management Policy', category: 'Compliance', version: '2.1', status: 'approved', owner_id: users.qm, department: 'Quality', effective_date: addMonths(T, -9), review_date: addMonths(T, -1), body: 'Risks are identified, scored on a 5x5 likelihood/severity matrix, treated, and monitored. Residual risk above the medium band requires executive acceptance and mitigation planning with defined owners and review dates.' });
  pol.supplier = ins('policies', { code: 'POL-0003', title: 'Supplier Approval & Monitoring Policy', category: 'Compliance', version: '1.4', status: 'approved', owner_id: users.qm, department: 'Supply Chain', effective_date: addMonths(T, -6), review_date: addMonths(T, 6), body: 'Suppliers of critical components require documented qualification, signed quality agreements, and periodic performance evaluation. Suppliers falling below 70% for two consecutive periods are placed on conditional status with a corrective action plan.' });
  pol.training = ins('policies', { code: 'POL-0004', title: 'Training & Competency Policy', category: 'HR', version: '2.0', status: 'approved', owner_id: users.mgr_ops, department: 'HR', effective_date: addMonths(T, -20), review_date: addMonths(T, 4), body: 'Every role has a defined competency profile. Competence is verified before independent work, reassessed periodically, and records maintained. Certification holders receive renewal reminders 60 days before expiry.' });
  pol.infosec = ins('policies', { code: 'POL-0005', title: 'Information Security Policy', category: 'Information Security', version: '1.2', status: 'in_review', owner_id: users.admin, department: 'IT', effective_date: null, review_date: addMonths(T, 1), body: 'Access to QMS data follows least-privilege. Records classified confidential or restricted have constrained distribution. System access is reviewed quarterly and terminated within 24 hours of role change.' });
  pol.safety = ins('policies', { code: 'POL-0006', title: 'Environment & Safety Policy', category: 'Safety', version: '1.0', status: 'draft', owner_id: users.mgr_ops, department: 'Operations', effective_date: null, review_date: addMonths(T, 2), body: 'The organization prevents pollution, complies with EHS legislation, and reduces waste through structured environmental objectives and monthly workplace inspections.' });

  // Goals / KPIs + entries
  const goalDefs = [
    { code: 'KPI-0001', type: 'kpi', title: 'On-time delivery rate', target: 98, unit: '%', baseline: 92.5, dir: 'higher', freq: 'monthly', pol: pol.quality, owner: users.mgr_ops, dept: 'Operations', vals: [93.1, 94.0, 93.2, 94.8, 95.1, 96.0, 95.4, 96.8] },
    { code: 'KPI-0002', type: 'kpi', title: 'First pass yield', target: 99, unit: '%', baseline: 96.2, dir: 'higher', freq: 'monthly', pol: pol.quality, owner: users.qm, dept: 'Quality', vals: [96.8, 97.1, 97.4, 97.2, 97.9, 98.1, 98.0, 98.4] },
    { code: 'KPI-0003', type: 'kpi', title: 'Customer complaints', target: 2, unit: 'per month', baseline: 5, dir: 'lower', freq: 'monthly', pol: pol.quality, owner: users.qm, dept: 'Quality', vals: [5, 4, 6, 4, 3, 3, 2, 3] },
    { code: 'KPI-0004', type: 'kpi', title: 'Non-conformance closure within 30 days', target: 95, unit: '%', baseline: 78, dir: 'higher', freq: 'monthly', pol: pol.quality, owner: users.qa1, dept: 'Quality', vals: [80, 82, 81, 84, 86, 88, 87, 90] },
    { code: 'KPI-0005', type: 'kpi', title: 'Supplier quality acceptance', target: 97, unit: '%', baseline: 93, dir: 'higher', freq: 'monthly', pol: pol.supplier, owner: users.qm, dept: 'Supply Chain', vals: [93.5, 94.2, 95.0, 94.6, 95.8, 96.1, 96.4, 96.2] },
    { code: 'KPI-0006', type: 'kpi', title: 'Training plan completion', target: 100, unit: '%', baseline: 70, dir: 'higher', freq: 'monthly', pol: pol.training, owner: users.mgr_ops, dept: 'HR', vals: [72, 75, 79, 82, 85, 88, 91, 93] },
    { code: 'KPI-0007', type: 'kpi', title: 'Equipment uptime', target: 97, unit: '%', baseline: 94, dir: 'higher', freq: 'monthly', pol: pol.quality, owner: users.mgr_eng, dept: 'Engineering', vals: [94.5, 95.0, 95.8, 96.1, 96.5, 96.2, 96.9, 97.2] },
    { code: 'OBJ-0001', type: 'objective', title: 'Achieve ISO 13485 surveillance audit zero-finding result', target: 0, unit: 'major findings', baseline: 2, dir: 'lower', freq: 'annual', pol: pol.risk, owner: users.qm, dept: 'Quality', vals: [2, 1, 1, 0] },
    { code: 'OBJ-0002', type: 'goal', title: 'Reduce average residual risk score by 20%', target: 20, unit: '% reduction', baseline: 0, dir: 'higher', freq: 'quarterly', pol: pol.risk, owner: users.qm, dept: 'Quality', vals: [4, 9, 13, 16] }
  ];
  for (const g of goalDefs) {
    const gid = ins('goals', { code: g.code, type: g.type, title: g.title, description: `Aligned to ${g.code} and reviewed ${g.freq}.`, policy_id: g.pol, owner_id: g.owner, department: g.dept, target_value: g.target, target_unit: g.unit, direction: g.dir, baseline: g.baseline, frequency: g.freq, status: 'active', review_date: addMonths(T, g.type === 'kpi' ? 1 : 3) });
    const n = g.vals.length;
    g.vals.forEach((v, i) => {
      const period = g.freq === 'monthly' ? addMonths(T, -(n - i)) : (g.freq === 'quarterly' ? `${Math.floor((n - i) / 3)}Q ahead` : String(new Date().getUTCFullYear() - (n - i)));
      const p = g.freq === 'monthly' ? addMonths(T, -(n - i)).slice(0, 7) : (g.freq === 'quarterly' ? `${new Date().getUTCFullYear()}-Q${Math.max(1, Math.ceil((new Date().getUTCMonth() + 1) / 3) - Math.floor((n - i) / 4))}` : String(new Date().getUTCFullYear() - (n - i)));
      ins('goal_entries', { goal_id: gid, period: p, value: v, note: '', recorded_by: g.owner });
    });
  }

  // Risks
  const risks = [
    { t: 'Single-source supplier for sterile barrier film', cat: 'Supply Chain', dept: 'Supply Chain', il: 4, is: 5, rl: 2, rs: 4, controls: 'Dual-sourcing project underway; 8 weeks safety stock held; quarterly supplier financial review.', treat: 'mitigate', status: 'treating', owner: users.qm },
    { t: 'Sterilization validation drift on line 2', cat: 'Compliance', dept: 'Quality', il: 3, is: 5, rl: 2, rs: 3, controls: 'Monthly BI testing; annual revalidation; automated cycle logging with alarm limits.', treat: 'mitigate', status: 'monitored', owner: users.qa1 },
    { t: 'Ransomware attack on ERP/QMS infrastructure', cat: 'Cyber', dept: 'IT', il: 3, is: 5, rl: 2, rs: 4, controls: 'Offline backups; EDR on all endpoints; MFA enforced; annual penetration test and phishing drills.', treat: 'mitigate', status: 'treating', owner: users.admin },
    { t: 'Key personnel loss in validation engineering', cat: 'Operational', dept: 'Engineering', il: 4, is: 3, rl: 3, rs: 2, controls: 'Succession plan; cross-training matrix; retention agreements for critical roles.', treat: 'mitigate', status: 'open', owner: users.mgr_eng },
    { t: 'Regulatory change: EU MDR post-market surveillance tightening', cat: 'Compliance', dept: 'Quality', il: 4, is: 4, rl: 3, rs: 3, controls: 'Regulatory watch subscription; gap assessment scheduled; notified body liaison assigned.', treat: 'mitigate', status: 'treating', owner: users.qm },
    { t: 'Raw material price volatility (resins, titanium)', cat: 'Financial', dept: 'Supply Chain', il: 4, is: 3, rl: 3, rs: 2, controls: '12-month fixed-price contracts covering 70% of volume; hedging policy for commodities.', treat: 'transfer', status: 'monitored', owner: users.mgr_ops },
    { t: 'Product contamination in cleanroom zone B', cat: 'Safety', dept: 'Operations', il: 2, is: 5, rl: 1, rs: 4, controls: 'ISO 7 cleanroom with continuous particle monitoring; gowning qualification; environmental monitoring program.', treat: 'mitigate', status: 'monitored', owner: users.mgr_ops },
    { t: 'Loss of notified body certificate', cat: 'Strategic', dept: 'Quality', il: 2, is: 5, rl: 1, rs: 5, controls: 'Strong audit performance; management review cadence; open communication channel with notified body.', treat: 'accept', status: 'monitored', owner: users.qm },
    { t: 'Data integrity gaps in batch record review', cat: 'Compliance', dept: 'Quality', il: 3, is: 4, rl: 2, rs: 3, controls: 'ALCOA+ training; second-person verification; audit trail review in quarterly quality metrics.', treat: 'mitigate', status: 'treating', owner: users.qa1 },
    { t: 'Distribution partner non-conformance handling', cat: 'Reputation', dept: 'Supply Chain', il: 3, is: 3, rl: 2, rs: 2, controls: 'Quality agreement with 48h incident reporting; annual partner audit; complaint trending.', treat: 'mitigate', status: 'open', owner: users.qm },
    { t: 'Aging HVAC system affecting cleanroom classification', cat: 'Operational', dept: 'Engineering', il: 3, is: 4, rl: 2, rs: 3, controls: 'Preventive maintenance quarterly; spare blower motors stocked; classification re-verification semi-annual.', treat: 'mitigate', status: 'treating', owner: users.mgr_eng },
    { t: 'Workplace injury during manual lifting operations', cat: 'Safety', dept: 'Operations', il: 3, is: 3, rl: 2, rs: 2, controls: 'Lifting technique training; mechanical aids installed; ergonomic assessment completed.', treat: 'mitigate', status: 'closed', owner: users.mgr_ops }
  ];
  risks.forEach((r, i) => {
    ins('risks', { code: `RSK-${pad(i + 1, 4)}`, title: r.t, description: `${r.cat} risk affecting ${r.dept}. Identified during ${i % 3 === 0 ? 'annual risk review' : i % 3 === 1 ? 'process FMEA' : 'management review'}.`, category: r.cat, department: r.dept, owner_id: r.owner, inherent_likelihood: r.il, inherent_severity: r.is, controls: r.controls, residual_likelihood: r.rl, residual_severity: r.rs, treatment: r.treat, status: r.status, review_date: addMonths(T, (i % 5) - 1), last_reviewed: addMonths(T, -3) });
  });

  // Suppliers
  const sups = [
    { name: 'PolyMed Films GmbH', cat: 'Packaging materials', status: 'approved', risk: 'critical', contact: 'Klaus Werner', email: 'k.werner@polymed.de', phone: '+49 30 555 0142', website: 'www.polymed-films.de', evals: [[92, 88, 85], [89, 90, 84], [94, 91, 88]] },
    { name: 'Titan Precision Works', cat: 'CNC machining', status: 'approved', risk: 'high', contact: 'Sarah Johnson', email: 'sarah.j@titanprecision.com', phone: '+1-555-0771', website: 'www.titanprecision.com', evals: [[85, 82, 88], [78, 75, 80], [72, 74, 77]] },
    { name: 'SteriTech Solutions Ltd', cat: 'Sterilization services', status: 'approved', risk: 'critical', contact: 'Ahmed El-Sayed', email: 'a.elsayed@steritech.co.uk', phone: '+44 20 7555 0199', website: 'www.steritech.co.uk', evals: [[95, 93, 92], [96, 94, 95], [94, 95, 93]] },
    { name: 'Nordic Electronics AB', cat: 'Electronic assemblies', status: 'conditional', risk: 'high', contact: 'Erik Larsson', email: 'erik@nordicelec.se', phone: '+46 8 555 017', website: 'www.nordicelec.se', evals: [[80, 70, 75], [68, 65, 72], [65, 62, 70]] },
    { name: 'Cardinal Chemical Co', cat: 'Raw chemicals', status: 'approved', risk: 'medium', contact: 'Maria Garcia', email: 'm.garcia@cardinalchem.com', phone: '+1-555-0334', website: 'www.cardinalchem.com', evals: [[90, 88, 91], [88, 87, 89], [91, 90, 92]] },
    { name: 'Meridian Label & Print', cat: 'Labeling & printing', status: 'pending', risk: 'low', contact: 'David Okafor', email: 'd.okafor@meridianlp.com', phone: '+1-555-0992', website: 'www.meridianlp.com', evals: [] },
    { name: 'Alpine Tooling SA', cat: 'Tooling & fixtures', status: 'approved', risk: 'medium', contact: 'Luca Bianchi', email: 'l.bianchi@alpinetooling.ch', phone: '+41 26 555 011', website: 'www.alpinetooling.ch', evals: [[87, 90, 86], [89, 88, 87]] }
  ];
  const supIds = [];
  sups.forEach((s, i) => {
    const sid = ins('suppliers', { code: `SUP-${pad(i + 1, 4)}`, name: s.name, category: s.cat, status: s.status, contact_name: s.contact, email: s.email, phone: s.phone, website: s.website, risk_level: s.risk, qualification_date: s.status === 'pending' ? null : addMonths(T, -(6 + i * 3)), next_audit: addMonths(T, (i % 4) * 2 - 1), approved_by: s.status === 'pending' ? null : users.qm, notes: s.risk === 'critical' ? 'Critical supplier - full QA agreement in place.' : '' });
    supIds.push(sid);
    s.evals.forEach((e, j) => {
      ins('supplier_evaluations', { supplier_id: sid, period: addMonths(T, -(s.evals.length - j)).slice(0, 7), quality_score: e[0], delivery_score: e[1], communication_score: e[2], total_score: Math.round((e[0] + e[1] + e[2]) / 3 * 10) / 10, notes: (e[0] + e[1] + e[2]) / 3 < 75 ? 'Performance below threshold - CAPA required.' : '', evaluator_id: users.qa1 });
    });
  });
  ins('supplier_incidents', { supplier_id: supIds[3], incident_date: addMonths(T, -1), description: 'Two deliveries of PCB assemblies with missing conformity certificates.', impact: 'Line stoppage 4 hours', severity: 'major', status: 'open', action_taken: 'Supplier 8D report requested; incoming inspection tightened.' });
  ins('supplier_incidents', { supplier_id: supIds[1], incident_date: addMonths(T, -4), description: 'Dimensional drift on titanium fixtures beyond tolerance.', impact: 'Rework of 120 parts', severity: 'minor', status: 'closed', action_taken: 'Supplier corrected tool offset; SPC monitoring reinstated.' });

  // Competencies + assessments
  const compDefs = [
    ['Good Documentation Practice (GDP)', 'Compliance', 3], ['ISO 13485 Internal Auditor', 'Compliance', 4], ['Cleanroom Gowning & Behavior', 'Operations', 3],
    ['Sterilization Process Operation', 'Operations', 4], ['Risk Management (ISO 14971)', 'Quality', 4], ['Statistical Process Control', 'Quality', 3],
    ['Forklift Operation License', 'Operations', 3], ['First Aid Response', 'Safety', 2], ['CAD Design (SolidWorks)', 'Engineering', 4],
    ['Data Integrity & ALCOA+', 'Compliance', 3], ['Electrical Safety (LOTO)', 'Engineering', 4], ['ERP System Operation', 'Operations', 2]
  ];
  const compIds = compDefs.map((c, i) => ins('competencies', { code: `CMP-${pad(i + 1, 4)}`, name: c[0], category: c[1], description: `${c[0]} competency. Required level ${c[2]} of 5.`, required_level: c[2] }));

  const assess = [
    [emp.lena, 0, 4, -20, 10], [emp.lena, 4, 4, -12, 14], [emp.lena, 9, 5, -8, 16],
    [emp.sofia, 2, 3, -10, 26], [emp.sofia, 3, 3, -9, -20], [emp.sofia, 0, 3, -15, 15],
    [emp.james, 10, 4, -7, 24], [emp.james, 5, 3, -11, 19], [emp.james, 6, 3, -30, 25],
    [emp.nina, 2, 3, -6, 24], [emp.nina, 3, 2, -5, 23], [emp.nina, 11, 2, -4, 20],
    [emp.marcus, 1, 5, -14, 10], [emp.marcus, 9, 4, -10, 14],
    [emp.grace, 8, 5, -18, 18], [emp.grace, 4, 3, -9, 15],
    [emp.victor, 6, 4, -24, 6], [emp.victor, 7, 3, -20, 16],
    [emp.omar, 0, 3, -13, 11], [emp.omar, 11, 3, -12, 12],
    [emp.priya, 0, 4, -22, 8], [emp.priya, 5, 4, -16, 20],
    [emp.tom, 10, 5, -10, 22], [emp.tom, 8, 4, -21, 9],
    [emp.daniel, 4, 5, -11, 13], [emp.daniel, 1, 5, -9, 15], [emp.daniel, 0, 5, -19, 17]
  ];
  assess.forEach((a, i) => {
    ins('assessments', { code: `ASM-${pad(i + 1, 4)}`, employee_id: a[0], competency_id: compIds[a[1]], level: a[2], assessment_date: addMonths(T, a[3]), expiry_date: a[4] > 0 ? addMonths(T, a[4]) : null, assessor_id: users.qm, notes: a[2] >= compDefs[a[1]][2] ? 'Meets required level.' : 'Below required level - development plan active.' });
  });

  // Trainings
  const trnDefs = [
    ['Annual Data Integrity Refresher (ALCOA+)', 'Internal Quality Academy', 'compliance', 0, 2, 'completed'],
    ['ISO 14971 Risk Management Workshop', 'TÜV Rheinland Academy', 'technical', 1, 8, 'completed'],
    ['Cleanroom Behavior Recertification', 'Internal Quality Academy', 'compliance', -1, 4, 'completed'],
    ['SPC & Process Capability Advanced', 'QualityTraining Pro', 'technical', 2, 16, 'scheduled'],
    ['Emergency Response & Evacuation Drill', 'Internal EHS', 'safety', 1, 2, 'scheduled'],
    ['New Employee QMS Induction', 'Internal Quality Academy', 'induction', -2, 6, 'completed']
  ];
  const trnIds = trnDefs.map((t, i) => ins('trainings', { code: `TRN-${pad(i + 1, 4)}`, title: t[0], provider: t[1], type: t[2], scheduled_date: addDays(T, t[3] * 30), hours: t[4], status: t[5], notes: '' }));
  const tparts = [
    [0, emp.lena, 'completed', 95], [0, emp.sofia, 'completed', 92], [0, emp.james, 'completed', 88], [0, emp.nina, 'completed', 90],
    [1, emp.daniel, 'completed', 97], [1, emp.marcus, 'completed', 94], [1, emp.lena, 'completed', 89],
    [2, emp.sofia, 'completed', 96], [2, emp.nina, 'completed', 91], [2, emp.victor, 'attended', null],
    [3, emp.lena, 'invited', null], [3, emp.priya, 'invited', null],
    [4, emp.sofia, 'invited', null], [4, emp.james, 'invited', null], [4, emp.nina, 'invited', null],
    [5, emp.nina, 'completed', 88]
  ];
  tparts.forEach(p => ins('training_participants', { training_id: trnIds[p[0]], employee_id: p[1], status: p[2], score: p[3] }));

  // Records
  const recDefs = [
    ['Batch Manufacturing Records 2026', 'Production', 'electronic', 'internal', 15, 'active', 'ERP archive vault'],
    ['Sterilization Batch Records', 'Production', 'electronic', 'confidential', 15, 'active', 'ERP archive vault'],
    ['Management Review Minutes', 'Quality', 'electronic', 'internal', 10, 'active', 'QMS / Management Review'],
    ['Supplier Quality Agreements', 'Supply Chain', 'electronic', 'confidential', 10, 'active', 'QMS / Suppliers'],
    ['Customer Complaint Files', 'Quality', 'hybrid', 'restricted', 15, 'active', 'QMS / Complaints (access-controlled)'],
    ['Training & Certification Records', 'HR', 'electronic', 'internal', 10, 'active', 'QMS / Competency'],
    ['Calibration Certificates', 'Engineering', 'electronic', 'internal', 7, 'active', 'QMS / Equipment'],
    ['Internal Audit Reports 2024-2026', 'Quality', 'electronic', 'internal', 6, 'active', 'QMS / Audits'],
    ['Design History File - FusionX Pump', 'Engineering', 'electronic', 'restricted', 20, 'active', 'QMS / Design Reviews'],
    ['Environmental Monitoring Logs', 'Operations', 'paper', 'internal', 5, 'active', 'Cleanroom documentation room']
  ];
  recDefs.forEach((r, i) => ins('records', { code: `REC-${pad(i + 1, 4)}`, title: r[0], category: r[1], format: r[2], owner_id: [users.qa1, users.mgr_ops, users.qm, users.qm, users.qm, users.mgr_ops, users.mgr_eng, users.auditor, users.mgr_eng, users.mgr_ops][i], department: r[1], confidentiality: r[3], retention_years: r[4], status: r[5], retention_until: addMonths(T, 12 * r[4] - 24), location: r[6], description: `Controlled record series with defined retention of ${r[4]} years.` }));

  // Documents
  const docDefs = [
    ['Quality Manual', 'Manual', 'Quality', 'approved', '5.2', users.qm, -30, 6],
    ['Document Control Procedure', 'Procedure', 'Quality', 'approved', '4.0', users.qa1, -18, 8],
    ['Risk Management Procedure', 'Procedure', 'Quality', 'approved', '3.1', users.qm, -12, 0],
    ['Supplier Evaluation Procedure', 'Procedure', 'Supply Chain', 'approved', '2.2', users.qm, -8, 10],
    ['Nonconformance & CAPA Procedure', 'Procedure', 'Quality', 'approved', '3.4', users.qa1, -6, 12],
    ['Cleanroom Operations Work Instruction', 'Work Instruction', 'Operations', 'approved', '2.0', users.mgr_ops, -15, 4],
    ['Sterilization Validation Protocol VP-118', 'Protocol', 'Engineering', 'in_review', '0.3', users.mgr_eng, null, 1],
    ['Calibration Management Procedure', 'Procedure', 'Engineering', 'approved', '1.8', users.mgr_eng, -22, -1],
    ['FusionX Design Requirements Specification', 'Specification', 'Engineering', 'approved', '2.1', users.mgr_eng, -9, 5],
    ['Obsolete: Paper Batch Record Template (2019)', 'Form', 'Quality', 'obsolete', '1.9', users.qa1, -48, null]
  ];
  const docIds = [];
  docDefs.forEach((d, i) => {
    const did = ins('documents', { code: `DOC-${pad(i + 1, 4)}`, title: d[0], category: d[1], department: d[2], owner_id: d[5], status: d[3], version: d[4], effective_date: d[6] === null ? null : addMonths(T, d[6]), review_date: d[7] === null ? null : addMonths(T, d[7]), change_summary: d[3] === 'approved' ? 'Periodic review - no changes required.' : 'Initial draft.', description: `${d[1]} covering ${d[0].toLowerCase()} requirements.` });
    docIds.push(did);
    if (d[3] !== 'draft') ins('document_versions', { document_id: did, version: d[4], change_summary: d[3] === 'obsolete' ? 'Superseded by electronic batch records.' : (d[3] === 'approved' ? 'Periodic review confirmation.' : 'Draft for review.'), status: d[3] === 'approved' ? 'approved' : d[3], approved_by: d[3] === 'approved' ? users.qm : null, approved_at: d[3] === 'approved' ? addMonths(T, d[6]) : null });
    const major = Math.max(1, Math.floor(parseFloat(d[4])) - 1);
    if (major >= 1 && d[3] !== 'draft') ins('document_versions', { document_id: did, version: `${major}.0`, change_summary: 'Previous revision (superseded).', status: 'superseded', approved_by: users.qm, approved_at: addMonths(T, (d[6] || -6) - 18) });
  });

  // Design reviews
  const dr1 = ins('design_reviews', { code: 'DR-0001', project: 'FusionX Infusion Pump', title: 'PDR - Preliminary Design Review', stage: 'concept', review_date: addMonths(T, -8), chair_id: users.mgr_eng, status: 'closed', summary: 'Concept reviewed against user needs. 3 findings raised, all closed. Proceed to detailed design approved.' });
  const dr2 = ins('design_reviews', { code: 'DR-0002', project: 'FusionX Infusion Pump', title: 'DDR - Detailed Design Review', stage: 'detailed design', review_date: addMonths(T, -3), chair_id: users.mgr_eng, status: 'closed', summary: 'Detailed design verified against requirements. Occlusion mechanism redesign completed. Verified.' });
  const dr3 = ins('design_reviews', { code: 'DR-0003', project: 'FusionX Infusion Pump', title: 'VDR - Verification Design Review', stage: 'verification', review_date: addDays(T, 12), chair_id: users.mgr_eng, status: 'planned', summary: '' });
  const reqs = [
    [dr1, 'Deliver flow rate accuracy ±5% across 1-1000 mL/h', 'Bench verification per protocol VP-101', 'pass'],
    [dr1, 'Battery operation for minimum 24h at 100 mL/h', 'Battery discharge test', 'pass'],
    [dr1, 'Air-in-line detection sensitivity ≤ 50 µL', 'Bubble challenge test', 'fail'],
    [dr2, 'Occlusion pressure alarm within 30s', 'Pressure ramp test', 'pass'],
    [dr2, 'IEC 60601-1 electrical safety compliance', 'Certified lab report', 'pass'],
    [dr2, 'Drop resistance 1m onto hardwood, 6 orientations', 'Drop test protocol', 'pass'],
    [dr3, 'EMC immunity per IEC 60601-1-2', 'EMC chamber testing', 'open'],
    [dr3, 'Biocompatibility ISO 10993-1 evaluation', 'Material certificate review + testing', 'open'],
    [dr3, 'Usability per IEC 62366 validation', 'Formative + summative studies', 'open']
  ];
  reqs.forEach(r => ins('design_requirements', { review_id: r[0], requirement: r[1], acceptance_criteria: r[2], verification_method: r[2], status: r[3] }));
  ins('design_findings', { review_id: dr1, description: 'Air-in-line sensor sensitivity marginal at low flow rates; tolerance stack-up analysis required.', severity: 'major', owner_id: users.mgr_eng, status: 'closed', due_date: addMonths(T, -7) });
  ins('design_findings', { review_id: dr2, description: ' housing filament material flammability rating to be confirmed with supplier.', severity: 'minor', owner_id: users.mgr_eng, status: 'closed', due_date: addMonths(T, -2) });
  ins('design_findings', { review_id: dr2, description: 'User interface alarm volume below IEC 60601-1-8 minimum in high ambient noise.', severity: 'major', owner_id: users.mgr_eng, status: 'in_progress', due_date: addDays(T, 9) });

  // Equipment
  const eqDefs = [
    ['Ethylene Oxide Sterilizer EOL-2', 'Sterilization', 'SteriCorp', 'EO-4500X', 'EO-4500-2211', 'Sterilization Suite', 'operational', 1, 90, -80, 10, -30, 30, users.qa1],
    ['CNC Milling Center HAAS-4', 'Machining', 'Haas', 'VF-2SS', 'HAAS-VF2-8891', 'Machine Shop', 'operational', 0, null, null, null, -20, 35, users.mgr_eng],
    ['Cleanroom Particle Counter', 'Monitoring', 'Lighthouse', 'Apex Z50', 'LH-AZ-3342', 'Cleanroom Zone B', 'operational', 1, 180, -170, 10, null, null, users.mgr_ops],
    ['Universal Testing Machine UTM-1', 'Testing', 'Instron', '5969', 'INS-5969-0042', 'Materials Lab', 'under_maintenance', 1, 365, -350, 15, -5, 25, users.mgr_eng],
    ['Autoclave AV-3', 'Sterilization', 'Tuttnauer', '5075ELV', 'TT-5075-1176', 'Micro Lab', 'operational', 1, 60, -55, 5, -25, 30, users.qa1],
    ['Laser Marking System LM-1', 'Marking', 'Trumpf', 'TruMark 5020', 'TR-TM5020-771', 'Marking Cell', 'operational', 0, null, null, null, -40, 45, users.mgr_ops],
    ['Coordinate Measuring Machine CMM-2', 'Inspection', 'Zeiss', 'Contura G2', 'ZS-CG2-5580', 'Inspection Lab', 'under_qualification', 1, 365, null, null, null, null, users.qa1],
    ['Balancing Scale BS-5 (Class I)', 'Weighing', 'Mettler', 'XPR226DR', 'MT-XPR-9912', 'Calibration Lab', 'operational', 1, 30, -28, 2, null, null, users.qa1]
  ];
  const eqIds = [];
  eqDefs.forEach((e, i) => {
    const eid = ins('equipment', { code: `EQ-${pad(i + 1, 4)}`, name: e[0], type: e[1], manufacturer: e[2], model: e[3], serial: e[4], location: e[5], status: e[6], installed_on: addMonths(T, -36 - i * 4), requires_calibration: e[7], calibration_interval_days: e[8], last_calibration: e[9] === null ? null : addDays(T, e[9]), next_calibration: (e[8] && e[9] !== null) ? addDays(T, e[10]) : null, last_maintenance: e[11] === null ? null : addDays(T, e[11]), next_maintenance: e[12] === null ? null : addDays(T, e[12]), owner_id: e[13] });
    eqIds.push(eid);
    ins('equipment_qualifications', { equipment_id: eid, type: 'IQ', status: 'pass', performed_by: users.mgr_eng, performed_on: addMonths(T, -36 - i * 4), result: 'All installation criteria met.', notes: '' });
    ins('equipment_qualifications', { equipment_id: eid, type: 'OQ', status: 'pass', performed_by: users.mgr_eng, performed_on: addMonths(T, -35 - i * 4), result: 'Operational ranges verified.', notes: '' });
    if (e[6] === 'under_qualification') ins('equipment_qualifications', { equipment_id: eid, type: 'PQ', status: 'pending', performed_by: null, performed_on: null, result: '', notes: 'PQ protocol under execution - 3 runs scheduled.' });
    else ins('equipment_qualifications', { equipment_id: eid, type: 'PQ', status: 'pass', performed_by: users.qa1, performed_on: addMonths(T, -34 - i * 4), result: 'Consistent performance across 3 runs.', notes: '' });
  });

  // Nonconformances / incidents / CAPA
  const ncDefs = [
    ['nc', 'Sterile barrier seal integrity failure on lot 2026-0812', 'internal', 'Line 3', 'major', 'Operations', null, users.qa1, users.mgr_ops, 'investigation', -12, 'Improper sealing temperature during shift change identified as likely cause. Full lot quarantined (4,200 units).'],
    ['nc', 'Dimensional nonconformance on titanium bracket T-77', 'internal', 'Lot T77-4471', 'minor', 'Engineering', null, users.qa1, users.mgr_eng, 'action_plan', -25, 'Supplier tool wear caused 0.02mm drift beyond tolerance on 120 parts.'],
    ['incident', 'Cleanroom door propped open violating pressure cascade', 'internal', 'Zone B', 'minor', 'Operations', null, users.emp1, users.mgr_ops, 'closed', -40, 'Contractor propped door during HVAC filter change. Pressure deviation 12 Pa for 6 minutes.'],
    ['incident', 'Forklift near-miss in warehouse aisle 4', 'internal', 'Warehouse', 'minor', 'Operations', null, users.emp2, users.mgr_ops, 'verification', -18, 'Near-miss between forklift and pedestrian. No injury. Layout and right-of-way rules reviewed.'],
    ['nc', 'Missing conformity certificates with PCB delivery', 'supplier', 'PO-88213', 'major', 'Supply Chain', supIds[3], users.qa1, users.qm, 'investigation', -30, 'Two consecutive deliveries from Nordic Electronics AB without CoC.'],
    ['capa', 'CAPA: Recurring label misprints on line 2', 'internal', 'Complaint trend', 'major', 'Operations', null, users.qm, users.mgr_ops, 'verification', -55, 'Root cause: label template version mismatch after ERP update. Corrective: template governance rule. Preventive: automated version check before print release.'],
    ['nc', 'Environmental monitoring excursions in Zone B', 'internal', 'Week 32', 'minor', 'Operations', null, users.qa1, users.mgr_ops, 'closed', -70, 'Two CFU excursions above action level. Additional cleaning cycle validated; trend recovered.'],
    ['incident', 'Customer complaint - pump display flicker', 'customer', 'COMP-2291', 'minor', 'Quality', null, users.qa1, users.qm, 'action_plan', -20, 'Display connector intermittent contact reported by hospital. Field service replaced unit.'],
    ['nc', 'Out-of-tolerance calibration found on scale BS-3', 'internal', 'CAL-2026-044', 'minor', 'Engineering', null, users.qa1, users.mgr_eng, 'closed', -90, 'Scale found 0.4% out of tolerance during periodic calibration. Impact assessment: no affected product released.'],
    ['capa', 'CAPA: Training completion below target in Operations', 'internal', 'KPI-0006', 'minor', 'Operations', null, users.qm, users.mgr_ops, 'action_plan', -35, 'Training completion at 82% vs 100% target. Root cause: scheduling conflicts during peak production.'],
    ['nc', 'Document review overdue - Calibration procedure', 'audit', 'AUD-0002', 'minor', 'Quality', null, users.auditor, users.qm, 'investigation', -15, 'Calibration Management Procedure exceeded 12-month review cycle.'],
    ['incident', 'Chemical spill < 1L in materials lab', 'internal', 'Materials Lab', 'minor', 'Operations', null, users.emp2, users.mgr_eng, 'closed', -60, 'Isopropanol bottle knocked over. Spill kit deployed. No environmental release.']
  ];
  const ncIds = [];
  ncDefs.forEach((n, i) => {
    const code = (n[0] === 'capa' ? 'CAPA-' : n[0] === 'incident' ? 'INC-' : 'NC-') + pad(i + 1, 4);
    const closed = n[9] === 'closed';
    const nid = ins('nonconformances', { code, type: n[0], title: n[1], description: n[11], source: n[2], source_ref: n[3], severity: n[4], department: n[5], supplier_id: n[6], raised_by: n[7], owner_id: n[8], occurred_at: addDays(T, n[10]), status: n[9], root_cause: n[9] === 'open' ? '' : (n[0] === 'capa' ? ((n[11].split('Root cause:')[1] || '').split('.')[0] + '.') || 'Under structured RCA using 5-Why and fishbone analysis.' : 'Contributing factors identified through investigation.'), root_cause_category: ['process', 'human', 'equipment', 'materials', 'method'][i % 5], correction: n[9] === 'open' ? '' : 'Immediate containment applied per procedure.', preventive_action: n[0] === 'capa' ? 'Systemic preventive measures deployed and effectiveness checked.' : '', verified_by: closed ? users.qm : null, verified_at: closed ? addDays(T, n[10] + 14) : null, closed_at: closed ? addDays(T, n[10] + 21) : null });
    ncIds.push(nid);
  });

  // Audits
  const audDefs = [
    ['Internal Audit - Production & Cleanroom Q2', 'internal', 'ISO 13485:2016', 'Cleanroom operations, batch records, environmental monitoring', 'Operations', users.auditor, null, 'closed', -75, -75, 'minor_nc', '3 minor findings, 2 observations. Overall conformant with improvement opportunities.'],
    ['Supplier Audit - PolyMed Films GmbH', 'supplier', 'ISO 9001:2015', 'Film extrusion, QC laboratory, traceability', 'Supply Chain', users.auditor, supIds[0], 'closed', -50, -50, 'conformant', 'Well-managed quality system. No findings. Two improvement suggestions noted.'],
    ['Notified Body Surveillance Audit', 'external', 'ISO 13485:2016 / MDR', 'Full QMS surveillance - design, production, PMS', 'Quality', users.auditor, null, 'closed', -20, -20, 'minor_nc', 'One minor NC (document review timeliness). CAPA opened. Certificate maintained.'],
    ['Internal Audit - Design Controls Q3', 'internal', 'ISO 13485:2016', 'Design planning, inputs/outputs, reviews, V&V, transfer', 'Engineering', users.auditor, null, 'in_progress', 7, null, null, ''],
    ['Supplier Audit - Nordic Electronics AB', 'supplier', 'ISO 9001:2015', 'PCB assembly, ESD controls, outgoing inspection', 'Supply Chain', users.auditor, supIds[3], 'planned', 21, null, null, '']
  ];
  const audIds = [];
  audDefs.forEach((a, i) => {
    const aid = ins('audits', { code: `AUD-${pad(i + 1, 4)}`, title: a[0], type: a[1], standard: a[2], scope: a[3], department: a[4], lead_auditor_id: a[5], supplier_id: a[6], status: a[7], planned_date: addDays(T, a[8]), conducted_on: a[9] === null ? null : addDays(T, a[9]), result: a[10], summary: a[11] });
    audIds.push(aid);
    if (i === 0) {
      ins('audit_items', { audit_id: aid, clause: '6.2', requirement: 'Quality objectives maintained and monitored', finding_type: 'observation', description: 'Objectives displayed but not updated since Q4 last year.', owner_id: users.qm, status: 'closed', due_date: addDays(T, -60) });
      ins('audit_items', { audit_id: aid, clause: '7.1.5.2', requirement: 'Calibration records completeness', finding_type: 'minor', description: 'Two calibration certificates missing traceability reference.', owner_id: users.mgr_eng, status: 'closed', due_date: addDays(T, -58) });
      ins('audit_items', { audit_id: aid, clause: '8.5.1', requirement: 'Cleanroom gowning compliance', finding_type: 'minor', description: 'One operator observed with incomplete gowning during break return.', owner_id: users.mgr_ops, status: 'closed', due_date: addDays(T, -55) });
    }
    if (i === 2) {
      ins('audit_items', { audit_id: aid, clause: '7.5.3', requirement: 'Document review timeliness', finding_type: 'minor', description: 'Calibration Management Procedure exceeded review cycle.', owner_id: users.qm, status: 'in_progress', due_date: addDays(T, 5) });
    }
  });

  // Compliance requirements
  const crDefs = [
    ['ISO 9001:2015', '4.4', 'QMS processes and interaction defined', 'compliant'],
    ['ISO 9001:2015', '6.1', 'Risks and opportunities addressed', 'compliant'],
    ['ISO 9001:2015', '9.3', 'Management review conducted at planned intervals', 'compliant'],
    ['ISO 13485:2016', '7.2', 'Competence documented for QMS roles', 'partially'],
    ['ISO 13485:2016', '7.4.2', 'Supplier agreements for critical suppliers', 'compliant'],
    ['ISO 13485:2016', '8.2.4', 'Adverse event reporting procedures', 'compliant'],
    ['EU MDR 2017/745', 'Article 83', 'Post-market surveillance system', 'partially'],
    ['EU MDR 2017/745', 'Article 87', 'Serious incident reporting timeline (15 days)', 'compliant'],
    ['FDA 21 CFR 820', '820.100', 'CAPA procedures and documentation', 'compliant'],
    ['ISO 27001:2022', 'A.8.13', 'Information backup policy and testing', 'non_compliant'],
    ['GDPR', 'Art. 30', 'Records of processing activities', 'not_assessed']
  ];
  crDefs.forEach((c, i) => ins('compliance_requirements', { code: `CR-${pad(i + 1, 4)}`, framework: c[0], clause: c[1], title: c[2], description: `${c[0]} clause ${c[1]}: ${c[2].toLowerCase()}.`, status: c[3], owner_id: [users.qm, users.qm, users.qm, users.mgr_ops, users.qm, users.qm, users.qm, users.qm, users.qa1, users.admin, users.admin][i], last_assessed: addMonths(T, -2 - (i % 4)), next_review: addMonths(T, (i % 5) - 1), evidence: c[3] === 'compliant' ? 'Procedure reference and records verified.' : 'Gap identified - see linked action.' }));

  // Actions (cross-module)
  const actDefs = [
    ['Dual-source qualification for sterile barrier film', 'risk', 'RSK-0001', users.qm, 'high', 21, 'in_progress'],
    ['Execute PQ protocol for CMM-2 (3 runs)', 'equipment', 'EQ-0007', users.qa1, 'high', 10, 'in_progress'],
    ['Resolve PCB CoC omissions with Nordic Electronics', 'nonconformance', 'NC-0005', users.qm, 'critical', 4, 'open'],
    ['Update Calibration Management Procedure DOC-0008', 'document', 'DOC-0008', users.mgr_eng, 'high', -2, 'open'],
    ['Complete design VDR preparation pack', 'design', 'DR-0003', users.mgr_eng, 'medium', 11, 'in_progress'],
    ['Close CAPA label template governance verification', 'nonconformance', 'CAPA-0006', users.qm, 'high', 7, 'in_progress'],
    ['Renew forklift license for Victor Alvarez', 'competency', 'ASM-0018', users.mgr_ops, 'medium', 6, 'open'],
    ['Conduct supplier audit Nordic Electronics AB', 'audit', 'AUD-0005', users.auditor, 'high', 21, 'open'],
    ['Implement backup testing per ISO 27001 A.8.13', 'compliance', 'CR-0010', users.admin, 'critical', 14, 'open'],
    ['Training schedule optimization for Operations', 'nonconformance', 'CAPA-0010', users.mgr_ops, 'medium', 17, 'in_progress'],
    ['Verify alarm volume fix for FusionX UI', 'design', 'DR-0002', users.mgr_eng, 'high', 9, 'open'],
    ['HVAC preventive maintenance quarterly service', 'equipment', 'EQ-0003', users.emp2, 'medium', 3, 'open'],
    ['Follow up MDR PMS gap assessment', 'compliance', 'CR-0007', users.qm, 'high', 28, 'open'],
    ['Complete internal audit Design Controls Q3', 'audit', 'AUD-0004', users.auditor, 'high', 7, 'in_progress'],
    ['Review Information Security Policy to approval', 'policy', 'POL-0005', users.admin, 'medium', 12, 'open'],
    ['Quarantine disposition for NC lot 2026-0812', 'nonconformance', 'NC-0001', users.mgr_ops, 'critical', 2, 'in_progress'],
    ['Update supplier evaluation report Q3', 'supplier', 'SUP-0004', users.qa1, 'high', 5, 'open'],
    ['Repair and requalify UTM-1', 'equipment', 'EQ-0004', users.mgr_eng, 'high', 20, 'in_progress'],
    ['Draft Environment & Safety Policy for review', 'policy', 'POL-0006', users.mgr_ops, 'low', 45, 'open'],
    ['GDPR records of processing assessment', 'compliance', 'CR-0011', users.admin, 'medium', 60, 'open'],
    ['Effectiveness check - EM excursion CAPA', 'nonconformance', 'NC-0007', users.qa1, 'medium', -5, 'completed'],
    ['Confirm housing material flammability rating', 'design', 'DR-0002', users.mgr_eng, 'medium', -8, 'completed'],
    ['Publish updated SOP for cleanroom gowning', 'document', 'DOC-0006', users.mgr_ops, 'low', -12, 'completed'],
    ['Annual risk register refresh workshop', 'risk', 'RSK-0005', users.qm, 'medium', 30, 'open'],
    ['Scale BS-3 impact assessment documentation', 'nonconformance', 'NC-0009', users.mgr_eng, 'low', -20, 'verified'],
    ['KPI dashboard automation improvement', 'goal', 'KPI-0004', users.qa1, 'low', 40, 'open'],
    ['Notify body response letter for minor NC', 'audit', 'AUD-0003', users.qm, 'high', -3, 'completed'],
    ['Sterilizer EOL-2 gasket replacement', 'equipment', 'EQ-0001', users.emp2, 'medium', 33, 'open']
  ];
  actDefs.forEach((a, i) => {
    const done = a[6] === 'completed' || a[6] === 'verified';
    ins('actions', { code: `ACT-${pad(i + 1, 4)}`, title: a[0], description: `Action generated from ${a[1]} ${a[2]} to maintain QMS conformance.`, source_type: a[1], source_id: a[2], source_code: a[2], owner_id: a[3], priority: a[4], due_date: addDays(T, a[5]), status: a[6], completed_at: done ? addDays(T, a[5] - 2) : null, verification_notes: a[6] === 'verified' ? 'Effectiveness verified by QA after 30-day monitoring period.' : '', verified_by: a[6] === 'verified' ? users.qm : null, created_by: users.qm });
  });

  // Management review
  ins('management_reviews', { code: 'MR-0001', title: 'Management Review Q2 2026', review_date: addMonths(T, -3), chair_id: users.qm, attendees: 'D. Reyes, P. Sharma, T. Becker, A. Osei, M. Chen', status: 'issued', summary: 'QMS effective. KPIs trending positive. Focus areas: supplier Nordic Electronics performance, training completion, backup compliance gap.', inputs: null });
  ins('management_reviews', { code: 'MR-0002', title: 'Management Review Q3 2026', review_date: addDays(T, 14), chair_id: users.qm, attendees: 'D. Reyes, P. Sharma, T. Becker, A. Osei', status: 'draft', summary: '', inputs: null });

  // Comments + notifications
  ins('comments', { entity_type: 'nonconformances', entity_id: String(ncIds[0]), user_id: users.qm, body: 'Quarantine confirmed. Extended seal strength testing scheduled for tomorrow.' });
  ins('comments', { entity_type: 'risks', entity_id: '1', user_id: users.mgr_ops, body: 'Second source samples received - qualification build starting next week.' });
  ins('notifications', { user_id: users.qm, title: 'Action overdue', body: 'ACT-0004 "Update Calibration Management Procedure" is overdue.', link: '/actions', severity: 'warning' });
  ins('notifications', { user_id: users.qm, title: 'Certification expiring', body: 'Forklift license (Victor Alvarez) expires in 6 days.', link: '/competency/assessments', severity: 'warning' });
  ins('notifications', { user_id: users.admin, title: 'Backup compliance gap', body: 'ISO 27001 A.8.13 backup testing is non-compliant. Action created.', link: '/compliance', severity: 'critical' });
  ins('notifications', { user_id: users.mgr_eng, title: 'Calibration due', body: 'UTM-1 calibration certificate expires in 15 days.', link: '/equipment', severity: 'info' });
  ins('notifications', { user_id: users.qm, title: 'Document review due', body: 'DOC-0003 Risk Management Procedure review is overdue.', link: '/documents', severity: 'warning' });

  ins('audit_log', { user_id: users.admin, user_name: 'System', action: 'seed', entity_type: 'system', entity_id: null, entity_label: 'Database initialized', details: 'Demo dataset loaded', ip: 'local', created_at: new Date().toISOString() });
  ins('webhooks', { url: 'https://example.com/hooks/qms', events: 'nonconformance.created,action.overdue', active: 1, secret: '', description: 'Example integration endpoint (demo)' });

  console.log('Seed complete.');
}

if (require.main === module) {
  initSchema();
  seed();
  console.log('DB ready at', config.dbFile);
} else {
  initSchema();
  seed();
}

module.exports = db;
