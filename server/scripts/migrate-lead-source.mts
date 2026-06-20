/**
 * Add the hybrid-provenance columns to call_lead (ADR-0013): `source` ('ghl' | 'llm') and
 * `native` (the raw GHL extractedData blob). Idempotent. Requires DATABASE_URL.
 *
 *   cd server && npx tsx scripts/migrate-lead-source.mts
 *
 * After running, re-derive leads with the hybrid mapping: npx tsx scripts/backfill.mts --releads
 */
import { getPool, closePool } from '../src/db/pool.js';

async function main() {
  await getPool().query(`ALTER TABLE call_lead ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'llm'`);
  await getPool().query(`ALTER TABLE call_lead ADD COLUMN IF NOT EXISTS native JSONB`);
  console.log('Migration complete: call_lead.source + call_lead.native added.');
}

main()
  .catch((err) => {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
