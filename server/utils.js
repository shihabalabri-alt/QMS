const crypto = require('crypto');

function pad(n, size) { return String(n).padStart(size || 4, '0'); }

function today() { return new Date().toISOString().slice(0, 10); }
function nowIso() { return new Date().toISOString(); }

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function addMonths(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr + 'T00:00:00Z') - new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')) / 86400000);
}

function riskRating(score) {
  if (score >= 15) return 'high';
  if (score >= 8) return 'medium';
  if (score >= 1) return 'low';
  return 'none';
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function toCsv(rows, columns) {
  const head = columns.map(c => csvEscape(c.label)).join(',');
  const lines = rows.map(r => columns.map(c => csvEscape(typeof c.value === 'function' ? c.value(r) : r[c.value])).join(','));
  return [head, ...lines].join('\r\n');
}

function randomToken(bytes) { return crypto.randomBytes(bytes || 24).toString('hex'); }

module.exports = { pad, today, nowIso, addDays, addMonths, daysUntil, riskRating, toCsv, randomToken };
