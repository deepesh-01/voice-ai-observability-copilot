/**
 * Migrate call_lead from the approval-workflow shape to the observability-signal shape
 * (ADR-0012): drop the booking_policy table and the approval_* columns; add the two signal
 * columns (missed_opportunity, human_action_needed + reasons).
 *
 *   cd server && npx tsx scripts/migrate-lead-signals.mts
 *
 * Idempotent and transactional. No-op once on the new shape. Requires DATABASE_URL.
 * Existing rows get the signal columns defaulted to false — re-ingest to populate them.
 */
import { getPool, closePool } from '../src/db/pool.js';

async function main() {
  // NOTE: don't call initSchema() here — on the old-shape DB it would try to build the new
  // partial indexes (which reference missed_opportunity) before this migration adds the
  // column. The migration is self-contained: add columns first, then drop, then index.
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // 1. Add the observability signal columns (handles a pre-existing old-shape call_lead).
    await client.query('ALTER TABLE call_lead ADD COLUMN IF NOT EXISTS missed_opportunity BOOLEAN NOT NULL DEFAULT false');
    await client.query('ALTER TABLE call_lead ADD COLUMN IF NOT EXISTS missed_opportunity_reason TEXT');
    await client.query('ALTER TABLE call_lead ADD COLUMN IF NOT EXISTS human_action_needed BOOLEAN NOT NULL DEFAULT false');
    await client.query('ALTER TABLE call_lead ADD COLUMN IF NOT EXISTS human_action_reason TEXT');

    // 2. Drop the approval workflow.
    await client.query('DROP TABLE IF EXISTS booking_policy');
    await client.query('ALTER TABLE call_lead DROP COLUMN IF EXISTS approval_status');
    await client.query('ALTER TABLE call_lead DROP COLUMN IF EXISTS approved_by');
    await client.query('ALTER TABLE call_lead DROP COLUMN IF EXISTS approved_at');
    await client.query('ALTER TABLE call_lead DROP COLUMN IF EXISTS follow_up_required');
    await client.query('DROP INDEX IF EXISTS idx_call_lead_approval');
    await client.query('DROP INDEX IF EXISTS idx_call_lead_booked_at');

    // 3. Build the partial "what needs attention" indexes (columns now exist).
    await client.query('CREATE INDEX IF NOT EXISTS idx_call_lead_missed ON call_lead (location_id) WHERE missed_opportunity');
    await client.query('CREATE INDEX IF NOT EXISTS idx_call_lead_action ON call_lead (location_id) WHERE human_action_needed');

    await client.query('COMMIT');
    console.log('Migration complete: approval workflow dropped; missed_opportunity / human_action_needed signals added.');
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
