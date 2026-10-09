// Competency Matrix — visual grid of employees × competencies with levels and gaps.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { audit } = require('../middleware/audit');

const r = express.Router();
r.use(authRequired);

r.get('/', (req, res) => {
  const employees = db.prepare("SELECT id, code, name, department, job_title FROM employees WHERE status = 'active' ORDER BY name").all();
  const competencies = db.prepare('SELECT id, code, name, required_level FROM competencies ORDER BY code').all();
  const assessments = db.prepare('SELECT employee_id, competency_id, level, assessment_date, expiry_date FROM assessments').all();

  // Build lookup: employeeId:competencyId → {level, expiry}
  const lookup = new Map();
  for (const a of assessments) {
    const k = `${a.employee_id}:${a.competency_id}`;
    // keep the most recent assessment
    if (!lookup.has(k) || (a.assessment_date || '') > (lookup.get(k).assessment_date || '')) {
      lookup.set(k, a);
    }
  }

  const grid = employees.map(e => ({
    id: e.id, code: e.code, name: e.name, department: e.department, job_title: e.job_title,
    skills: competencies.map(c => {
      const a = lookup.get(`${e.id}:${c.id}`);
      return {
        competencyId: c.id,
        level: a ? a.level : 0,
        required: c.required_level,
        gap: a && a.level < c.required_level,
        expiry: a ? a.expiry_date : null,
        expired: a && a.expiry_date && a.expiry_date < new Date().toISOString().slice(0, 10)
      };
    })
  }));

  // Summary stats
  let totalGaps = 0, totalExpired = 0, totalCovered = 0;
  for (const emp of grid) {
    for (const s of emp.skills) {
      if (s.gap) totalGaps++;
      if (s.expired) totalExpired++;
      if (s.level >= s.required && !s.expired) totalCovered++;
    }
  }

  // Departments for filter
  const departments = [...new Set(employees.map(e => e.department))].sort();

  res.json({
    competencies: competencies.map(c => ({ id: c.id, code: c.code, name: c.name, required: c.required_level })),
    grid, departments,
    stats: { totalGaps, totalExpired, totalCovered, totalEmployees: employees.length, totalCompetencies: competencies.length }
  });
});

module.exports = r;
