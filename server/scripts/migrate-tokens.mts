/**
 * One-shot migration: copy OAuth install tokens from the legacy tokens.json file into
 * Postgres (`oauth_tokens`). Idempotent — re-running upserts the same rows. Safe to delete
 * tokens.json afterwards (keep a backup until a refresh has succeeded against the DB).
 *
 *   cd server && npx tsx scripts/migrate-tokens.mts
 *
 * Requires DATABASE_URL in .env.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { saveTokens, listInstalls, type InstallTokens } from '../src/store/tokenStore.js';
import { closePool } from '../src/db/pool.js';

const here = dirname(fileURLToPath(import.meta.url));
const LEGACY_PATH = resolve(here, '../tokens.json');

async function main() {
  let legacy: Record<string, InstallTokens>;
  try {
    legacy = JSON.parse(await readFile(LEGACY_PATH, 'utf8'));
  } catch {
    console.log(`No tokens.json at ${LEGACY_PATH} — nothing to migrate.`);
    return;
  }

  const entries = Object.entries(legacy);
  if (entries.length === 0) {
    console.log('tokens.json is empty — nothing to migrate.');
    return;
  }

  for (const [key, tokens] of entries) {
    await saveTokens(tokens);
    console.log(`  migrated install ${key} (expires ${new Date(tokens.expiresAt).toISOString()})`);
  }

  const installs = await listInstalls();
  console.log(`Done — ${entries.length} install(s) migrated. oauth_tokens now holds: ${installs.join(', ')}`);
}

main()
  .catch((err) => {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
