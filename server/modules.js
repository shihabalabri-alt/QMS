// Central module registry: drives generic CRUD, permissions, workflows, UI pages, search and the AI brain.
const ROLES = ['admin', 'quality_manager', 'risk_manager', 'compliance_manager', 'doc_controller', 'competency_manager', 'supplier_manager', 'equipment_manager', 'management', 'manager', 'qa', 'investigator', 'auditor', 'employee'];

const ROLE_LABELS = {
  admin: 'Administrator', quality_manager: 'Quality Manager', risk_manager: 'Risk Manager',
  compliance_manager: 'Compliance Manager', doc_controller: 'Document Controller',
  competency_manager: 'Competency Manager', supplier_manager: 'Supplier Manager',
  equipment_manager: 'Equipment Manager', management: 'Executive Management', manager: 'Line Manager',
  qa: 'QA / Investigator', investigator: 'Investigator', auditor: 'Auditor', employee: 'Standard User'
};

// Permission groups
const G = {
  exec: ['admin', 'quality_manager', 'management'],                                   // final approvers
  quality: ['admin', 'quality_manager'],                                              // QMS owners
  leaders: ['admin', 'quality_manager', 'management', 'manager'],                     // leadership
  staff: ['admin', 'quality_manager', 'management', 'manager', 'qa', 'investigator'], // QMS working level
  auditors: ['admin', 'quality_manager', 'management', 'manager', 'qa', 'investigator', 'auditor']
};

const W = {
  crudAll: G.staff,
  crudQuality: G.quality,
  auditCreate: G.auditors,
  approveExecutive: G.exec,
  approveQuality: G.exec
};

const usersRef = { type: 'ref', table: 'users', label: 'name', hint: 'System user' };
const employeesRef = { type: 'ref', table: 'employees', label: 'name' };

function f(name, label, type, extra) { return Object.assign({ name, label, type: type || 'text' }, extra || {}); }

const MODULES = {
  policies: {
    title: 'Policies', table: 'policies', prefix: 'POL', icon: 'policy',
    desc: 'Policies & objectives framework',
    perms: { read: 'all', create: [...G.leaders, 'compliance_manager'], update: [...G.leaders, 'compliance_manager'], delete: G.quality },
    statuses: ['draft', 'in_review', 'approved', 'obsolete'],
    transitions: { draft: ['in_review'], in_review: ['draft', 'approved'], approved: ['obsolete'], obsolete: [] },
    approveRole: [...G.exec, 'compliance_manager'],
    list: [
      { name: 'code', label: 'Code' }, { name: 'title', label: 'Title', flex: 2 }, { name: 'category', label: 'Category' },
      { name: 'version', label: 'Ver' }, { name: 'status', label: 'Status', type: 'status' }, { name: 'owner_id', label: 'Owner', type: 'user' },
      { name: 'effective_date', label: 'Effective', type: 'date' }, { name: 'review_date', label: 'Review due', type: 'date' }
    ],
    fields: [
      f('title', 'Title', 'text', { required: true, span: 2 }),
      f('category', 'Category', 'select', { options: ['Quality', 'Compliance', 'HR', 'Information Security', 'Safety', 'Environment', 'Operations'] }),
      f('version', 'Version'),
      f('status', 'Status', 'select', { options: ['draft', 'in_review', 'approved', 'obsolete'] }),
      f('owner_id', 'Owner', 'ref', { ref: usersRef }),
      f('department', 'Department', 'select', { options: ['Quality', 'Operations', 'Engineering', 'Supply Chain', 'HR', 'IT', 'Finance'] }),
      f('effective_date', 'Effective date', 'date'),
      f('review_date', 'Next review', 'date'),
      f('body', 'Policy statement', 'textarea', { span: 2 })
    ],
    search: ['code', 'title', 'body', 'category'],
    dueField: 'review_date',
    ai: { label: t => `Policy ${t.code} (${t.title}, ${t.status})` }
  },

  goals: {
    title: 'Objectives & KPIs', table: 'goals', prefix: 'KPI', icon: 'goal', aliasCodes: ['KPI', 'OBJ'],
    desc: 'Goals, KPIs, targets, progress & reviews',
    perms: { read: 'all', create: [...G.leaders, 'compliance_manager', 'qa'], update: [...G.leaders, 'compliance_manager', 'qa'], delete: G.quality },
    statuses: ['active', 'paused', 'achieved', 'archived'],
    list: [
      { name: 'code', label: 'Code' }, { name: 'title', label: 'Objective / KPI', flex: 2 },
      { name: 'type', label: 'Type' }, { name: 'target_value', label: 'Target', type: 'num' },
      { name: 'target_unit', label: 'Unit' }, { name: 'baseline', label: 'Baseline', type: 'num' },
      { name: 'owner_id', label: 'Owner', type: 'user' }, { name: 'status', label: 'Status', type: 'status' },
      { name: 'review_date', label: 'Review due', type: 'date' }
    ],
    fields: [
      f('title', 'Title', 'text', { required: true, span: 2 }),
      f('type', 'Type', 'select', { options: ['kpi', 'objective', 'goal'] }),
      f('policy_id', 'Linked policy', 'ref', { ref: { type: 'ref', table: 'policies', label: 'title' } }),
      f('owner_id', 'Owner', 'ref', { ref: usersRef }),
      f('department', 'Department'),
      f('target_value', 'Target value', 'number', { step: 'any' }),
      f('target_unit', 'Target unit'),
      f('direction', 'Direction', 'select', { options: ['higher', 'lower'] }),
      f('baseline', 'Baseline', 'number', { step: 'any' }),
      f('frequency', 'Frequency', 'select', { options: ['monthly', 'quarterly', 'annual'] }),
      f('status', 'Status', 'select', { options: ['active', 'paused', 'achieved', 'archived'] }),
      f('review_date', 'Next review', 'date'),
      f('description', 'Description', 'textarea', { span: 2 })
    ],
    search: ['code', 'title', 'description'],
    dueField: 'review_date',
    child: { table: 'goal_entries', fk: 'goal_id', label: 'Measurements', fields: ['period', 'value', 'note'], orderBy: 'period DESC' }
  },

  risks: {
    title: 'Risk Register', table: 'risks', prefix: 'RSK', icon: 'risk',
    desc: 'Risks, scoring, controls, residual risk',
    perms: { read: 'all', create: [...G.leaders, 'risk_manager'], update: [...G.leaders, 'risk_manager', 'qa'], delete: G.quality },
    statuses: ['open', 'treating', 'monitored', 'closed'],
    transitions: { open: ['treating', 'closed'], treating: ['monitored', 'open'], monitored: ['closed', 'treating'], closed: [] },
    approveRole: ['admin', 'quality_manager', 'risk_manager', 'management'],
    list: [
      { name: 'code', label: 'Code' }, { name: 'title', label: 'Risk', flex: 2 }, { name: 'category', label: 'Category' },
      { name: 'inherent_score', label: 'Inherent', type: 'risk', computed: 'inherent' },
      { name: 'residual_score', label: 'Residual', type: 'risk', computed: 'residual' },
      { name: 'treatment', label: 'Treatment' }, { name: 'owner_id', label: 'Owner', type: 'user' },
      { name: 'status', label: 'Status', type: 'status' }, { name: 'review_date', label: 'Review due', type: 'date' }
    ],
    fields: [
      f('title', 'Risk title', 'text', { required: true, span: 2 }),
      f('category', 'Category', 'select', { options: ['Operational', 'Compliance', 'Financial', 'Supply Chain', 'Cyber', 'Safety', 'Strategic', 'Reputation'] }),
      f('department', 'Department', 'select', { options: ['Quality', 'Operations', 'Engineering', 'Supply Chain', 'HR', 'IT', 'Finance'] }),
      f('owner_id', 'Owner', 'ref', { ref: usersRef }),
      f('inherent_likelihood', 'Inherent likelihood (1-5)', 'number', { min: 1, max: 5 }),
      f('inherent_severity', 'Inherent severity (1-5)', 'number', { min: 1, max: 5 }),
      f('residual_likelihood', 'Residual likelihood (1-5)', 'number', { min: 1, max: 5 }),
      f('residual_severity', 'Residual severity (1-5)', 'number', { min: 1, max: 5 }),
      f('treatment', 'Treatment', 'select', { options: ['mitigate', 'transfer', 'accept', 'avoid'] }),
      f('status', 'Status', 'select', { options: ['open', 'treating', 'monitored', 'closed'] }),
      f('review_date', 'Next review', 'date'),
      f('description', 'Description', 'textarea', { span: 2 }),
      f('controls', 'Controls', 'textarea', { span: 2 })
    ],
    search: ['code', 'title', 'description', 'controls', 'category'],
    dueField: 'review_date'
  },

  suppliers: {
    title: 'Suppliers', table: 'suppliers', prefix: 'SUP', icon: 'supplier',
    desc: 'Supplier qualification & performance',
    perms: { read: 'all', create: [...G.leaders, 'supplier_manager'], update: [...G.leaders, 'supplier_manager', 'qa'], delete: G.quality },
    statuses: ['pending', 'approved', 'conditional', 'disqualified'],
    transitions: { pending: ['approved', 'disqualified'], approved: ['conditional', 'disqualified'], conditional: ['approved', 'disqualified'], disqualified: ['pending'] },
    approveRole: ['admin', 'quality_manager', 'supplier_manager', 'management'],
    list: [
      { name: 'code', label: 'Code' }, { name: 'name', label: 'Supplier', flex: 2 }, { name: 'category', label: 'Category' },
      { name: 'risk_level', label: 'Risk' }, { name: 'status', label: 'Status', type: 'status' },
      { name: 'contact_name', label: 'Contact' }, { name: 'qualification_date', label: 'Qualified', type: 'date' },
      { name: 'next_audit', label: 'Next audit', type: 'date' }
    ],
    fields: [
      f('name', 'Supplier name', 'text', { required: true, span: 2 }),
      f('category', 'Category'),
      f('status', 'Status', 'select', { options: ['pending', 'approved', 'conditional', 'disqualified'] }),
      f('risk_level', 'Risk level', 'select', { options: ['low', 'medium', 'high', 'critical'] }),
      f('contact_name', 'Contact name'),
      f('email', 'Email', 'email'),
      f('phone', 'Phone'),
      f('website', 'Website'),
      f('qualification_date', 'Qualification date', 'date'),
      f('next_audit', 'Next audit', 'date'),
      f('approved_by', 'Approved by', 'ref', { ref: usersRef }),
      f('notes', 'Notes', 'textarea', { span: 2 })
    ],
    search: ['code', 'name', 'category', 'contact_name', 'email', 'notes'],
    dueField: 'next_audit',
    children: [
      { key: 'evaluations', table: 'supplier_evaluations', fk: 'supplier_id', label: 'Evaluations', fields: ['period', 'quality_score', 'delivery_score', 'communication_score', 'total_score', 'notes'] },
      { key: 'incidents', table: 'supplier_incidents', fk: 'supplier_id', label: 'Supplier incidents', fields: ['incident_date', 'description', 'severity', 'status'], statuses: ['open', 'closed'] }
    ]
  },

  employees: {
    title: 'People', table: 'employees', prefix: 'EMP', icon: 'people',
    desc: 'Employees & organization',
    perms: { read: 'all', create: [...G.leaders, 'competency_manager'], update: [...G.leaders, 'competency_manager'], updateSelfRole: 'employee', delete: G.quality },
    statuses: ['active', 'on_leave', 'inactive'],
    list: [
      { name: 'code', label: 'Code' }, { name: 'name', label: 'Name', flex: 2 }, { name: 'department', label: 'Department' },
      { name: 'job_title', label: 'Role' }, { name: 'manager_id', label: 'Manager', type: 'employee' },
      { name: 'hire_date', label: 'Hired', type: 'date' }, { name: 'status', label: 'Status', type: 'status' }
    ],
    fields: [
      f('name', 'Full name', 'text', { required: true, span: 2 }),
      f('email', 'Email', 'email'),
      f('department', 'Department', 'select', { options: ['Quality', 'Operations', 'Engineering', 'Supply Chain', 'HR', 'IT', 'Finance'] }),
      f('job_title', 'Job title'),
      f('manager_id', 'Manager', 'ref', { ref: employeesRef }),
      f('hire_date', 'Hire date', 'date'),
      f('status', 'Status', 'select', { options: ['active', 'on_leave', 'inactive'] }),
      f('user_id', 'System account', 'ref', { ref: usersRef })
    ],
    search: ['code', 'name', 'email', 'job_title', 'department']
  },

  competencies: {
    title: 'Competencies', table: 'competencies', prefix: 'CMP', icon: 'competency',
    desc: 'Competency definitions & assessments',
    perms: { read: 'all', create: [...G.leaders, 'competency_manager', 'qa'], update: [...G.leaders, 'competency_manager', 'qa'], delete: G.quality },
    statuses: ['active', 'retired'],
    list: [
      { name: 'code', label: 'Code' }, { name: 'name', label: 'Competency', flex: 2 }, { name: 'category', label: 'Category' },
      { name: 'required_level', label: 'Req. level', type: 'num' }
    ],
    fields: [
      f('name', 'Competency name', 'text', { required: true, span: 2 }),
      f('category', 'Category'),
      f('required_level', 'Required level (1-5)', 'number', { min: 1, max: 5 }),
      f('description', 'Description', 'textarea', { span: 2 })
    ],
    search: ['code', 'name', 'category', 'description'],
    child: {
      key: 'assessments', table: 'assessments', fk: 'competency_id', label: 'Assessments',
      fields: ['employee_id', 'level', 'assessment_date', 'expiry_date', 'notes'],
      refs: { employee_id: { table: 'employees', label: 'name' } }
    }
  },

  trainings: {
    title: 'Training', table: 'trainings', prefix: 'TRN', icon: 'training',
    desc: 'Training sessions & participation',
    perms: { read: 'all', create: [...G.leaders, 'competency_manager'], update: [...G.leaders, 'competency_manager'], delete: G.quality },
    statuses: ['scheduled', 'in_progress', 'completed', 'cancelled'],
    list: [
      { name: 'code', label: 'Code' }, { name: 'title', label: 'Training', flex: 2 }, { name: 'type', label: 'Type' },
      { name: 'provider', label: 'Provider' }, { name: 'scheduled_date', label: 'Date', type: 'date' },
      { name: 'hours', label: 'Hours', type: 'num' }, { name: 'status', label: 'Status', type: 'status' }
    ],
    fields: [
      f('title', 'Title', 'text', { required: true, span: 2 }),
      f('provider', 'Provider'),
      f('type', 'Type', 'select', { options: ['compliance', 'technical', 'safety', 'induction', 'soft_skills'] }),
      f('scheduled_date', 'Scheduled date', 'date'),
      f('hours', 'Hours', 'number', { step: 'any' }),
      f('status', 'Status', 'select', { options: ['scheduled', 'in_progress', 'completed', 'cancelled'] }),
      f('notes', 'Notes', 'textarea', { span: 2 })
    ],
    search: ['code', 'title', 'provider', 'notes'],
    dueField: 'scheduled_date',
    child: {
      key: 'participants', table: 'training_participants', fk: 'training_id', label: 'Participants',
      fields: ['employee_id', 'status', 'score'], refs: { employee_id: { table: 'employees', label: 'name' } },
      statuses: ['invited', 'attended', 'completed', 'no_show']
    }
  },

  records: {
    title: 'Records', table: 'records', prefix: 'REC', icon: 'record',
    desc: 'Secure records, retention & access control',
    perms: {
      read: 'all', readConfidentiality: { restricted: ['admin', 'quality_manager', 'management', 'manager', 'compliance_manager'] },
      create: [...G.leaders, 'compliance_manager', 'doc_controller'], update: [...G.leaders, 'compliance_manager', 'doc_controller'], delete: G.quality
    },
    statuses: ['active', 'archived', 'destroyed'],
    list: [
      { name: 'code', label: 'Code' }, { name: 'title', label: 'Record', flex: 2 }, { name: 'category', label: 'Category' },
      { name: 'format', label: 'Format' }, { name: 'confidentiality', label: 'Classification' },
      { name: 'retention_years', label: 'Retention (y)', type: 'num' }, { name: 'owner_id', label: 'Owner', type: 'user' },
      { name: 'retention_until', label: 'Retain until', type: 'date' }, { name: 'status', label: 'Status', type: 'status' }
    ],
    fields: [
      f('title', 'Record title', 'text', { required: true, span: 2 }),
      f('category', 'Category'),
      f('format', 'Format', 'select', { options: ['electronic', 'paper', 'hybrid'] }),
      f('confidentiality', 'Classification', 'select', { options: ['public', 'internal', 'confidential', 'restricted'] }),
      f('owner_id', 'Owner', 'ref', { ref: usersRef }),
      f('department', 'Department'),
      f('retention_years', 'Retention (years)', 'number', { min: 1 }),
      f('retention_until', 'Retain until', 'date'),
      f('location', 'Location'),
      f('status', 'Status', 'select', { options: ['active', 'archived', 'destroyed'] }),
      f('description', 'Description', 'textarea', { span: 2 })
    ],
    search: ['code', 'title', 'category', 'location', 'description'],
    dueField: 'retention_until'
  },

  documents: {
    title: 'Documents', table: 'documents', prefix: 'DOC', icon: 'document',
    desc: 'Controlled documents, versions & reviews',
    perms: { read: 'all', create: [...G.leaders, 'doc_controller', 'compliance_manager'], update: [...G.leaders, 'doc_controller', 'compliance_manager'], delete: G.quality },
    statuses: ['draft', 'in_review', 'approved', 'obsolete'],
    transitions: { draft: ['in_review'], in_review: ['draft', 'approved'], approved: ['obsolete'], obsolete: [] },
    approveRole: ['admin', 'quality_manager', 'doc_controller', 'compliance_manager', 'management'],
    list: [
      { name: 'code', label: 'Code' }, { name: 'title', label: 'Document', flex: 2 }, { name: 'category', label: 'Category' },
      { name: 'department', label: 'Dept' }, { name: 'version', label: 'Ver' }, { name: 'status', label: 'Status', type: 'status' },
      { name: 'owner_id', label: 'Owner', type: 'user' }, { name: 'effective_date', label: 'Effective', type: 'date' },
      { name: 'review_date', label: 'Review due', type: 'date' },
      { name: 'tracking_number', label: 'Tracking #', flex: 1 },
      { name: 'current_stage', label: 'Stage', type: 'status' },
      { name: 'assigned_reviewer_id', label: 'Reviewer', type: 'user' },
      { name: 'review_priority', label: 'Priority', type: 'priority' },
      { name: 'days_in_stage', label: 'Days in Stage', type: 'num' },
      { name: 'sla_breached', label: 'SLA Breach', type: 'boolean' },
      { name: 'routing_status', label: 'Routing', type: 'status' },
      { name: 'escalation_level', label: 'Escalation', type: 'num' }
    ],
    fields: [
      f('title', 'Document title', 'text', { required: true, span: 2 }),
      f('category', 'Category', 'select', { options: ['Manual', 'Procedure', 'Work Instruction', 'Specification', 'Protocol', 'Form', 'Plan'] }),
      f('department', 'Department', 'select', { options: ['Quality', 'Operations', 'Engineering', 'Supply Chain', 'HR', 'IT'] }),
      f('owner_id', 'Owner', 'ref', { ref: usersRef }),
      f('status', 'Status', 'select', { options: ['draft', 'in_review', 'approved', 'obsolete'] }),
      f('version', 'Version'),
      f('effective_date', 'Effective date', 'date'),
      f('review_date', 'Next review', 'date'),
      f('change_summary', 'Change summary', 'textarea', { span: 2 }),
      f('description', 'Description', 'textarea', { span: 2 }),
      // Tracking fields (1-20)
      f('tracking_number', 'Tracking Number', 'text'),
      f('revision_number', 'Revision Number', 'text'),
      f('current_stage', 'Current Stage', 'select', { options: ['draft', 'review', 'approval', 'distribution', 'effective', 'archived'] }),
      f('stage_entered_at', 'Stage Entered', 'date'),
      f('stage_due_at', 'Stage Due', 'date'),
      f('assigned_reviewer_id', 'Assigned Reviewer', 'ref', { ref: usersRef }),
      f('reviewer_department', 'Reviewer Department', 'select', { options: ['Quality', 'Operations', 'Engineering', 'Supply Chain', 'HR', 'IT', 'Finance'] }),
      f('review_priority', 'Review Priority', 'select', { options: ['low', 'normal', 'high', 'critical'] }),
      f('days_in_stage', 'Days in Stage', 'number', { min: 0 }),
      f('total_review_cycles', 'Total Review Cycles', 'number', { min: 0 }),
      f('last_action', 'Last Action', 'text'),
      f('last_action_by', 'Last Action By', 'ref', { ref: usersRef }),
      f('last_action_at', 'Last Action At', 'date'),
      f('sla_breached', 'SLA Breached', 'boolean'),
      f('escalation_level', 'Escalation Level', 'number', { min: 0 }),
      // Routing fields (21-36)
      f('routing_rule_id', 'Routing Rule', 'ref', { ref: { type: 'ref', table: 'document_routing_rules', label: 'name' } }),
      f('routing_path', 'Routing Path', 'textarea'),
      f('current_step_index', 'Current Step', 'number', { min: 0 }),
      f('routing_status', 'Routing Status', 'select', { options: ['pending', 'in_progress', 'completed', 'escalated', 'rejected', 'on_hold'] }),
      f('routed_by', 'Routed By', 'ref', { ref: usersRef }),
      f('routed_at', 'Routed At', 'date')
    ],
    search: ['code', 'title', 'description', 'change_summary', 'category', 'tracking_number', 'current_stage', 'routing_status'],
    dueField: 'review_date',
    child: {
      key: 'versions', table: 'document_versions', fk: 'document_id', label: 'Version history',
      fields: ['version', 'change_summary', 'status', 'approved_by', 'approved_at'],
      refs: { approved_by: { table: 'users', label: 'name' } }, readOnly: true
    }
  },

  design: {
    title: 'Design Reviews', table: 'design_reviews', prefix: 'DR', icon: 'design',
    desc: 'Design reviews, requirements & findings',
    perms: { read: 'all', create: [...G.leaders, 'equipment_manager', 'qa'], update: [...G.leaders, 'equipment_manager', 'qa'], delete: G.quality },
    statuses: ['planned', 'in_progress', 'closed'],
    transitions: { planned: ['in_progress'], in_progress: ['closed'], closed: [] },
    list: [
      { name: 'code', label: 'Code' }, { name: 'title', label: 'Review', flex: 2 }, { name: 'project', label: 'Project' },
      { name: 'stage', label: 'Stage' }, { name: 'review_date', label: 'Date', type: 'date' },
      { name: 'chair_id', label: 'Chair', type: 'user' }, { name: 'status', label: 'Status', type: 'status' }
    ],
    fields: [
      f('title', 'Review title', 'text', { required: true, span: 2 }),
      f('project', 'Project'),
      f('stage', 'Stage', 'select', { options: ['concept', 'detailed design', 'verification', 'validation', 'transfer'] }),
      f('review_date', 'Review date', 'date'),
      f('chair_id', 'Chair', 'ref', { ref: usersRef }),
      f('status', 'Status', 'select', { options: ['planned', 'in_progress', 'closed'] }),
      f('summary', 'Summary / minutes', 'textarea', { span: 2 })
    ],
    search: ['code', 'title', 'project', 'summary'],
    dueField: 'review_date',
    children: [
      { key: 'requirements', table: 'design_requirements', fk: 'review_id', label: 'Requirements', fields: ['requirement', 'acceptance_criteria', 'verification_method', 'status'], statuses: ['open', 'pass', 'fail', 'deferred'] },
      { key: 'findings', table: 'design_findings', fk: 'review_id', label: 'Findings', fields: ['description', 'severity', 'owner_id', 'status', 'due_date'], statuses: ['open', 'in_progress', 'closed'], refs: { owner_id: { table: 'users', label: 'name' } } }
    ]
  },

  equipment: {
    title: 'Equipment', table: 'equipment', prefix: 'EQ', icon: 'equipment',
    desc: 'Equipment, qualification & calibration',
    perms: { read: 'all', create: [...G.leaders, 'equipment_manager'], update: [...G.leaders, 'equipment_manager', 'qa'], delete: G.quality },
    statuses: ['operational', 'under_maintenance', 'under_qualification', 'out_of_service'],
    list: [
      { name: 'code', label: 'Code' }, { name: 'name', label: 'Equipment', flex: 2 }, { name: 'type', label: 'Type' },
      { name: 'location', label: 'Location' }, { name: 'status', label: 'Status', type: 'status' },
      { name: 'next_calibration', label: 'Calib. due', type: 'date' }, { name: 'next_maintenance', label: 'Maint. due', type: 'date' }
    ],
    fields: [
      f('name', 'Equipment name', 'text', { required: true, span: 2 }),
      f('type', 'Type'),
      f('manufacturer', 'Manufacturer'),
      f('model', 'Model'),
      f('serial', 'Serial no'),
      f('location', 'Location'),
      f('status', 'Status', 'select', { options: ['operational', 'under_maintenance', 'under_qualification', 'out_of_service'] }),
      f('installed_on', 'Installed on', 'date'),
      f('requires_calibration', 'Requires calibration', 'boolean'),
      f('calibration_interval_days', 'Calibration interval (days)', 'number'),
      f('last_calibration', 'Last calibration', 'date'),
      f('next_calibration', 'Next calibration', 'date'),
      f('last_maintenance', 'Last maintenance', 'date'),
      f('next_maintenance', 'Next maintenance', 'date'),
      f('owner_id', 'Owner', 'ref', { ref: usersRef })
    ],
    search: ['code', 'name', 'type', 'manufacturer', 'model', 'serial', 'location'],
    dueFields: ['next_calibration', 'next_maintenance'],
    child: {
      key: 'qualifications', table: 'equipment_qualifications', fk: 'equipment_id', label: 'Qualification (IQ/OQ/PQ)',
      fields: ['type', 'status', 'performed_by', 'performed_on', 'result', 'notes'],
      refs: { performed_by: { table: 'users', label: 'name' } },
      statuses: ['pending', 'pass', 'fail']
    }
  },

  nonconformances: {
    title: 'NC & Incidents', table: 'nonconformances', prefix: 'NC', icon: 'nc', aliasCodes: ['NC', 'CAPA', 'INC'],
    desc: 'Non-conformances, incidents, CAPA & verification',
    perms: { read: 'all', create: 'all-auth', update: [...G.staff, 'employee'], delete: G.quality },
    statuses: ['open', 'investigation', 'action_plan', 'verification', 'closed'],
    transitions: { open: ['investigation'], investigation: ['action_plan', 'open'], action_plan: ['verification'], verification: ['closed', 'action_plan'], closed: [] },
    approveRole: ['admin', 'quality_manager', 'qa', 'investigator', 'management'],
    closeRequires: ['root_cause', 'correction'],
    list: [
      { name: 'code', label: 'Code' }, { name: 'title', label: 'Title', flex: 2 }, { name: 'type', label: 'Type' },
      { name: 'severity', label: 'Severity' }, { name: 'source', label: 'Source' }, { name: 'department', label: 'Dept' },
      { name: 'owner_id', label: 'Owner', type: 'user' }, { name: 'status', label: 'Status', type: 'status' },
      { name: 'occurred_at', label: 'Occurred', type: 'date' }
    ],
    fields: [
      f('title', 'Title', 'text', { required: true, span: 2 }),
      f('type', 'Type', 'select', { options: ['nc', 'incident', 'capa'] }),
      f('severity', 'Severity', 'select', { options: ['low', 'minor', 'major', 'critical'] }),
      f('source', 'Source', 'select', { options: ['internal', 'supplier', 'customer', 'audit', 'regulatory'] }),
      f('source_ref', 'Reference (lot, PO, complaint no)'),
      f('department', 'Department', 'select', { options: ['Quality', 'Operations', 'Engineering', 'Supply Chain', 'HR', 'IT'] }),
      f('supplier_id', 'Supplier', 'ref', { ref: { type: 'ref', table: 'suppliers', label: 'name' } }),
      f('raised_by', 'Raised by', 'ref', { ref: usersRef }),
      f('owner_id', 'Owner', 'ref', { ref: usersRef }),
      f('occurred_at', 'Occurred on', 'date'),
      f('status', 'Status', 'select', { options: ['open', 'investigation', 'action_plan', 'verification', 'closed'] }),
      f('root_cause_category', 'Root cause category', 'select', { options: ['process', 'human', 'equipment', 'materials', 'method', 'environment', 'supplier'] }),
      f('description', 'Description', 'textarea', { span: 2 }),
      f('root_cause', 'Root cause (investigation)', 'textarea', { span: 2 }),
      f('correction', 'Correction / containment', 'textarea', { span: 2 }),
      f('preventive_action', 'Preventive action (CAPA)', 'textarea', { span: 2 })
    ],
    search: ['code', 'title', 'description', 'root_cause', 'source_ref'],
    createdByDefault: true
  },

  audits: {
    title: 'Audits', table: 'audits', prefix: 'AUD', icon: 'audit',
    desc: 'Internal, supplier & external audits',
    perms: { read: 'all', create: G.auditors, update: G.auditors, delete: G.quality },
    statuses: ['planned', 'in_progress', 'closed'],
    transitions: { planned: ['in_progress'], in_progress: ['closed'], closed: [] },
    list: [
      { name: 'code', label: 'Code' }, { name: 'title', label: 'Audit', flex: 2 }, { name: 'type', label: 'Type' },
      { name: 'standard', label: 'Standard' }, { name: 'department', label: 'Scope dept' },
      { name: 'lead_auditor_id', label: 'Lead auditor', type: 'user' }, { name: 'status', label: 'Status', type: 'status' },
      { name: 'planned_date', label: 'Planned', type: 'date' }, { name: 'result', label: 'Result' }
    ],
    fields: [
      f('title', 'Audit title', 'text', { required: true, span: 2 }),
      f('type', 'Type', 'select', { options: ['internal', 'supplier', 'external', 'gap'] }),
      f('standard', 'Standard', 'select', { options: ['ISO 9001:2015', 'ISO 13485:2016', 'ISO 27001:2022', 'EU MDR 2017/745', 'FDA 21 CFR 820'] }),
      f('scope', 'Scope'),
      f('department', 'Department', 'select', { options: ['Quality', 'Operations', 'Engineering', 'Supply Chain', 'HR', 'IT'] }),
      f('lead_auditor_id', 'Lead auditor', 'ref', { ref: usersRef }),
      f('supplier_id', 'Supplier', 'ref', { ref: { type: 'ref', table: 'suppliers', label: 'name' } }),
      f('status', 'Status', 'select', { options: ['planned', 'in_progress', 'closed'] }),
      f('planned_date', 'Planned date', 'date'),
      f('conducted_on', 'Conducted on', 'date'),
      f('result', 'Result', 'select', { options: ['conformant', 'minor_nc', 'major_nc', ''] }),
      f('summary', 'Summary', 'textarea', { span: 2 })
    ],
    search: ['code', 'title', 'scope', 'summary', 'standard'],
    dueField: 'planned_date',
    child: {
      key: 'items', table: 'audit_items', fk: 'audit_id', label: 'Findings & checklist',
      fields: ['clause', 'requirement', 'finding_type', 'description', 'owner_id', 'status', 'due_date'],
      refs: { owner_id: { table: 'users', label: 'name' } },
      statuses: ['open', 'in_progress', 'closed'],
      typeOptions: ['ok', 'observation', 'minor', 'major']
    }
  },

  compliance: {
    title: 'Compliance', table: 'compliance_requirements', prefix: 'CR', icon: 'compliance',
    desc: 'Requirements & conformity status',
    perms: { read: 'all', create: [...G.leaders, 'compliance_manager'], update: [...G.leaders, 'compliance_manager'], delete: G.quality },
    statuses: ['not_assessed', 'compliant', 'partially', 'non_compliant'],
    list: [
      { name: 'code', label: 'Code' }, { name: 'framework', label: 'Framework' }, { name: 'clause', label: 'Clause' },
      { name: 'title', label: 'Requirement', flex: 2 }, { name: 'status', label: 'Status', type: 'status' },
      { name: 'owner_id', label: 'Owner', type: 'user' }, { name: 'next_review', label: 'Review due', type: 'date' }
    ],
    fields: [
      f('framework', 'Framework', 'select', { options: ['ISO 9001:2015', 'ISO 13485:2016', 'EU MDR 2017/745', 'FDA 21 CFR 820', 'ISO 27001:2022', 'GDPR'] }),
      f('clause', 'Clause'),
      f('title', 'Requirement', 'text', { required: true, span: 2 }),
      f('status', 'Status', 'select', { options: ['not_assessed', 'compliant', 'partially', 'non_compliant'] }),
      f('owner_id', 'Owner', 'ref', { ref: usersRef }),
      f('last_assessed', 'Last assessed', 'date'),
      f('next_review', 'Next review', 'date'),
      f('description', 'Description', 'textarea', { span: 2 }),
      f('evidence', 'Evidence', 'textarea', { span: 2 })
    ],
    search: ['code', 'title', 'description', 'clause', 'framework'],
    dueField: 'next_review'
  },

  mgmt_reviews: {
    title: 'Management Review', table: 'management_reviews', prefix: 'MR', icon: 'review',
    desc: 'Management reviews with auto-collected inputs',
    perms: { read: ['admin', 'quality_manager', 'management', 'manager', 'qa', 'investigator', 'auditor', 'compliance_manager', 'risk_manager'], create: G.exec, update: G.exec, delete: ['admin'] },
    statuses: ['draft', 'in_review', 'issued'],
    transitions: { draft: ['in_review'], in_review: ['issued'], issued: [] },
    approveRole: G.exec,
    list: [
      { name: 'code', label: 'Code' }, { name: 'title', label: 'Review', flex: 2 }, { name: 'review_date', label: 'Date', type: 'date' },
      { name: 'chair_id', label: 'Chair', type: 'user' }, { name: 'attendees', label: 'Attendees' },
      { name: 'status', label: 'Status', type: 'status' }
    ],
    fields: [
      f('title', 'Title', 'text', { required: true, span: 2 }),
      f('review_date', 'Review date', 'date'),
      f('chair_id', 'Chair', 'ref', { ref: usersRef }),
      f('attendees', 'Attendees'),
      f('status', 'Status', 'select', { options: ['draft', 'in_review', 'issued'] }),
      f('summary', 'Summary / minutes', 'textarea', { span: 2 })
    ],
    search: ['code', 'title', 'summary']
  }
};

// Actions module is custom (hub) but registered for search/AI.
MODULES.actions = {
  title: 'Actions', table: 'actions', prefix: 'ACT', icon: 'action',
  desc: 'Centralized actions from all modules',
  perms: { read: 'all', create: 'all-auth', update: 'all-auth', delete: G.quality },
  statuses: ['open', 'in_progress', 'completed', 'verified', 'cancelled'],
  list: [
    { name: 'code', label: 'Code' }, { name: 'title', label: 'Action', flex: 2 },
    { name: 'source_type', label: 'Source' }, { name: 'source_code', label: 'Source ref' },
    { name: 'owner_id', label: 'Owner', type: 'user' }, { name: 'priority', label: 'Priority', type: 'priority' },
    { name: 'due_date', label: 'Due', type: 'date' }, { name: 'status', label: 'Status', type: 'status' }
  ],
  fields: [
    f('title', 'Title', 'text', { required: true, span: 2 }),
    f('description', 'Description', 'textarea', { span: 2 }),
    f('owner_id', 'Owner', 'ref', { ref: usersRef }),
    f('priority', 'Priority', 'select', { options: ['low', 'medium', 'high', 'critical'] }),
    f('due_date', 'Due date', 'date'),
    f('status', 'Status', 'select', { options: ['open', 'in_progress', 'completed', 'verified', 'cancelled'] }),
    f('source_type', 'Source module', 'select', { options: ['risk', 'nonconformance', 'audit', 'review', 'supplier', 'equipment', 'competency', 'document', 'policy', 'goal', 'compliance', 'design', 'manual'] }),
    f('source_code', 'Source reference')
  ],
  search: ['code', 'title', 'description', 'source_code'],
  dueField: 'due_date'
};

const CODE_TO_MODULE = {};
for (const [key, m] of Object.entries(MODULES)) {
  const prefixes = m.aliasCodes || [m.prefix];
  for (const p of prefixes) CODE_TO_MODULE[p] = key;
}

function findByCode(code) {
  const m = CODE_TO_MODULE[code.split('-')[0]];
  if (!m) return null;
  const mod = MODULES[m];
  const row = require('./db').prepare(`SELECT * FROM ${mod.table} WHERE code = ?`).get(code.toUpperCase());
  return row ? { module: m, mod, row } : null;
}

function can(user, mod, op) {
  if (!user || !mod.perms) return false;
  const p = mod.perms[op];
  if (p === 'all' || p === 'all-auth') return true;
  return Array.isArray(p) && p.includes(user.role);
}

module.exports = { MODULES, ROLES, ROLE_LABELS, CODE_TO_MODULE, findByCode, can };
