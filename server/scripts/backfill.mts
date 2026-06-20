/**
 * Reconcile + backfill the pipeline from the durable raw_call store (ADR-0011).
 * Answers "did any call slip / fail to process?" and repairs gaps without re-calling GHL
 * for already-captured calls:
 *   - raw_call with NO call_analysis  -> re-run the full pipeline (score + lead) from raw.
 *   - call_analysis with NO call_lead -> run lead extraction only (no wasteful re-score).
 * Also flags any GHL call that never reached raw_call (a truly slipped webhook).
 *
 *   cd server && npx tsx scripts/backfill.mts
 *
 * Requires DATABASE_URL + CLAUDE_CODE_OAUTH_TOKEN.
 */
import { getPool, closePool } from '../src/db/pool.js';
import { listInstalls } from '../src/store/tokenStore.js';
import { listCallLogs, callIdOf, getContact } from '../src/ghl/api.js';
import { rawCallRepo } from '../src/store/rawCallRepository.js';
import { leadRepo } from '../src/store/leadRepository.js';
import { ingestRawCall, type RawCallLog } from '../src/ingest/ingestCall.js';
import { parseTranscript } from '../src/analysis/transcript.js';
import { extractLead, assembleLead } from '../src/analysis/extractLead.js';

async function idSet(sql: string): Promise<Set<string>> {
  return new Set((await getPool().query(sql)).rows.map((r) => r.call_id));
}

async function main() {
  const loc = (await listInstalls())[0];

  // GHL authoritative list (paginate until we've seen totalRecords).
  const ghl = new Set<string>();
  let total = 0;
  for (let page = 1; page <= 10; page++) {
    const d = (await listCallLogs({ locationId: loc, page }, loc)) as any;
    const calls = d.callLogs ?? d.calls ?? [];
    total = d.totalRecords ?? d.meta?.total ?? total;
    for (const c of calls) {
      const id = callIdOf(c);
      if (id) ghl.add(id);
    }
    if (calls.length === 0 || (total && ghl.size >= total)) break;
  }

  const raw = await idSet('SELECT call_id FROM raw_call');
  const ana = await idSet('SELECT call_id FROM call_analysis');
  const lead = await idSet('SELECT call_id FROM call_lead');
  const missing = (a: Set<string>, b: Set<string>) => [...a].filter((x) => !b.has(x));

  console.log(`GHL total: ${total || ghl.size} (listed ${ghl.size}) | raw ${raw.size} | analysis ${ana.size} | lead ${lead.size}\n`);

  // `--releads` re-derives leads for EVERY scored call (e.g. after a hybrid-mapping change),
  // not just the ones missing a lead.
  const reAll = process.argv.includes('--releads');
  const slipped = missing(ghl, raw); // in GHL, never captured
  const unscored = missing(raw, ana); // captured, not scored
  const leadless = reAll ? [...ana] : missing(ana, lead); // scored, no lead (or all if --releads)
  console.log(`slipped webhook (in GHL, no raw): ${slipped.length ? slipped.join(', ') : 'none ✓'}`);
  console.log(`captured but unscored:            ${unscored.length ? unscored.join(', ') : 'none ✓'}`);
  console.log(`scored but no lead:               ${leadless.length ? leadless.join(', ') : 'none ✓'}\n`);

  // 1. Slipped calls: pull from GHL + full ingest. (Uses ingestRawCall via a fetch fallback
  //    only if we can't find raw — here we have no raw, so re-fetch through the poll path.)
  for (const id of slipped) {
    try {
      const { ingestCall } = await import('../src/ingest/ingestCall.js');
      const r = await ingestCall(id, loc, { force: true });
      console.log(`  [slipped→ingested] ${id}: ${r.status} ${r.overallScore ?? ''}`);
    } catch (e: any) {
      console.error(`  [slipped FAILED] ${id}: ${e?.message}`);
    }
  }

  // 2. Unscored: re-run full pipeline from the stored raw payload (no GHL re-fetch).
  for (const id of unscored) {
    const stored = await rawCallRepo.getRaw(id);
    if (!stored) continue;
    try {
      const r = await ingestRawCall(stored.payload as RawCallLog, stored.locationId, { force: true });
      console.log(`  [rescored] ${id}: ${r.status} ${r.overallScore ?? ''}`);
    } catch (e: any) {
      console.error(`  [rescore FAILED] ${id}: ${e?.message}`);
    }
  }

  // 3. Leadless: lead extraction only, from the stored raw payload.
  for (const id of leadless) {
    const stored = await rawCallRepo.getRaw(id);
    if (!stored) continue;
    const payload = stored.payload as RawCallLog;
    const turns = parseTranscript(payload.transcript);
    if (turns.length === 0) {
      console.log(`  [lead skipped: empty transcript] ${id}`);
      continue;
    }
    try {
      const extraction = await extractLead({
        callId: id,
        turns,
        ghlSummary: typeof payload.summary === 'string' ? payload.summary : undefined,
      });
      const contact = stored.contactId ? await getContact(stored.contactId, stored.locationId) : undefined;
      const leadRec = assembleLead({
        callId: id,
        locationId: stored.locationId,
        agentId: stored.agentId,
        contactId: stored.contactId,
        extraction,
        contact,
        extractedData: payload.extractedData,
      });
      await leadRepo.saveLead(leadRec);
      console.log(`  [lead ${reAll ? 'rebuilt' : 'backfilled'}] ${id}: src=${leadRec.source} booking=${leadRec.bookingStatus} name=${leadRec.callerName ?? '-'} phone=${leadRec.phone ?? '-'} missed=${leadRec.missedOpportunity} action=${leadRec.humanActionNeeded}`);
    } catch (e: any) {
      console.error(`  [lead FAILED] ${id}: ${e?.message}`);
    }
  }

  if (!slipped.length && !unscored.length && !leadless.length) {
    console.log('Nothing to backfill — every call is fully processed. ✓');
  } else {
    console.log('\nBackfill complete. Re-run to confirm all gaps are closed.');
  }
}

main()
  .catch((e) => {
    console.error('Backfill failed:', e?.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
