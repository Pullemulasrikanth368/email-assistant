/**
 * Baked-in brief used when OpenAI is unavailable or returns invalid JSON, so
 * the report screen always renders something coherent. Mirrors the approved
 * wireframe scenario (Site B / QF-8473). sourceIds are placeholders.
 */
const sampleBrief = {
  narrative:
    "Good morning — it's a heavy one. Site B is the story: an FDA inspection starts Tuesday 9am with a 15-day 483 clock still open, and it collides with a customer audit the same morning. Batch QF-8473 has an out-of-spec result on EU launch stock — Regulatory wants a recall decision today. Supplier ABC's API delay means a shortage in five days. Three things need your decision today.",
  triage: [
    { sourceId: 'sample-e001', tier: 'Critical', reason: 'FDA inspection + open 483, 15-day clock' },
    { sourceId: 'sample-e002', tier: 'Critical', reason: 'OOS on EU launch stock, 24h to assign' },
    { sourceId: 'sample-e003', tier: 'Critical', reason: 'Recall decision due today, reportable timeline' },
    { sourceId: 'sample-e004', tier: 'Critical', reason: 'Supplier API delay — shortage in 5 days' },
    { sourceId: 'sample-e005', tier: 'Critical', reason: 'Line 4 down — 2-day delay on US Metformin' },
    { sourceId: 'sample-e006', tier: 'Important', reason: 'Customer audit clashes with FDA inspection' },
    { sourceId: 'sample-e007', tier: 'Low', reason: 'Newsletter — no action' },
  ],
  decisionQueue: [
    { title: 'Decide field action / recall for QF-8473', why: 'OOS on EU launch stock; reportable timeline may apply', deadline: 'Today', sourceId: 'sample-e003' },
    { title: 'Release emergency PO to alternate supplier DEF', why: 'Avoids shortage halting two packaging lines in 5 days', deadline: 'Today', sourceId: 'sample-e004' },
    { title: 'Approve expedited freight for Line 4 servo', why: 'Prevents 2-day delay on US Metformin commitment', deadline: 'Today', sourceId: 'sample-e005' },
  ],
  risks: [
    { category: 'Quality', summary: 'OOS + cold-chain excursion on QF-8473 (EU launch)', likelihood: 4, impact: 5, riskScore: 20, clock: 'decision today', affectedArea: 'Site B · EU launch stock', mitigation: 'Open deviation, assign QC, convene recall call', trend: 'Escalating', sourceId: 'sample-e002' },
    { category: 'Regulatory', summary: 'FDA inspection Tuesday with an open 483 response due', likelihood: 5, impact: 4, riskScore: 20, clock: '15-day window', affectedArea: 'Site B', mitigation: 'Finalize 483 response, brief QA lead, pre-stage records', trend: 'New', sourceId: 'sample-e001' },
    { category: 'Supply', summary: 'Supplier ABC API delay — shortage halts two lines', likelihood: 4, impact: 4, riskScore: 16, clock: '5 days', affectedArea: 'Packaging lines 1 & 2', mitigation: 'Release emergency PO to alternate supplier DEF', trend: 'New', sourceId: 'sample-e004' },
    { category: 'Manufacturing', summary: 'Buried: WFI pump wear risks 48-hour sterile-suite outage', likelihood: 3, impact: 4, riskScore: 12, clock: 'if no spare', affectedArea: 'Sterile suite', mitigation: 'Confirm bearing stock now, expedite spare', trend: 'New', sourceId: 'sample-e008' },
  ],
  todoList: [
    { task: 'Make recall decision for QF-8473', deadline: 'Today', status: 'Open', sourceId: 'sample-e003' },
    { task: 'Approve emergency PO', deadline: 'Today', status: 'Open', sourceId: 'sample-e004' },
    { task: 'Approve Line 4 freight', deadline: 'Today', status: 'Open', sourceId: 'sample-e005' },
    { task: 'Send distributor revised ETA', deadline: 'Tomorrow', status: 'Open', sourceId: 'sample-e009' },
    { task: 'Provide board ops slides', deadline: 'Friday', status: 'Open', sourceId: 'sample-e010' },
  ],
  actions: [
    { task: 'Finalize 483 response', owner: 'QA Lead', deadline: 'Mon', sourceId: 'sample-e001' },
    { task: 'Assign QC investigation for QF-8473', owner: 'QC', deadline: '24h', sourceId: 'sample-e002' },
    { task: 'Confirm WFI bearing stock', owner: 'Maintenance', deadline: '24h', sourceId: 'sample-e008' },
  ],
  collisions: [
    { type: 'Inspection', summary: 'FDA inspection 9:00 + customer audit 9:30, same site', when: 'Tue 9:00', items: ['sample-e001', 'sample-e006'], suggestion: 'Keep QA lead on FDA; move audit to pm' },
    { type: 'Deadline', summary: 'Four deliverables stacked on Friday', when: 'Fri', items: ['sample-e010'], suggestion: 'Block Thursday pm; delegate CAPA + Atlas deck' },
  ],
  patterns: [
    'Site B accounts for the majority of critical events — cold chain and the inspection. Worth a focused site review.',
  ],
  deadlines: [
    { date: 'Tue', item: 'FDA inspection — Site B', sourceId: 'sample-e001' },
    { date: 'Today', item: 'QF-8473 recall decision', sourceId: 'sample-e003' },
    { date: 'Friday', item: 'Board deck ops section', sourceId: 'sample-e010' },
  ],
};

export default sampleBrief;
