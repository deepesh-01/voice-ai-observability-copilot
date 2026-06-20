/**
 * Migrate an existing DB from the old single-table shape (call_analysis holding the raw
 * payload + call metadata) to the normalized shape: raw_call as the source-of-record,
 * with call_analysis / call_lead FK-ing to it (ADR-0011).
 *
 *   cd server && npx tsx scripts/migrate-split-raw.mts
 *
 * Idempotent and transactional — safe to re-run. No-op on a fresh DB (initSchema already
 * builds the new shape). Requires DATABASE_URL in .env.
 */
import { getPool, initSchema, closePool } from '../src/db/pool.js';

async function columnExists(table: string, column: string): Promise<boolean> {
  const { rows } = await getPool().query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return rows.length > 0;
}

async function main() {
  await initSchema(); // ensures raw_call exists (and the new tables on a fresh DB)

  const legacy = await columnExists('call_analysis', 'raw_call');
  if (!legacy) {
    console.log('Already on the normalized shape (call_analysis has no raw_call column) — nothing to do.');
    return;
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // 1. Backfill raw_call from the legacy columns. contact_id is lifted from the payload.
    const { rowCount } = await client.query(
      `INSERT INTO raw_call (call_id, location_id, agent_id, contact_id, duration_sec, call_at, payload, received_at)
       SELECT call_id, location_id, agent_id, raw_call->>'contactId', duration_sec, call_at, raw_call, scored_at
         FROM call_analysis
       ON CONFLICT (call_id) DO NOTHING`,
    );
    console.log(`Backfilled ${rowCount} row(s) into raw_call.`);

    // 2. Re-point call_lead's FK from call_analysis → raw_call (if call_lead exists).
    if (await columnExists('call_lead', 'call_id')) {
      await client.query('ALTER TABLE call_lead DROP CONSTRAINT IF EXISTS call_lead_call_id_fkey');
      await client.query(
        `ALTER TABLE call_lead ADD CONSTRAINT call_lead_call_id_fkey
           FOREIGN KEY (call_id) REFERENCES raw_call (call_id) ON DELETE CASCADE`,
      );
    }

    // 3. Drop the moved columns from call_analysis and FK it to raw_call.
    await client.query('ALTER TABLE call_analysis DROP COLUMN IF EXISTS raw_call');
    await client.query('ALTER TABLE call_analysis DROP COLUMN IF EXISTS duration_sec');
    await client.query('ALTER TABLE call_analysis DROP COLUMN IF EXISTS call_at');
    await client.query('ALTER TABLE call_analysis DROP CONSTRAINT IF EXISTS call_analysis_call_id_fkey');
    await client.query(
      `ALTER TABLE call_analysis ADD CONSTRAINT call_analysis_call_id_fkey
         FOREIGN KEY (call_id) REFERENCES raw_call (call_id) ON DELETE CASCADE`,
    );
    // The old call_at index is gone with the column; drop it if it lingers.
    await client.query('DROP INDEX IF EXISTS idx_call_analysis_call_at');

    await client.query('COMMIT');
    console.log('Migration complete: raw_call is now the source-of-record; call_analysis/call_lead FK to it.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
