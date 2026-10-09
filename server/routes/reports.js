// Reports & analytics with CSV export for authorized users.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { toCsv, today } = require('../utils');

const r = express.Router();
r.use(authRequired);

const EXPORTERS = ['admin', 'quality_manager', 'management', 'manager', 'qa', 'investigator', 'auditor', 'risk_manager', 'compliance_manager', 'doc_controller', 'competency_manager', 'supplier_manager', 'equipment_manager'];
const all = (sql, ...a) => db.prepare(sql).all(...a);

const REPORTS = {
  risks: {
    title: 'Risk Report', icon: 'risk',
    build: () => {
      const rows = all('SELECT code, title, category, department, inherent_likelihood * inherent_severity AS inherent, residual_likelihood * residual_severity AS residual, treatment, status, review_date FROM risks ORDER BY residual DESC');
      return {
        rows,
        byCategory: all('SELECT category, COUNT(*) count, SUM(residual_likelihood * residual_severity) totalResidual FROM risks GROUP BY category'),
        byStatus: all('SELECT status, COUNT(*) count FROM risks GROUP BY status'),
        byRating: all(`SELECT CASE WHEN residual_likelihood * residual_severity >= 15 THEN 'high' WHEN residual_likelihood * residual_severity >= 8 THEN 'medium' ELSE 'low' END rating, COUNT(*) count FROM risks GROUP BY rating`),
        columns: [
          { label: 'Code', value: 'code' }, { label: 'Risk', value: 'title' }, { label: 'Category', value: 'category' },
          { label: 'Department', value: 'department' }, { label: 'Inherent', value: 'inherent' }, { label: 'Residual', value: 'residual' },
          { label: 'Treatment', value: 'treatment' }, { label: 'Status', value: 'status' }, { label: 'Review due', value: 'review_date' }
        ]
      };
    }
  },
  nonconformances: {
    title: 'Non-conformance & Incident Report', icon: 'nc',
    build: () => {
      const rows = all(`SELECT n.code, n.type, n.title, n.severity, n.source, n.department, s.name AS supplier, n.status, n.occurred_at, n.closed_at FROM nonconformances n LEFT JOIN suppliers s ON s.id = n.supplier_id ORDER BY n.occurred_at DESC`);
      return {
        rows,
        bySeverity: all('SELECT severity, COUNT(*) count FROM nonconformances GROUP BY severity'),
        byStatus: all('SELECT status, COUNT(*) count FROM nonconformances GROUP BY status'),
        byDepartment: all('SELECT department, COUNT(*) count FROM nonconformances GROUP BY department ORDER BY count DESC'),
        byRootCause: all("SELECT root_cause_category, COUNT(*) count FROM nonconformances WHERE root_cause_category IS NOT NULL AND root_cause_category != '' GROUP BY root_cause_category"),
        closureTime: all(`SELECT code, title, occurred_at, closed_at, CAST(julianday(closed_at) - julianday(occurred_at) AS INTEGER) days FROM nonconformances WHERE closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 20`),
        columns: [
          { label: 'Code', value: 'code' }, { label: 'Type', value: 'type' }, { label: 'Title', value: 'title' },
          { label: 'Severity', value: 'severity' }, { label: 'Source', value: 'source' }, { label: 'Department', value: 'department' },
          { label: 'Supplier', value: 'supplier' }, { label: 'Status', value: 'status' }, { label: 'Occurred', value: 'occurred_at' }, { label: 'Closed', value: 'closed_at' }
        ]
      };
    }
  },
  suppliers: {
    title: 'Supplier Performance Report', icon: 'supplier',
    build: () => {
      const rows = all(`SELECT s.code, s.name, s.category, s.status, s.risk_level, ROUND(AVG(se.total_score), 1) avgScore, MAX(se.period) lastPeriod,
        (SELECT COUNT(*) FROM supplier_incidents si WHERE si.supplier_id = s.id) incidents,
        (SELECT COUNT(*) FROM nonconformances n WHERE n.supplier_id = s.id) ncs
        FROM suppliers s LEFT JOIN supplier_evaluations se ON se.supplier_id = s.id GROUP BY s.id ORDER BY s.name`);
      return {
        rows,
        byStatus: all('SELECT status, COUNT(*) count FROM suppliers GROUP BY status'),
        lowPerformers: all('SELECT s.code, s.name, se.period, se.total_score FROM supplier_evaluations se JOIN suppliers s ON s.id = se.supplier_id WHERE se.total_score < 80 ORDER BY se.total_score'),
        columns: [
          { label: 'Code', value: 'code' }, { label: 'Supplier', value: 'name' }, { label: 'Category', value: 'category' },
          { label: 'Status', value: 'status' }, { label: 'Risk', value: 'risk_level' }, { label: 'Avg score', value: 'avgScore' },
          { label: 'Last period', value: 'lastPeriod' }, { label: 'Incidents', value: 'incidents' }, { label: 'NCs', value: 'ncs' }
        ]
      };
    }
  },
  competencies: {
    title: 'Competency & Training Report', icon: 'competency',
    build: () => {
      const rows = all(`SELECT e.code, e.name, e.department, e.job_title,
        (SELECT COUNT(*) FROM assessments a WHERE a.employee_id = e.id) assessments,
        (SELECT COUNT(*) FROM assessments a WHERE a.employee_id = e.id AND a.expiry_date < '${today()}') expired,
        (SELECT COUNT(*) FROM assessments a JOIN competencies c ON c.id = a.competency_id WHERE a.employee_id = e.id AND a.level < c.required_level) belowRequired
        FROM employees e ORDER BY e.name`);
      const trainings = all('SELECT t.code, t.title, t.type, t.scheduled_date, t.status, (SELECT COUNT(*) FROM training_participants tp WHERE tp.training_id = t.id AND tp.status = \'completed\') completed, (SELECT COUNT(*) FROM training_participants tp WHERE tp.training_id = t.id) total FROM trainings t');
      return {
        rows, trainings,
        expiring: all(`SELECT a.code, e.name employee, c.name competency, a.level, c.required_level, a.expiry_date FROM assessments a JOIN employees e ON e.id = a.employee_id JOIN competencies c ON c.id = a.competency_id WHERE a.expiry_date IS NOT NULL AND a.expiry_date <= date('now','+60 day') ORDER BY a.expiry_date`),
        columns: [
          { label: 'Code', value: 'code' }, { label: 'Employee', value: 'name' }, { label: 'Department', value: 'department' },
          { label: 'Role', value: 'job_title' }, { label: 'Assessments', value: 'assessments' }, { label: 'Expired', value: 'expired' }, { label: 'Below required', value: 'belowRequired' }
        ]
      };
    }
  },
  documents: {
    title: 'Document Control Report', icon: 'document',
    build: () => {
      const rows = all("SELECT code, title, category, department, version, status, effective_date, review_date FROM documents ORDER BY code");
      return {
        rows,
        byStatus: all('SELECT status, COUNT(*) count FROM documents GROUP BY status'),
        reviewOverdue: all(`SELECT code, title, version, review_date FROM documents WHERE status = 'approved' AND review_date < '${today()}'`),
        columns: [
          { label: 'Code', value: 'code' }, { label: 'Title', value: 'title' }, { label: 'Category', value: 'category' },
          { label: 'Department', value: 'department' }, { label: 'Version', value: 'version' }, { label: 'Status', value: 'status' },
          { label: 'Effective', value: 'effective_date' }, { label: 'Review due', value: 'review_date' }
        ]
      };
    }
  },
  audits: {
    title: 'Audit Report', icon: 'audit',
    build: () => {
      const rows = all('SELECT code, title, type, standard, department, status, planned_date, conducted_on, result FROM audits ORDER BY planned_date DESC');
      return {
        rows,
        findings: all(`SELECT a.code audit, ai.clause, ai.finding_type, ai.description, ai.status, ai.due_date FROM audit_items ai JOIN audits a ON a.id = ai.audit_id WHERE ai.finding_type != 'ok' ORDER BY ai.status, a.planned_date DESC`),
        byResult: all("SELECT COALESCE(NULLIF(result,''),'pending') result, COUNT(*) count FROM audits GROUP BY result"),
        columns: [
          { label: 'Code', value: 'code' }, { label: 'Audit', value: 'title' }, { label: 'Type', value: 'type' },
          { label: 'Standard', value: 'standard' }, { label: 'Department', value: 'department' }, { label: 'Status', value: 'status' },
          { label: 'Planned', value: 'planned_date' }, { label: 'Conducted', value: 'conducted_on' }, { label: 'Result', value: 'result' }
        ]
      };
    }
  },
  actions: {
    title: 'Actions Report', icon: 'action',
    build: () => {
      const rows = all("SELECT code, title, source_type, source_code, priority, status, due_date, completed_at, CASE WHEN due_date < date('now') AND status IN ('open','in_progress') THEN 'OVERDUE' ELSE '' END flag FROM actions ORDER BY due_date");
      return {
        rows,
        byStatus: all('SELECT status, COUNT(*) count FROM actions GROUP BY status'),
        bySource: all('SELECT source_type, COUNT(*) count FROM actions GROUP BY source_type ORDER BY count DESC'),
        overdue: all("SELECT code, title, priority, due_date FROM actions WHERE due_date < date('now') AND status IN ('open','in_progress') ORDER BY due_date"),
        columns: [
          { label: 'Code', value: 'code' }, { label: 'Action', value: 'title' }, { label: 'Source', value: 'source_type' },
          { label: 'Source ref', value: 'source_code' }, { label: 'Priority', value: 'priority' }, { label: 'Status', value: 'status' },
          { label: 'Due', value: 'due_date' }, { label: 'Completed', value: 'completed_at' }, { label: 'Flag', value: 'flag' }
        ]
      };
    }
  },
  goals: {
    title: 'KPI & Objectives Report', icon: 'goal',
    build: () => {
      const rows = all(`SELECT g.code, g.title, g.type, g.target_value, g.target_unit, g.direction,
        (SELECT value FROM goal_entries ge WHERE ge.goal_id = g.id ORDER BY ge.period DESC, ge.id DESC LIMIT 1) lastValue,
        (SELECT period FROM goal_entries ge WHERE ge.goal_id = g.id ORDER BY ge.period DESC, ge.id DESC LIMIT 1) lastPeriod
        FROM goals g ORDER BY g.code`);
      return {
        rows,
        series: all('SELECT g.code, ge.period, ge.value FROM goal_entries ge JOIN goals g ON ge.id = ge.goal_id ORDER BY g.code, ge.period'),
        columns: [
          { label: 'Code', value: 'code' }, { label: 'Objective/KPI', value: 'title' }, { label: 'Type', value: 'type' },
          { label: 'Target', value: 'target_value' }, { label: 'Unit', value: 'target_unit' },
          { label: 'Last value', value: 'lastValue' }, { label: 'Last period', value: 'lastPeriod' }
        ]
      };
    }
  },
  compliance: {
    title: 'Compliance Report', icon: 'compliance',
    build: () => {
      const rows = all('SELECT code, framework, clause, title, status, next_review FROM compliance_requirements ORDER BY framework, clause');
      return {
        rows,
        byFramework: all('SELECT framework, SUM(status = \'compliant\') compliant, SUM(status != \'compliant\') gaps, COUNT(*) total FROM compliance_requirements GROUP BY framework'),
        columns: [
          { label: 'Code', value: 'code' }, { label: 'Framework', value: 'framework' }, { label: 'Clause', value: 'clause' },
          { label: 'Requirement', value: 'title' }, { label: 'Status', value: 'status' }, { label: 'Next review', value: 'next_review' }
        ]
      };
    }
  },
  'mgmt-reviews': {
    title: 'Management Review Report', icon: 'review',
    build: () => {
      const rows = all('SELECT code, title, review_date, status FROM management_reviews ORDER BY review_date DESC');
      return {
        rows,
        columns: [
          { label: 'Code', value: 'code' }, { label: 'Review', value: 'title' }, { label: 'Date', value: 'review_date' }, { label: 'Status', value: 'status' }
        ]
      };
    }
  },
  equipment: {
    title: 'Equipment Status Report', icon: 'equipment',
    build: () => {
      const rows = all('SELECT code, name, type, location, status, last_calibration, next_calibration, next_maintenance FROM equipment ORDER BY code');
      return {
        rows,
        columns: [
          { label: 'Code', value: 'code' }, { label: 'Equipment', value: 'name' }, { label: 'Type', value: 'type' },
          { label: 'Location', value: 'location' }, { label: 'Status', value: 'status' },
          { label: 'Last calib', value: 'last_calibration' }, { label: 'Next calib', value: 'next_calibration' }, { label: 'Next maint', value: 'next_maintenance' }
        ]
      };
    }
  }
};

r.get('/', (req, res) => {
  res.json({
    reports: Object.entries(REPORTS).map(([key, rp]) => ({ key, title: rp.title, icon: rp.icon })),
    canExport: EXPORTERS.includes(req.user.role)
  });
});

r.get('/:key', (req, res) => {
  const rp = REPORTS[req.params.key];
  if (!rp) return res.status(404).json({ error: 'Unknown report' });
  res.json({ key: req.params.key, title: rp.title, ...rp.build(), canExport: EXPORTERS.includes(req.user.role) });
});

r.get('/:key/export.csv', (req, res) => {
  const rp = REPORTS[req.params.key];
  if (!rp) return res.status(404).json({ error: 'Unknown report' });
  if (!EXPORTERS.includes(req.user.role)) return res.status(403).json({ error: 'Your role is not authorized to export this data' });
  const data = rp.build();
  const csv = toCsv(data.rows, data.columns);
  audit(req, 'export', 'reports', null, rp.title, { key: req.params.key, rows: data.rows.length });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.key}-report-${today()}.csv"`);
  res.send('\ufeff' + csv);
});

module.exports = r;
module.exports.REPORTS = REPORTS;
