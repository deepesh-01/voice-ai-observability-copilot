import type { Page, Route } from '@playwright/test';

/**
 * Deterministic API mocking for the dashboard E2E tests. The frontend is what's
 * under test here (the backend has its own integration tests), so we intercept the
 * API at the browser layer with fixtures that mirror the REAL response shapes
 * captured from the live backend (see docs/screenshots + S-013). No DB, no Opus,
 * no network — fully hermetic and fast.
 */

export const LOC = 'B7TzvBb6H6QvDNdEEhlt';
export const AGENT = '6a35206c88ba8e0f1c707f02';
export const AGENT_NAME = 'BrightSmile Dental — Booking';
export const CALL_ID = 'call-aaa-0001';

/**
 * A 10-turn transcript (indices 0–9 after parsing) so evidence/useAction/deviation
 * indices below are all valid and stable to assert against.
 */
const TRANSCRIPT = [
  'bot:Hi, thanks for calling BrightSmile Dental, this is Jessica. Are you looking to book an appointment?',
  'human:Yes, I would like to book a cleaning.',
  'bot:Great, I can help with that. Can I get your full name?',
  'human:Dipesh.',
  'bot:And your email so I can send a confirmation?',
  'human:Do you really need my email?',
  'bot:No problem, a phone number works too. What day suits you?',
  'human:Saturday at 11am.',
  'bot:Booked for Saturday at 11am. Anything else?',
  'human:No, that is all, thank you!',
].join('\n');

const ANALYSIS = {
  callId: CALL_ID,
  agentId: AGENT,
  overallScore: 85,
  summary: 'Booked and confirmed the appointment; main weakness was dropping the email at the first objection.',
  kpiScores: [
    { key: 'goal_completion', score: 90, rationale: 'Appointment booked and confirmed.', evidence: [8, 9] },
    { key: 'script_adherence', score: 63, rationale: 'Skipped the reason-for-visit step.', evidence: [0, 6] },
    { key: 'info_capture', score: 50, rationale: 'Only first name; email dropped.', evidence: [3, 5] },
    { key: 'objection_handling', score: 76, rationale: 'Conceded on email quickly.', evidence: [5, 6] },
    { key: 'sentiment', score: 80, rationale: 'Caller satisfied by the end.', evidence: [9] },
    { key: 'accuracy', score: 88, rationale: 'Stayed factual.', evidence: [2] },
  ],
  deviations: [
    { severity: 'high', kpi: 'info_capture', description: 'Dropped the required email at first objection.', turnIndex: 5 },
    { severity: 'medium', kpi: 'info_capture', description: 'Captured only the caller first name.', turnIndex: 3 },
    { severity: 'low', kpi: 'script_adherence', description: 'Did not confirm the reason for the visit.' },
  ],
  useActions: [
    {
      label: 'Email objection conceded',
      reason: 'Agent dropped the required email at the first pushback instead of reassuring once.',
      startTurn: 4,
      endTurn: 6,
    },
  ],
};

const STORED_CALL = {
  analysis: ANALYSIS,
  locationId: LOC,
  durationSec: 116,
  callAt: '2026-06-19T13:44:17.882Z',
  rawCall: { id: CALL_ID, agentId: AGENT, duration: 116, transcript: TRANSCRIPT },
};

const ANALYSES = [
  { callId: CALL_ID, agentId: AGENT, overallScore: 85, summary: 'Smooth booking; dropped email on objection.', durationSec: 116, callAt: '2026-06-19T13:44:17.882Z' },
  { callId: 'call-bbb-0002', agentId: AGENT, overallScore: 60, summary: 'Lost the caller on price.', durationSec: 95, callAt: '2026-06-19T12:10:00.000Z' },
  { callId: 'call-ccc-0003', agentId: AGENT, overallScore: 20, summary: 'Misconfigured greeting; no booking progress.', durationSec: 40, callAt: '2026-06-19T11:00:00.000Z' },
];

const KPI_AVERAGES = [
  { agentId: AGENT, kpiKey: 'accuracy', avgScore: 86, calls: 5 },
  { agentId: AGENT, kpiKey: 'goal_completion', avgScore: 63, calls: 5 },
  { agentId: AGENT, kpiKey: 'info_capture', avgScore: 52, calls: 5 },
  { agentId: AGENT, kpiKey: 'objection_handling', avgScore: 76, calls: 5 },
  { agentId: AGENT, kpiKey: 'script_adherence', avgScore: 63, calls: 5 },
  { agentId: AGENT, kpiKey: 'sentiment', avgScore: 79, calls: 5 },
];

const RECOMMENDATIONS = {
  agentId: AGENT,
  callsAnalyzed: 5,
  kpiAverages: KPI_AVERAGES.map((k) => ({ key: k.kpiKey, avgScore: k.avgScore, calls: k.calls })),
  summary: 'Warm and accurate but leaks required data; biggest win is enforcing email capture.',
  recommendations: [
    {
      title: 'Force full-name and email capture',
      kind: 'prompt',
      priority: 'high',
      kpi: 'info_capture',
      problem: 'Agent captures only first names and abandons email at the first objection.',
      fix: 'Before booking, ask for and confirm the caller\'s full name and email. Do not proceed until both are captured.',
      rationale: 'info_capture is the weakest KPI (52/100).',
      evidenceCallIds: [CALL_ID, 'call-bbb-0002'],
    },
    {
      title: 'Fix the opening greeting / agent identity',
      kind: 'configuration',
      priority: 'high',
      kpi: 'script_adherence',
      problem: 'One call opened with a generic "Demo" greeting and made zero booking progress.',
      fix: 'Set the first message to the BrightSmile identity: "Thanks for calling BrightSmile Dental, this is Jessica."',
      rationale: 'A single misconfiguration tanked an entire call.',
      evidenceCallIds: ['call-ccc-0003'],
    },
  ],
};

/**
 * Per-call leads + the two observability signals (R2.3 missed opportunity, R2.6 human
 * action needed). Mirrors the real /api/leads shape (CallLead). Mix of `ghl` (native
 * extractedData ground-truth) and `llm` (inferred) provenance so the source badge,
 * native drawer, and signal counts all have data to render.
 */
const LEADS = [
  {
    callId: CALL_ID,
    locationId: LOC,
    agentId: AGENT,
    callerName: 'Dipesh',
    phone: '+17987215728',
    treatment: 'Teeth cleaning',
    bookingStatus: 'booked',
    bookedAt: '2026-06-22T11:00:00.000Z',
    confirmed: true,
    missedOpportunity: true,
    missedOpportunityReason: 'Caller asked about whitening; agent never offered to add it to the booking.',
    humanActionNeeded: false,
    source: 'ghl',
    native: {
      name: 'Dipesh',
      Phone: '+17987215728',
      'Last Name': 'Rathore',
      'Treatment Interest': 'Teeth cleaning',
      bookingInterest: 'Booked',
      DateTimeOfBooking: 'Jun 22 2026 11:00',
    },
  },
  {
    callId: 'call-bbb-0002',
    locationId: LOC,
    agentId: AGENT,
    callerName: 'Priya',
    problem: 'Asked about implant pricing',
    treatment: 'Dental implant',
    bookingStatus: 'not_booked',
    confirmed: false,
    missedOpportunity: true,
    missedOpportunityReason: 'Caller showed intent on implants but the agent ended the call without booking or capturing contact info.',
    humanActionNeeded: true,
    humanActionReason: 'Out-of-scope implant request — needs a human to follow up with a referral.',
    source: 'llm',
    native: null,
  },
  {
    callId: 'call-ccc-0003',
    locationId: LOC,
    agentId: AGENT,
    bookingStatus: 'unknown',
    confirmed: false,
    missedOpportunity: false,
    humanActionNeeded: false,
    source: 'llm',
    native: null,
  },
];

const LEAD_BY_ID = new Map(LEADS.map((l) => [l.callId, l]));

export interface MockOptions {
  /** Return an empty analyses list (drives the "no calls yet" empty state). */
  empty?: boolean;
  /** Fail every /api call with 500 (drives the error + retry state). */
  fail?: boolean;
  /** Delay (ms) before the recommendations response resolves (to assert the Opus "synthesizing…" state). */
  recsDelayMs?: number;
}

function json(route: Route, data: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
}

/** Install all route mocks. Call before page.goto. */
export async function mockApi(page: Page, opts: MockOptions = {}): Promise<void> {
  await page.route('**/health', (route) => json(route, { ok: true }));

  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;

    // installs/status always succeed so the app shell loads — `fail` only breaks the
    // DATA endpoints, which is what exercises the per-view error+retry state.
    if (p.endsWith('/api/installs')) return json(route, { installs: [LOC] });
    if (p.includes('/api/installs/') && p.endsWith('/status')) {
      return json(route, { key: LOC, connected: true, voiceAiScopeOk: true, detail: 'Connected and scoped.' });
    }
    if (p.endsWith('/api/agents')) return json(route, { agents: [{ id: AGENT, name: AGENT_NAME }] });

    if (opts.fail) return json(route, { error: 'mock failure' }, 500);

    if (p.endsWith('/api/kpis/averages')) {
      return json(route, { averages: opts.empty ? [] : KPI_AVERAGES });
    }
    if (/\/api\/analyses\/.+/.test(p)) return json(route, STORED_CALL);
    if (p.endsWith('/api/analyses')) return json(route, { analyses: opts.empty ? [] : ANALYSES });
    // Leads: single-call lead (drives the call view's Lead & Outcome panel) and the
    // list (drives agent/overview signal counts + filters).
    const leadMatch = /\/api\/leads\/(.+)$/.exec(p);
    if (leadMatch) {
      const lead = LEAD_BY_ID.get(decodeURIComponent(leadMatch[1]));
      return lead ? json(route, lead) : json(route, { error: 'no lead' }, 404);
    }
    if (p.endsWith('/api/leads')) return json(route, { leads: opts.empty ? [] : LEADS });
    if (p.endsWith('/api/recommendations')) {
      if (opts.recsDelayMs) await new Promise((r) => setTimeout(r, opts.recsDelayMs));
      return json(route, RECOMMENDATIONS);
    }
    return json(route, { error: `unmocked ${p}` }, 404);
  });
}
