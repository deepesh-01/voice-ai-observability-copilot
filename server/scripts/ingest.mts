/**
 * Run the poll-based ingestion pipeline once: list the sandbox's Voice AI calls,
 * score any not yet stored, and persist them to Postgres.
 *
 *   cd server && npx tsx scripts/ingest.mts [locationId]
 *
 * Requires DATABASE_URL (Postgres) and CLAUDE_CODE_OAUTH_TOKEN (scoring) in .env.
 */
import { initSchema, closePool } from '../src/db/pool.js';
import { listInstalls } from '../src/store/tokenStore.js';
import { pollAndIngest } from '../src/ingest/pollIngest.js';

async function main() {
  const locationId = process.argv[2] ?? (await listInstalls())[0];
  if (!locationId) {
    console.error('No install on file. Authorize the app first (docs/setup-highlevel.md §D).');
    process.exit(1);
  }
  await initSchema();
  console.log(`Polling + ingesting calls for location ${locationId} …`);
  const result = await pollAndIngest(locationId);
  console.log(
    `Done — scanned ${result.scanned}, ingested ${result.ingested}, skipped ${result.skipped}.`,
  );
  for (const e of result.errors) console.error(`  error on ${e.callId}: ${e.error}`);
  await closePool();
}

main().catch(async (e) => {
  console.error('Ingestion failed:', e?.message ?? e);
  await closePool();
  process.exit(1);
});
