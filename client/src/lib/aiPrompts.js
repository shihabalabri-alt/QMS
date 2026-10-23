// One catalog for every AI entry point: the floating assistant and the AI page.
// Grouped so the full power list fits without a wall of chips.

export const AI_GROUPS = [
  {
    title: 'Start here',
    prompts: [
      'Brief me',
      'Show me what needs attention',
      'What needs my signature?',
      'Show overdue actions'
    ]
  },
  {
    title: 'Quality events',
    prompts: [
      'Why does this keep happening?',
      'Are our corrective actions working?',
      'What changed this week?',
      'What is missing from our records?'
    ]
  },
  {
    title: 'Risk & audit',
    prompts: [
      'Are we ready for an audit?',
      'Which risks are getting worse?',
      'What if EQ-0007 fails?',
      'Watch RSK-0001'
    ]
  },
  {
    title: 'Supply',
    prompts: [
      'Are we too dependent on one supplier?',
      'Which suppliers have repeated problems?',
      'Compare Nordic'
    ]
  },
  {
    title: 'People',
    prompts: [
      'Who is overloaded?',
      'Who is not qualified?',
      'What is at risk of slipping?'
    ]
  },
  {
    title: 'Plan & review',
    prompts: [
      'Prep me for the management review',
      'Prepare a management review summary',
      'Are we better than last month?',
      'How are the KPIs trending?',
      'Which documents need review?'
    ]
  },
  {
    title: 'Do it',
    prompts: [
      'Open documents on Quality Manual',
      'Take me to the risk register',
      'Create an action to call the supplier',
      'Escalate all overdue actions',
      'Turn on dark mode'
    ]
  }
];

export const AI_PROMPT_COUNT = AI_GROUPS.reduce((n, g) => n + g.prompts.length, 0);

const PAGE_CONTEXTS = [
  { test: /^\/equipment/, label: 'Equipment', prompts: ['What calibration is due?', 'What if EQ-0007 fails?', 'Are we ready for an audit?'] },
  { test: /^\/suppliers/, label: 'Suppliers', prompts: ['Are we too dependent on one supplier?', 'Which suppliers have repeated problems?', 'What is missing from our records?'] },
  { test: /^\/nonconformances/, label: 'NC & Incidents', prompts: ['Are our corrective actions working?', 'Why does this keep happening?', 'What is missing from our records?'] },
  { test: /^\/risks/, label: 'Risk Register', prompts: ['Which risks are getting worse?', 'Watch RSK-0001', 'Are we ready for an audit?'] },
  { test: /^\/actions/, label: 'Actions', prompts: ['What is at risk of slipping?', 'Who is overloaded?', 'What changed this week?'] },
  { test: /^\/competenc/, label: 'Competencies', prompts: ['Who is not qualified?', 'Who needs training?', 'What is missing from our records?'] },
  { test: /^\/trainings/, label: 'Training', prompts: ['Who needs training?', 'Who is not qualified?', 'What changed this month?'] },
  { test: /^\/(documents|policies)/, label: 'Document control', prompts: ['Which documents need review?', 'What is missing from our records?', 'Are we ready for an audit?'] },
  { test: /^\/audits/, label: 'Audits', prompts: ['Are we ready for an audit?', 'Are our corrective actions working?', 'What is missing from our records?'] },
  { test: /^\/compliance/, label: 'Compliance', prompts: ['Are we ready for an audit?', 'What is missing from our records?', 'Show me what needs attention'] },
  { test: /^\/mgmt-reviews/, label: 'Management review', prompts: ['Prep me for the management review', 'Are we better than last month?', 'Brief me'] },
  { test: /^\/(goals|reports|intelligence)/, label: 'Performance', prompts: ['How are the KPIs trending?', 'Are we better than last month?', 'Brief me'] },
  { test: /^\/employees/, label: 'People', prompts: ['Who is overloaded?', 'Who is not qualified?', 'Show me what needs attention'] },
  { test: /^\/design/, label: 'Design', prompts: ['Are we ready for an audit?', 'What is missing from our records?', 'What changed this week?'] },
  { test: /^\/(activity|notifications|inbox|search|calendar)/, label: 'Activity', prompts: ['What changed this week?', 'Brief me', 'Show me what needs attention'] },
  { test: /^\/ai/, label: 'AI Assistant', prompts: ['Brief me', 'Show me what needs attention', 'What changed this week?'] }
];

export function contextFor(pathname) {
  const hit = PAGE_CONTEXTS.find(x => x.test.test(pathname || '/'));
  return hit || { label: 'Your QMS', prompts: ['Brief me', 'Show me what needs attention', 'What changed this week?'] };
}
