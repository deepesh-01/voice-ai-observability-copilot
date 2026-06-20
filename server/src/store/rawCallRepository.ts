import { getPool, initSchema } from '../db/pool.js';

/**
 * The source-of-record for an ingested call: the verbatim GHL payload plus the call
 * metadata we lift out for querying. Written the moment a call arrives (webhook/poll),
 * before any scoring — so a call is never lost if analysis later fails.
 */
export interface StoredRawCall {
  callId: string;
  locationId: string;
  agentId?: string;
  contactId?: string;
  durationSec?: number;
  /** When the call happened (ISO 8601), from the GHL call log. */
  callAt?: string;
  /** The raw GHL call-log JSON, kept verbatim. */
  payload: unknown;
}

/** Storage for raw call records. Swappable interface (ADR-0008): Postgres today. */
export interface RawCallRepository {
  init(): Promise<void>;
  hasRaw(callId: string): Promise<boolean>;
  saveRaw(raw: StoredRawCall): Promise<void>;
  getRaw(callId: string): Promise<StoredRawCall | null>;
}

interface RawRow {
  call_id: string;
  location_id: string;
  agent_id: string | null;
  contact_id: string | null;
  duration_sec: number | null;
  call_at: Date | null;
  payload: unknown;
}

function rowToRaw(r: RawRow): StoredRawCall {
  return {
    callId: r.call_id,
    locationId: r.location_id,
    agentId: r.agent_id ?? undefined,
    contactId: r.contact_id ?? undefined,
    durationSec: r.duration_sec ?? undefined,
    callAt: r.call_at ? r.call_at.toISOString() : undefined,
    payload: r.payload,
  };
}

export class PostgresRawCallRepository implements RawCallRepository {
  async init(): Promise<void> {
    await initSchema();
  }

  async hasRaw(callId: string): Promise<boolean> {
    const { rows } = await getPool().query('SELECT 1 FROM raw_call WHERE call_id = $1', [callId]);
    return rows.length > 0;
  }

  async saveRaw(raw: StoredRawCall): Promise<void> {
    await getPool().query(
      `INSERT INTO raw_call (call_id, location_id, agent_id, contact_id, duration_sec, call_at, payload, received_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now())
       ON CONFLICT (call_id) DO UPDATE SET
         location_id=EXCLUDED.location_id, agent_id=EXCLUDED.agent_id,
         contact_id=EXCLUDED.contact_id, duration_sec=EXCLUDED.duration_sec,
         call_at=EXCLUDED.call_at, payload=EXCLUDED.payload`,
      [
        raw.callId,
        raw.locationId,
        raw.agentId ?? null,
        raw.contactId ?? null,
        raw.durationSec ?? null,
        raw.callAt ?? null,
        JSON.stringify(raw.payload),
      ],
    );
  }

  async getRaw(callId: string): Promise<StoredRawCall | null> {
    const { rows } = await getPool().query<RawRow>('SELECT * FROM raw_call WHERE call_id = $1', [callId]);
    return rows[0] ? rowToRaw(rows[0]) : null;
  }
}

/** Default repository instance (Postgres). */
export const rawCallRepo: RawCallRepository = new PostgresRawCallRepository();
