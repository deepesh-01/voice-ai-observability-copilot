/**
 * End-to-end demo of the recommendations engine (R2.5): the agent's stored call
 * history (KPI averages + per-call deviations) → cross-call Opus synthesis →
 * concrete prompt/script fixes. Closes the loop the dashboard surfaces (D2).
 *
 *   cd server && npx tsx scripts/recommend.mts [agentId]
 *
 * With no agentId it picks the agent that has the most scored calls. Requires a
 * live install + Postgres with ingested analyses (run scripts/ingest.mts first).
 */
import { listInstalls, getTokens } from '../src/store/tokenStore.js';
import { analysisRepo } from '../src/store/analysisRepository.js';
import { recommendForAgent } from '../src/analysis/recommend.js';
import { closePool } from '../src/db/pool.js';

async function main() {
  await analysisRepo.init();
  const installKey = (await listInstalls())[0];
  if (!installKey) {
    console.error('No installs found — connect the app first.');
    process.exit(1);
  }
  const install = await getTokens(installKey);
  const locationId = install?.locationId ?? installKey;

  let agentId = process.argv[2];
  if (!agentId) {
    // Pick the agent with the most scored calls.
    const calls = await analysisRepo.list({ locationId, limit: 500 });
    const counts = new Map<string, number>();
    for (const c of calls) if (c.agentId) counts.set(c.agentId, (counts.get(c.agentId) ?? 0) + 1);
    agentId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!agentId) {
      console.error(`No scored calls with an agentId in location ${locationId}. Ingest some first.`);
      process.exit(1);
    }
  }

  console.log(`Synthesizing recommendations for agent ${agentId} (location ${locationId})…\n`);
  const report = await recommendForAgent({ locationId, agentId });

  console.log(`=== Recommendations for agent ${report.agentId} ===`);
  console.log(`Calls analyzed: ${report.callsAnalyzed}`);
  console.log('KPI averages (weakest first):');
  for (const k of report.kpiAverages) console.log(`  ${k.key}: ${k.avgScore}/100 (${k.calls} calls)`);
  console.log(`\nSummary: ${report.summary}\n`);
  report.recommendations.forEach((r, i) => {
    console.log(`#${i + 1} [${r.priority}] ${r.title}  (${r.kind} · ${r.kpi})`);
    console.log(`   Problem: ${r.problem}`);
    console.log(`   Fix: ${r.fix}`);
    console.log(`   Why: ${r.rationale}`);
    console.log(`   Evidence: ${r.evidenceCallIds.join(', ') || '—'}\n`);
  });
}

main()
  .catch((e) => {
    console.error('Recommendation failed:', e?.response?.status ?? '', e?.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
