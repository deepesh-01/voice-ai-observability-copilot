/**
 * Capture the REAL HighLevel Voice AI call-log shape (assumption A-003).
 *
 * The sandbox starts with zero calls, so until a real call exists the per-call /
 * transcript JSON shape is unknown and the rest of the system runs off guesses.
 * Once you place one call (web-call test, phone test, or a real inbound call —
 * see docs/setup-highlevel.md §E), run this to snapshot the live shape into
 * committed fixtures the scoring engine + web can build against.
 *
 *   cd server && npx tsx scripts/capture-call-shape.mts [installKey] [callType]
 *
 * - installKey: location/company key. Omitted → the single install on file.
 * - callType:   optional filter passed straight to the List API (the accepted
 *               values for test-vs-live are unverified — try without first, then
 *               'test' / 'live' if the call doesn't show up).
 *
 * Writes:
 *   server/fixtures/real-call-list.json     raw List Call Logs response
 *   server/fixtures/real-call-<id>.json     raw Get Call Log response (per call)
 *
 * NOTE: these fixtures are real sandbox test data and MAY contain PII (phone
 * numbers, names spoken in the call). They're sandbox self-test calls, committed
 * deliberately as the canonical shape reference. Scrub before sharing externally.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { listCallLogs, getCallLog } from '../src/ghl/api.js';
import { listInstalls } from '../src/store/tokenStore.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(here, '../fixtures');

/** Pull the call array out of the List response regardless of the wrapper key. */
function extractCalls(data: any): any[] {
  const arr = data?.callLogs ?? data?.callsLogs ?? data?.data ?? data?.calls;
  return Array.isArray(arr) ? arr : [];
}

/** First defined value among likely id field names. */
function callIdOf(call: any): string | undefined {
  return call?.callId ?? call?.id ?? call?._id ?? call?.callLogId;
}

/** Shallow type map so the captured shape is skimmable in the console output. */
function shapeOf(obj: unknown, depth = 0): unknown {
  if (Array.isArray(obj)) return obj.length ? [shapeOf(obj[0], depth + 1)] : [];
  if (obj && typeof obj === 'object') {
    if (depth > 3) return '…';
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, shapeOf(v, depth + 1)]),
    );
  }
  return typeof obj;
}

async function main() {
  const [argKey, callType] = process.argv.slice(2);
  const installKey = argKey ?? (await listInstalls())[0];
  if (!installKey) {
    console.error('No install on file. Authorize the app first (see docs/setup-highlevel.md §D).');
    process.exit(1);
  }
  console.log(`Install: ${installKey}${callType ? `  callType=${callType}` : ''}`);

  const list = await listCallLogs(
    { locationId: installKey, ...(callType ? ({ callType } as any) : {}) },
    installKey,
  );
  await mkdir(FIXTURES_DIR, { recursive: true });
  await writeFile(
    resolve(FIXTURES_DIR, 'real-call-list.json'),
    JSON.stringify(list, null, 2),
  );

  const calls = extractCalls(list);
  const total = (list as any)?.totalRecords ?? (list as any)?.meta?.total ?? calls.length;
  console.log(`List response: ${calls.length} call(s) returned, totalRecords=${total}`);
  console.log('List top-level keys:', Object.keys(list ?? {}));

  if (calls.length === 0) {
    console.log(
      '\nNo calls yet — place one in the sandbox (docs/setup-highlevel.md §E), then re-run.\n' +
        'If you made a TEST/web call and it is not here, retry with a callType arg, e.g.\n' +
        '  npx tsx scripts/capture-call-shape.mts ' + installKey + ' test',
    );
    return;
  }

  for (const call of calls) {
    const id = callIdOf(call);
    if (!id) {
      console.warn('Skipping a call with no recognizable id field. Keys:', Object.keys(call));
      continue;
    }
    const detail = await getCallLog(id, installKey);
    await writeFile(
      resolve(FIXTURES_DIR, `real-call-${id}.json`),
      JSON.stringify(detail, null, 2),
    );
    console.log(`\nCaptured call ${id} → fixtures/real-call-${id}.json`);
    console.log('Shape:', JSON.stringify(shapeOf(detail), null, 2));
  }

  console.log('\nDone. Update assumption A-003 + functional-vs-mocked.md with the captured shape.');
}

main().catch((err) => {
  const status = err?.response?.status;
  const body = err?.response?.data;
  console.error('Capture failed:', status ?? '', body ? JSON.stringify(body) : err?.message ?? err);
  process.exit(1);
});
