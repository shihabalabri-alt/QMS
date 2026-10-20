// QualiCore Arabic layer: ask in Arabic, get Arabic-led answers.
// Strategy: normalize Arabic command/module/date words to English, run the
// normal pipeline (all permissions + grounding stay intact), then arabize
// the scaffolding (headline, buttons, sections). Data codes stay Latin.
function isArabic(s) { return /[\u0600-\u06FF]/.test(String(s || '')); }

// Ordered longest-first. Modules BEFORE bare verbs (سجل المخاطر must win over سجل).
const MODULES_AR = [
  ['سجل المخاطر', 'risk register'], ['إدارة المخاطر', 'risk register'],
  ['مراقبة الوثائق', 'document control'], ['المستندات', 'documents'], ['الوثائق', 'documents'], ['الدليل', 'documents'],
  ['الموردين', 'suppliers'], ['المورد', 'suppliers'], ['مورد', 'suppliers'], ['البائع', 'suppliers'],
  ['التقارير', 'reports'], ['تقرير', 'reports'], ['وثيقة', 'documents'], ['تقرير', 'reports'],
  ['الإجراءات', 'actions'], ['المهام', 'actions'], ['المهمة', 'actions'], ['إجراء', 'actions'], ['مهمة', 'actions'],
  ['السياسات', 'policies'], ['السياسة', 'policies'],
  ['التدقيق', 'audits'], ['عمليات التدقيق', 'audits'],
  ['الحوادث', 'incidents'], ['الحادث', 'incidents'], ['عدم المطابقة', 'nonconformance'],
  ['المعدات', 'equipment'], ['الأجهزة', 'equipment'],
  ['الأهداف', 'goals'], ['المؤشرات', 'KPIs'], ['مؤشرات الأداء', 'KPIs'],
  ['الامتثال', 'compliance'], ['التقويم', 'calendar'], ['المواعيد', 'calendar'],
  ['الإشعارات', 'notifications'], ['التنبيهات', 'notifications'],
  ['البريد', 'inbox'], ['الوارد', 'inbox'],
  ['لوحة القيادة', 'dashboard'], ['الرئيسية', 'dashboard'],
  ['المخاطر', 'risks'], ['الخطر', 'risks'], ['خطر', 'risks'],
  ['الموظفين', 'employees'], ['التدريب', 'trainings'], ['الكفاءات', 'competencies'],
  ['المراجعات الإدارية', 'management review'], ['الخريطة', 'connections map'],
  ['النشاط', 'activity'], ['سجل النشاط', 'recent activity'], ['سجل التغييرات', 'change log'], ['الإدارة', 'admin'], ['الأمان', 'security'],
  ['البحث', 'search'], ['المساعد', 'assistant'],
];

const VERBS_AR = [
  ['خذني إلى', 'take me to'], ['انتقل إلى', 'go to'], ['اذهب إلى', 'go to'],
  ['افتحي', 'open'], ['افتح', 'open'], ['اعرض', 'show'], ['أعرض', 'show'], ['اظهر', 'show'],
  ['أنشئ', 'create'], ['انشئ', 'create'], ['أضف', 'create'], ['سجل', 'create'],
  ['وافق', 'approve'], ['اعتمد', 'approve'], ['أرسل', 'submit'], ['قدم', 'submit'],
  ['أغلق', 'close'], ['أكمل', 'complete'], ['راقبي', 'watch'], ['راقب', 'watch'],
  ['قارن', 'compare'], ['لخص', 'summarize'], ['موجز', 'brief me'],
  ['ابحث', 'find'], ['أخبرني', 'tell me'], ['احذف', 'delete'],
];

const TIME_AR = [
  ['الأسبوع القادم', 'next week'], ['غدا', 'tomorrow'], ['غداً', 'tomorrow'], ['اليوم', 'today'],
  ['الاثنين', 'monday'], ['الثلاثاء', 'tuesday'], ['الأربعاء', 'wednesday'],
  ['الخميس', 'thursday'], ['الجمعة', 'friday'], ['السبت', 'saturday'], ['الأحد', 'sunday'],
  ['حرج', 'critical'], ['عاجل', 'critical'], ['عالية', 'high'], ['مهم', 'high'],
  ['جاهزين', 'ready'], ['جاهزون', 'ready'], ['جاهزة', 'ready'], ['جاهز', 'ready'],
  ['للتدقيق', 'audit'], ['استعداد', 'ready'], ['استعداداً', 'ready'], ['الاستعداد', 'prepared'],
  ['ملف الأدلة', 'evidence pack'], ['ملف أدلة', 'evidence pack'], ['بطاقة أدلة', 'evidence pack'], ['بطاقة', 'flashcard'],
  ['ماذا تغيّر', 'what changed'], ['ماذا تغير', 'what changed'], ['ماذا حدث', 'what happened'], ['ماذا حصل', 'what happened'],
  ['التغييرات الأخيرة', 'recent changes'], ['هذا الأسبوع', 'this week'],
  ['الأسبوع الماضي', 'last week'], ['هذا الشهر', 'this month'], ['الشهر الماضي', 'last month'],
  ['من المسؤول عن', 'who owns'], ['من المسؤول', 'who owns'], ['من يملك', 'who owns'], ['لمن يعود', 'who owns'],
  ['ضغط العمل', 'workload'], ['حمل العمل', 'workload'], ['توزيع العمل', 'workload'], ['الحمل الزائد', 'workload'],
  ['مشغول جداً', 'who is overloaded'], ['مشغول', 'who is busy'], ['من عنده أكثر', 'who has the most work'],
  ['مهدد بالتأخر', 'at risk of slipping'], ['مهدّد بالتأخر', 'at risk of slipping'], ['خطر التأخر', 'risk of slippage'],
  ['ما الذي سيتأخر', 'what will slip'], ['سيتأخر', 'will slip'], ['تأخر التسليم', 'risk of delay'],
];

function replaceAll(s, pairs) {
  let t = String(s || '');
  const sorted = [...pairs].sort((a, b) => b[0].length - a[0].length);
  for (const [ar, en] of sorted) t = t.split(ar).join(en);
  return t;
}

function normalize(q) {
  let t = replaceAll(q, MODULES_AR);
  t = replaceAll(t, VERBS_AR);
  t = replaceAll(t, TIME_AR);
  return t;
}

function base(user, intent) {
  return { intent, role: user.role, scope: 'arabic layer (rule-based)', generatedAt: new Date().toISOString(), facts: [], findings: [], recommendations: [], citations: [], evidence: [], actions: [], lang: 'ar' };
}

function quick(question, user) {
  const q = String(question || '').trim();
  const first = (user.name || '').split(' ')[0] || 'صديقي';
  if (/^(سلام|مرحبا|أهلا|اهلا|هلا|صباح الخير|صباح النور|مساء الخير|هاي)(?=\s|$)/.test(q)) {
    const a = base(user, 'site_guide');
    a.facts.push(`أهلاً ${first}! أنا مرشد QualiCore — اسألني أي شيء عن استخدام هذا الموقع.`);
    a.recommendations.push('جرّب: "افتح سجل المخاطر" · "أنشئ إجراء" · "موجز" · "قارن Nordic"');
    return a;
  }
  if (/شكرا|ممتاز|أحسنت|تمام/.test(q) && q.length < 30) {
    const a = base(user, 'site_guide');
    a.facts.push('العفو! أي شيء آخر عن الموقع، اسألني فقط.');
    return a;
  }
  if (/من أنت|ما أنت|عرف نفسك|ماذا تفعل|ساعدني|مساعدة|كيف استخدم|شرح/.test(q)) {
    const a = base(user, 'site_guide');
    a.facts.push('أنا المرشد المدمج في QualiCore. أشرح كل صفحة وميزة، وأجيب عن بيانات الجودة — فوراً وبدون إنترنت.');
    a.facts.push('أوامر تجربها: "افتح سجل المخاطر" · "أنشئ إجراء للاتصال بالمورد" · "وافق على POL-0005" · "موجز" · "قارن Nordic" · "راقب RSK-0001".');
    return a;
  }
  return null;
}

const HEADLINES = {
  do_action: 'تم — جارٍ التنفيذ.',
  create_draft: 'تم إعداد المسودة — راجعها ثم اضغط تأكيد.',
  approve_draft: 'تم إعداد الاعتماد — راجع ثم اضغط تأكيد.',
  watch_draft: 'تم إعداد المراقبة.',
  bulk_draft: 'تم إعداد الحركة الجماعية — راجع ثم اضغط تأكيد.',
  briefing: 'الموجز الصباحي:',
  month_pulse: 'نبض الشهر:',
  audit_readiness: 'جاهزية التدقيق:',
  evidence_pack: 'ملف الأدلة:',
  what_changed: 'سجل التغييرات:',
  workload: 'توزيع العمل:',
  ownership: 'المسؤولية:',
  slippage_risk: 'مهددون بالتأخر:',
  supplier_trend: 'اتجاه المورّد:',
  trend_analysis: 'اتجاه المؤشرات:',
  site_guide: 'دليل الموقع:',
  my_approvals: 'بانتظار توقيعك:',
  watch_list: 'قائمتك تحت المراقبة:',
  multi_task: 'رسالة كبيرة — قسمتها إلى مهام ونفذتها كلها:',
  clarify: 'أحتاج توضيحاً:',
  no_access: 'لا صلاحية:',
};

function labelAr(label) {
  let t = String(label || '');
  t = t.replace(/^Open actions board$/, 'فتح لوحة الإجراءات');
  t = t.replace(/^Open activity$/, 'فتح سجل النشاط');
  t = t.replace(/^Open Actions$/, 'فتح الإجراءات');
  t = t.replace(/^Open Audits$/, 'فتح التدقيقات');
  t = t.replace(/^Open /, 'فتح ');
  t = t.replace(/^Confirm & create$/, 'تأكيد وإنشاء');
  t = t.replace(/^Confirm & (.+)$/, 'تأكيد $1');
  t = t.replace(/^Stop watching$/, 'إيقاف المراقبة');
  t = t.replace(/ →$/, '');
  return t;
}

function offTopicAr(user) {
  const a = base(user, 'off_topic');
  a.facts.push('أنا مرشد QualiCore — أجيب عن أسئلة استخدام الموقع وبيانات الجودة.');
  a.facts.push('لا أستطيع المساعدة في هذا الموضوع، ولا أخمّن أبداً.');
  a.recommendations.push('جرّب: "افتح التقارير" · "أنشئ إجراء" · "موجز".');
  return a;
}

// Post-process any pipeline answer into Arabic-led form.
function arabize(answer, user) {
  if (!answer || answer.lang === 'ar') return answer;
  answer.lang = 'ar';
  const h = HEADLINES[answer.intent] || 'إليك ما وجدته:';
  (answer.facts = answer.facts || []).unshift(h);
  for (const x of (answer.actions || [])) {
    if (x && x.label) x.label = labelAr(x.label);
  }
  return answer;
}

module.exports = { isArabic, normalize, quick, arabize, offTopicAr };
