import { describe, it, expect } from 'vitest';
import { assembleExtraction, assembleLead } from './extractLead.js';

describe('assembleExtraction (pure validation of raw LLM output)', () => {
  it('trims text and maps blanks to undefined', () => {
    const e = assembleExtraction({
      callerName: '  Jane Doe ',
      phone: '',
      email: '   ',
      problem: 'tooth pain',
      treatment: '',
      bookingStatus: 'booked',
      bookedAt: '2026-06-25T15:00:00',
      confirmed: true,
      missedOpportunity: false,
      missedOpportunityReason: '',
      humanActionNeeded: false,
      humanActionReason: '   ',
    });
    expect(e.callerName).toBe('Jane Doe');
    expect(e.phone).toBeUndefined();
    expect(e.email).toBeUndefined();
    expect(e.treatment).toBeUndefined();
    expect(e.bookedAt).toBe('2026-06-25T15:00:00');
    expect(e.confirmed).toBe(true);
    expect(e.missedOpportunity).toBe(false);
    expect(e.humanActionReason).toBeUndefined();
  });

  it('falls back to unknown for an invalid booking status and coerces signal booleans', () => {
    const e = assembleExtraction({
      bookingStatus: 'maybe',
      confirmed: 'yes' as unknown as boolean,
      missedOpportunity: true,
      missedOpportunityReason: 'asked about whitening, never offered a booking',
      humanActionNeeded: undefined,
    });
    expect(e.bookingStatus).toBe('unknown');
    expect(e.confirmed).toBe(false); // only strict true counts
    expect(e.missedOpportunity).toBe(true);
    expect(e.missedOpportunityReason).toBe('asked about whitening, never offered a booking');
    expect(e.humanActionNeeded).toBe(false);
  });
});

describe('assembleLead (extraction + contact → CallLead)', () => {
  const extraction = assembleExtraction({
    callerName: 'Transcript Name',
    phone: '555-0000',
    email: '',
    problem: 'implant consult',
    treatment: 'dental implant',
    bookingStatus: 'not_booked',
    bookedAt: '',
    confirmed: false,
    missedOpportunity: true,
    missedOpportunityReason: 'wanted an implant, no booking was offered',
    humanActionNeeded: true,
    humanActionReason: 'call the lead back to schedule',
  });

  it('prefers the authoritative contact record over transcript identity, and carries signals', () => {
    const lead = assembleLead({
      callId: 'c1',
      locationId: 'loc',
      agentId: 'agentA',
      contactId: 'ct1',
      extraction,
      contact: { name: 'Contact Name', phone: '555-1234', email: 'jane@example.com' },
    });
    expect(lead.callerName).toBe('Contact Name'); // contact wins over transcript
    expect(lead.phone).toBe('555-1234');
    expect(lead.email).toBe('jane@example.com'); // contact fills the gap the transcript left
    expect(lead.treatment).toBe('dental implant'); // non-identity comes straight from extraction
    expect(lead.source).toBe('llm'); // no native extractedData → facts are LLM/contact
    expect(lead.missedOpportunity).toBe(true);
    expect(lead.humanActionNeeded).toBe(true);
  });

  it('falls back to transcript identity when the contact record is absent', () => {
    const lead = assembleLead({ callId: 'c2', locationId: 'loc', extraction, contact: undefined });
    expect(lead.callerName).toBe('Transcript Name');
    expect(lead.phone).toBe('555-0000');
    expect(lead.email).toBeUndefined();
    expect(lead.source).toBe('llm');
  });

  it('native extractedData outranks both contact and LLM for facts; signals stay LLM', () => {
    const lead = assembleLead({
      callId: 'c3',
      locationId: 'loc',
      extraction, // LLM says: not_booked, missedOpportunity=true, humanActionNeeded=true
      contact: { name: 'Contact Name', phone: '555-1234' },
      extractedData: {
        name: 'Native',
        'Last Name': 'Truth',
        Phone: '+15550001111',
        'Treatment Interest': 'cleaning',
        bookingInterest: 'Booked',
      },
    });
    expect(lead.callerName).toBe('Native Truth'); // native beats contact + LLM
    expect(lead.phone).toBe('+15550001111');
    expect(lead.treatment).toBe('cleaning');
    expect(lead.bookingStatus).toBe('booked'); // native bookingInterest beats LLM not_booked
    expect(lead.source).toBe('ghl');
    expect(lead.native).toMatchObject({ bookingInterest: 'Booked' });
    // Signals are unchanged — always the LLM's judgment.
    expect(lead.missedOpportunity).toBe(true);
    expect(lead.humanActionNeeded).toBe(true);
  });
});
