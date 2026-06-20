import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { config } from '../config.js';
import { PostgresLeadRepository } from './leadRepository.js';
import { PostgresRawCallRepository } from './rawCallRepository.js';
import { getPool, closePool } from '../db/pool.js';
import { assembleExtraction } from '../analysis/extractLead.js';
import type { CallLead } from '../analysis/types.js';

// Integration test — runs only when a Postgres DATABASE_URL is configured.
const run = config.databaseUrl ? describe : describe.skip;

const LOC = '__test_lead_loc__';
const leads = new PostgresLeadRepository();
const rawRepo = new PostgresRawCallRepository();

function lead(callId: string, agentId: string, over: Partial<CallLead> = {}): CallLead {
  return {
    callId,
    locationId: LOC,
    agentId,
    bookingStatus: 'booked',
    confirmed: true,
    missedOpportunity: false,
    humanActionNeeded: false,
    source: 'llm',
    extraction: assembleExtraction({ bookingStatus: 'booked', confirmed: true }),
    ...over,
  };
}

run('PostgresLeadRepository (integration)', () => {
  beforeAll(async () => {
    await leads.init();
    // raw_call is the FK parent for call_lead; deleting it cascades to leads.
    await getPool().query('DELETE FROM raw_call WHERE location_id = $1', [LOC]);
    for (const id of ['L1', 'L2']) {
      await rawRepo.saveRaw({ callId: id, locationId: LOC, agentId: 'agentA', payload: { id } });
    }
  });
  afterAll(async () => {
    await getPool().query('DELETE FROM raw_call WHERE location_id = $1', [LOC]);
    await closePool();
  });

  it('saves and reads back a lead with its signals', async () => {
    await leads.saveLead(
      lead('L1', 'agentA', {
        phone: '555-1',
        callerName: 'Jane',
        treatment: 'cleaning',
        humanActionNeeded: true,
        humanActionReason: 'confirm the booking',
        source: 'ghl',
        native: { bookingInterest: 'Booked', Phone: '555-1' },
      }),
    );
    const got = await leads.getLead('L1');
    expect(got?.phone).toBe('555-1');
    expect(got?.callerName).toBe('Jane');
    expect(got?.treatment).toBe('cleaning');
    expect(got?.bookingStatus).toBe('booked');
    expect(got?.humanActionNeeded).toBe(true);
    expect(got?.humanActionReason).toBe('confirm the booking');
    expect(got?.missedOpportunity).toBe(false);
    expect(got?.source).toBe('ghl'); // provenance round-trips
    expect(got?.native).toMatchObject({ bookingInterest: 'Booked' });
  });

  it('upserts on the same call id (no duplicate)', async () => {
    await leads.saveLead(lead('L1', 'agentA', { phone: '555-2', humanActionNeeded: false }));
    const list = await leads.listLeads({ locationId: LOC });
    expect(list.filter((l) => l.callId === 'L1')).toHaveLength(1);
    expect((await leads.getLead('L1'))?.phone).toBe('555-2');
  });

  it('filters by booking status and by the two observability signals', async () => {
    await leads.saveLead(
      lead('L2', 'agentA', {
        bookingStatus: 'not_booked',
        confirmed: false,
        missedOpportunity: true,
        missedOpportunityReason: 'asked about implants, never offered a booking',
      }),
    );
    const booked = await leads.listLeads({ locationId: LOC, bookingStatus: 'booked' });
    expect(booked.map((l) => l.callId)).toEqual(['L1']);

    const missed = await leads.listLeads({ locationId: LOC, missedOpportunity: true });
    expect(missed.map((l) => l.callId)).toEqual(['L2']);

    // L1's humanActionNeeded was cleared by the upsert above, so this is empty.
    const action = await leads.listLeads({ locationId: LOC, humanActionNeeded: true });
    expect(action.map((l) => l.callId)).toEqual([]);
  });

  it('cascade-deletes the lead when its raw call is deleted', async () => {
    await getPool().query('DELETE FROM raw_call WHERE call_id = $1', ['L2']);
    expect(await leads.getLead('L2')).toBeNull();
    // restore the raw row for any later runs in this process
    await rawRepo.saveRaw({ callId: 'L2', locationId: LOC, agentId: 'agentA', payload: { id: 'L2' } });
  });
});
