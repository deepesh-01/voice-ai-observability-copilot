import { describe, it, expect } from 'vitest';
import { buildReviseSystemPrompt, buildReviseUserPrompt } from './applyRecommendation.js';
import type { Recommendation } from './types.js';

const rec: Recommendation = {
  title: 'Always capture a contact detail',
  kind: 'prompt',
  priority: 'high',
  kpi: 'info_capture',
  problem: 'The agent ends bookings without a phone or email on several calls.',
  fix: 'Before confirming a booking, require at least one of phone or email.',
  rationale: 'No contact detail means no confirmation can be sent.',
  evidenceCallIds: ['call-1', 'call-2'],
};

describe('buildReviseSystemPrompt', () => {
  it('instructs a complete, minimal, content-preserving rewrite', () => {
    const s = buildReviseSystemPrompt();
    expect(s).toMatch(/COMPLETE revised prompt/);
    expect(s).toMatch(/MINIMAL edit/);
    expect(s).toMatch(/Preserve all existing content/);
    expect(s).toMatch(/changeSummary/);
  });
});

describe('buildReviseUserPrompt', () => {
  it('embeds the current prompt and every recommendation field', () => {
    const u = buildReviseUserPrompt('You are Jessica, a receptionist.', rec);
    expect(u).toContain('You are Jessica, a receptionist.');
    expect(u).toContain(rec.title);
    expect(u).toContain(rec.problem);
    expect(u).toContain(rec.fix);
    expect(u).toContain(rec.rationale);
    expect(u).toContain(rec.kpi);
  });
});
