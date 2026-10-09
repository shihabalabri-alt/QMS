// Branded PDF generation for records, reports and the system connection map.
const PDFDocument = require('pdfkit');

const NAVY = '#0d1b3d';
const BLUE = '#1565d0';
const GREEN = '#2e8f1f';
const MUTED = '#64748b';
const LIGHT = '#eef3fb';

function header(doc, title, subtitle) {
  doc.rect(0, 0, 595, 86).fill(NAVY);
  // logo mark (simplified hexagon + bars + swoosh)
  const x = 34, y = 18, s = 50;
  doc.save();
  doc.moveTo(x + 26, y).lineTo(x, y + 15).lineTo(x, y + 45).lineTo(x + 27, y + 61)
     .lineWidth(6).strokeColor('#4f9bff').stroke();
  doc.moveTo(x + 34, y + 2).lineTo(x + 62, y + 18).lineTo(x + 62, y + 48).lineTo(x + 44, y + 58)
     .lineWidth(6).strokeColor('#5cb947').stroke();
  doc.rect(x + 22, y + 30, 5, 12).fill('#4f9bff');
  doc.rect(x + 30, y + 24, 5, 18).fill('#4f9bff');
  doc.rect(x + 38, y + 18, 5, 24).fill('#4f9bff');
  doc.restore();
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(19).text('QualiCore', 96, 24);
  doc.fillColor('#9db8e8').font('Helvetica').fontSize(8)
     .text('QUALITY · RISK · COMPLIANCE · EXCELLENCE', 96, 46);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11)
     .text(title.toUpperCase(), 96, 60, { width: 460, ellipsis: true });
  if (subtitle) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
       .text(subtitle, 40, 98, { width: 515 });
  }
}

function sectionTitle(doc, text, y) {
  let yy = y;
  if (yy > 760) { doc.addPage(); yy = 50; }
  doc.rect(40, yy + 2, 3, 12).fill(BLUE);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12).text(text, 50, yy);
  return yy + 22;
}

function kvRow(doc, key, value, y, x = 50, w = 495) {
  if (y > 770) { doc.addPage(); y = 50; }
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(9).text(key, x, y, { width: 150 });
  doc.fillColor('#17203a').font('Helvetica').fontSize(9.5).text(String(value ?? '—'), x + 155, y, { width: w - 160 });
  const lines = Math.max(
    doc.heightOfString(String(value ?? '—'), { width: w - 160 }),
    doc.heightOfString(key, { width: 150 })
  );
  return y + lines + 7;
}

function footer(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.rect(0, 812, 595, 30).fill(LIGHT);
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
       .text('QualiCore QMS · electronically generated document · data is authoritative from the live system · generated ' + new Date().toLocaleString(), 40, 822, { width: 400 });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, 480, 822, { width: 75, align: 'right' });
  }
}

function bullet(doc, text, y, color = '#17203a') {
  if (y > 770) { doc.addPage(); y = 50; }
  doc.circle(54, y + 4, 2).fill(color);
  doc.fillColor(color).font('Helvetica').fontSize(9.5).text(text, 62, y, { width: 480 });
  return y + Math.max(13, doc.heightOfString(text, { width: 480 }) + 3);
}

function simpleTable(doc, columns, rows, y) {
  const widths = columns.map(c => c.w);
  const total = widths.reduce((a, b) => a + b, 0);
  const scale = 515 / total;
  const ws = widths.map(w => w * scale);
  const drawHead = (yy) => {
    doc.rect(40, yy, 515, 18).fill(NAVY);
    let x = 44;
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
    columns.forEach((c, i) => { doc.text(c.label.toUpperCase(), x, yy + 5, { width: ws[i] - 6, ellipsis: true }); x += ws[i]; });
    return yy + 22;
  };
  let yy = y > 740 ? (doc.addPage(), 50) : y;
  yy = drawHead(yy);
  rows.forEach((row, ri) => {
    const heights = columns.map((c, i) => doc.heightOfString(String(row[i] ?? ''), { width: ws[i] - 6 }));
    const rh = Math.max(14, Math.max(...heights) + 6);
    if (yy + rh > 790) { doc.addPage(); yy = drawHead(50); }
    if (ri % 2 === 0) doc.rect(40, yy - 3, 515, rh).fill('#f4f7fc');
    let x = 44;
    columns.forEach((c, i) => {
      doc.fillColor('#17203a').font('Helvetica').fontSize(8.5)
         .text(String(row[i] ?? ''), x, yy, { width: ws[i] - 6, height: rh, ellipsis: true });
      x += ws[i];
    });
    yy += rh;
  });
  return yy + 10;
}

/* ---------- Record PDF ---------- */
function recordPdf(data) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `${data.code} — ${data.title}`, Author: 'QualiCore QMS' } });
  header(doc, `${data.code} — ${data.title}`.slice(0, 70), `${data.moduleTitle}  ·  status: ${data.status || 'n/a'}  ·  generated for ${data.requestedBy}`);
  let y = 118;

  if (data.description) {
    y = sectionTitle(doc, 'Description', y);
    doc.fillColor('#17203a').font('Helvetica').fontSize(9.5).text(data.description, 50, y, { width: 495 });
    y += doc.heightOfString(data.description, { width: 495 }) + 14;
  }

  y = sectionTitle(doc, 'Record Details', y);
  for (const [k, v] of data.fields) y = kvRow(doc, k, v, y);

  if (data.related.length) {
    y = sectionTitle(doc, `Related Information (${data.related.length} connections)`, y);
    for (const rel of data.related) y = bullet(doc, `[${rel.type}] ${rel.label} — ${rel.rel}`, y, BLUE);
  }

  if (data.actions.length) {
    y = sectionTitle(doc, `Linked Actions (${data.actions.length})`, y);
    y = simpleTable(doc,
      [{ label: 'Code', w: 60 }, { label: 'Action', w: 210 }, { label: 'Owner', w: 90 }, { label: 'Due', w: 60 }, { label: 'Status', w: 70 }],
      data.actions.map(a => [a.code, a.title, a.owner_name || '—', a.due_date || '—', a.status]), y);
  }

  if (data.children.length) {
    y = sectionTitle(doc, data.childrenLabel, y);
    y = simpleTable(doc, data.childColumns, data.children, y);
  }

  if (data.comments.length) {
    y = sectionTitle(doc, `Recent Comments (${data.comments.length})`, y);
    for (const c of data.comments.slice(0, 8)) y = bullet(doc, `${c.when} — ${c.who}: ${c.body}`, y);
  }

  if (data.history.length) {
    y = sectionTitle(doc, 'Audit History (latest)', y);
    for (const h of data.history.slice(0, 10)) y = bullet(doc, `${h.when} — ${h.who}: ${h.action.replace(/_/g, ' ')}${h.label ? ' — ' + h.label : ''}`, y, MUTED);
  }

  footer(doc);
  return doc;
}

/* ---------- Report PDF ---------- */
function reportPdf(report) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: report.title, Author: 'QualiCore QMS' } });
  header(doc, report.title, `QualiCore report · ${report.rows.length} record(s) · generated ${new Date().toLocaleString()}`);
  let y = 118;

  if (report.notes?.length) {
    for (const n of report.notes) y = bullet(doc, n, y, GREEN === '#2e8f1f' ? '#2e8f1f' : BLUE);
    y += 6;
  }

  const columns = (report.columns || []).map(c => ({ label: c.label, w: c.label.length + 8 }));
  y = simpleTable(doc, columns, report.rows.map(r => (report.columns || []).map(c => {
    const v = r[c.value];
    return v === null || v === undefined || v === '' ? '' : String(v);
  })), y);

  if (report.extras) {
    for (const ex of report.extras) {
      y = sectionTitle(doc, ex.title, y);
      y = simpleTable(doc, ex.columns, ex.rows, y);
    }
  }
  footer(doc);
  return doc;
}

/* ---------- Network / connections PDF ---------- */
function networkPdf(network) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: 'QualiCore — System Connections Map', Author: 'QualiCore QMS' } });
  header(doc, 'System Connections Map', `${network.nodes.length} connected records · ${network.edges.length} relationships · across all processes`);
  let y = 118;
  y = sectionTitle(doc, 'How the processes connect', y);
  doc.fillColor('#17203a').font('Helvetica').fontSize(9)
     .text('This document lists every live relationship in the system: incidents linked to suppliers, actions raised from risks and audits, documents governing departments, training linked to people, and more. Each line is a verified database relationship — not an assumption.', 50, y, { width: 495 });
  y += doc.heightOfString('This document lists every live relationship in the system: incidents linked to suppliers, actions raised from risks and audits, documents governing departments, training linked to people, and more. Each line is a verified database relationship — not an assumption.', { width: 495 }) + 12;

  y = sectionTitle(doc, 'Records by process', y);
  const counts = {};
  for (const n of network.nodes) counts[n.type] = (counts[n.type] || 0) + 1;
  for (const [t, c] of Object.entries(counts).sort((a, b) => b[1] - a[1])) y = bullet(doc, `${t}: ${c} record(s)`, y);

  y = sectionTitle(doc, `All connections (${network.edges.length})`, y);
  y = simpleTable(doc,
    [{ label: 'From', w: 90 }, { label: 'Record', w: 160 }, { label: 'Relationship', w: 120 }, { label: 'To', w: 160 }],
    network.edges.map(e => [e.fromType, e.fromLabel, e.rel, `${e.toType} · ${e.toLabel}`]), y);
  footer(doc);
  return doc;
}

module.exports = { recordPdf, reportPdf, networkPdf };
