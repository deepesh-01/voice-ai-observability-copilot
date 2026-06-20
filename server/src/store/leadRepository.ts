import { getPool, initSchema } from '../db/pool.js';
import { UNASSIGNED_AGENT } from './analysisRepository.js';
import type { BookingStatus, CallLead, LeadExtraction, LeadSource } from '../analysis/types.js';

export interface ListLeadsOpts {
  locationId: string;
  agentId?: string;
  bookingStatus?: BookingStatus;
  /** Filter to leads flagged as a missed opportunity (R2.3). */
  missedOpportunity?: boolean;
  /** Filter to leads needing a human action (R2.6). */
  humanActionNeeded?: boolean;
  limit?: number;
}

/**
 * Storage for per-call lead facts + observability signals. Same swappable-interface
 * pattern as AnalysisRepository (ADR-0008): Postgres today. No approval/workflow methods —
 * the signals are read-only observability, not a booking-management workflow.
 */
export interface LeadRepository {
  init(): Promise<void>;
  saveLead(lead: CallLead): Promise<void>;
  getLead(callId: string): Promise<CallLead | null>;
  listLeads(opts: ListLeadsOpts): Promise<CallLead[]>;
}

interface LeadRow {
  call_id: string;
  location_id: string;
  agent_id: string | null;
  contact_id: string | null;
  caller_name: string | null;
  phone: string | null;
  email: string | null;
  problem: string | null;
  treatment: string | null;
  booking_status: string;
  booked_at: Date | null;
  confirmed: boolean;
  missed_opportunity: boolean;
  missed_opportunity_reason: string | null;
  human_action_needed: boolean;
  human_action_reason: string | null;
  source: string;
  native: Record<string, unknown> | null;
  extraction: LeadExtraction;
  created_at: Date;
}

function rowToLead(r: LeadRow): CallLead {
  return {
    callId: r.call_id,
    locationId: r.location_id,
    agentId: r.agent_id ?? undefined,
    contactId: r.contact_id ?? undefined,
    callerName: r.caller_name ?? undefined,
    phone: r.phone ?? undefined,
    email: r.email ?? undefined,
    problem: r.problem ?? undefined,
    treatment: r.treatment ?? undefined,
    bookingStatus: r.booking_status as BookingStatus,
    bookedAt: r.booked_at ? r.booked_at.toISOString() : undefined,
    confirmed: r.confirmed,
    missedOpportunity: r.missed_opportunity,
    missedOpportunityReason: r.missed_opportunity_reason ?? undefined,
    humanActionNeeded: r.human_action_needed,
    humanActionReason: r.human_action_reason ?? undefined,
    source: (r.source as LeadSource) ?? 'llm',
    native: r.native ?? null,
    extraction: r.extraction,
    createdAt: r.created_at ? r.created_at.toISOString() : undefined,
  };
}

export class PostgresLeadRepository implements LeadRepository {
  async init(): Promise<void> {
    await initSchema();
  }

  async saveLead(lead: CallLead): Promise<void> {
    await getPool().query(
      `INSERT INTO call_lead
         (call_id, location_id, agent_id, contact_id, caller_name, phone, email, problem,
          treatment, booking_status, booked_at, confirmed, missed_opportunity,
          missed_opportunity_reason, human_action_needed, human_action_reason, source, native, extraction)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (call_id) DO UPDATE SET
         location_id=EXCLUDED.location_id, agent_id=EXCLUDED.agent_id,
         contact_id=EXCLUDED.contact_id, caller_name=EXCLUDED.caller_name,
         phone=EXCLUDED.phone, email=EXCLUDED.email, problem=EXCLUDED.problem,
         treatment=EXCLUDED.treatment, booking_status=EXCLUDED.booking_status,
         booked_at=EXCLUDED.booked_at, confirmed=EXCLUDED.confirmed,
         missed_opportunity=EXCLUDED.missed_opportunity,
         missed_opportunity_reason=EXCLUDED.missed_opportunity_reason,
         human_action_needed=EXCLUDED.human_action_needed,
         human_action_reason=EXCLUDED.human_action_reason,
         source=EXCLUDED.source, native=EXCLUDED.native, extraction=EXCLUDED.extraction`,
      [
        lead.callId,
        lead.locationId,
        lead.agentId ?? null,
        lead.contactId ?? null,
        lead.callerName ?? null,
        lead.phone ?? null,
        lead.email ?? null,
        lead.problem ?? null,
        lead.treatment ?? null,
        lead.bookingStatus,
        lead.bookedAt ?? null,
        lead.confirmed,
        lead.missedOpportunity,
        lead.missedOpportunityReason ?? null,
        lead.humanActionNeeded,
        lead.humanActionReason ?? null,
        lead.source,
        lead.native ? JSON.stringify(lead.native) : null,
        JSON.stringify(lead.extraction),
      ],
    );
  }

  async getLead(callId: string): Promise<CallLead | null> {
    const { rows } = await getPool().query<LeadRow>('SELECT * FROM call_lead WHERE call_id = $1', [callId]);
    return rows[0] ? rowToLead(rows[0]) : null;
  }

  async listLeads(opts: ListLeadsOpts): Promise<CallLead[]> {
    const params: unknown[] = [opts.locationId];
    let where = 'location_id = $1';
    if (opts.agentId === UNASSIGNED_AGENT) {
      where += ' AND agent_id IS NULL';
    } else if (opts.agentId) {
      params.push(opts.agentId);
      where += ` AND agent_id = $${params.length}`;
    }
    if (opts.bookingStatus) {
      params.push(opts.bookingStatus);
      where += ` AND booking_status = $${params.length}`;
    }
    if (opts.missedOpportunity) where += ' AND missed_opportunity';
    if (opts.humanActionNeeded) where += ' AND human_action_needed';
    params.push(Math.min(opts.limit ?? 200, 500));
    const { rows } = await getPool().query<LeadRow>(
      `SELECT * FROM call_lead WHERE ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length}`,
      params,
    );
    return rows.map(rowToLead);
  }
}

/** Default repository instance (Postgres). */
export const leadRepo: LeadRepository = new PostgresLeadRepository();
