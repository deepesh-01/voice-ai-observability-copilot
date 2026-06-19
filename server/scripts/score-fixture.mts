/**
 * End-to-end demo of the observability loop (E2): a real captured call →
 * parse → score against the agent's own goal → print the analysis.
 *
 *   cd server && npx tsx scripts/score-fixture.mts [fixtureFile]
 *
 * Defaults to the 123s booking fixture. Requires ANTHROPIC_API_KEY in .env, plus
 * a live install (it pulls the agent's configured prompt to score against).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import axios from 'axios';
import { GHL } from '../src/config.js';
import { getValidAccessToken } from '../src/ghl/oauth.js';
import { listInstalls } from '../src/store/tokenStore.js';
import { parseTranscript } from '../src/analysis/transcript.js';
import { scoreCall } from '../src/analysis/score.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(here, '../fixtures');

async function agentGoal(agentId: string | undefined, locationId: string): Promise<string> {
  if (!agentId) return 'Unknown agent — score against general call-quality best practices.';
  const token = await getValidAccessToken(locationId);
  const { data } = await axios.get(`${GHL.apiBase}/voice-ai/agents`, {
    headers: { Authorization: `Bearer ${token}`, Version: 'v3' },
    params: { locationId },
  });
  const agent = (data?.agents ?? []).find((a: any) => (a.id ?? a._id) === agentId);
  return agent?.agentPrompt ?? 'Agent prompt unavailable — score against general best practices.';
}

async function main() {
  const arg = process.argv[2];
  // Default to the richest captured call (most transcript content) so the demo
  // exercises a full conversation, not a trivial one.
  const candidates = readdirSync(FIXTURES).filter(
    (f) => f.startsWith('real-call-') && f !== 'real-call-list.json',
  );
  const file =
    arg ??
    candidates
      .map((f) => ({ f, len: (JSON.parse(readFileSync(resolve(FIXTURES, f), 'utf8')).transcript ?? '').length }))
      .sort((a, b) => b.len - a.len)[0]?.f;
  if (!file) {
    console.error('No call fixture found. Run capture-call-shape.mts first.');
    process.exit(1);
  }
  const fixture = JSON.parse(readFileSync(resolve(FIXTURES, file), 'utf8'));
  const turns = parseTranscript(fixture.transcript);
  console.log(`Scoring ${file} — ${turns.length} turns, duration ${fixture.duration}s`);

  const locationId = (await listInstalls())[0]!;
  const goal = await agentGoal(fixture.agentId, locationId);

  const analysis = await scoreCall({
    callId: fixture.id,
    agentId: fixture.agentId,
    agentGoal: goal,
    turns,
  });

  console.log(`\n=== Analysis ===\nOverall: ${analysis.overallScore}/100`);
  console.log('Summary:', analysis.summary);
  console.log('\nKPIs:');
  for (const s of analysis.kpiScores) console.log(`  ${s.key}: ${s.score} — ${s.rationale}`);
  console.log('\nDeviations:');
  for (const d of analysis.deviations) console.log(`  [${d.severity}] (${d.kpi}) ${d.description}`);
  console.log('\nUse Actions (review these spans):');
  for (const u of analysis.useActions) console.log(`  turns ${u.startTurn}-${u.endTurn}: ${u.label} — ${u.reason}`);
}

main().catch((e) => {
  console.error('Scoring failed:', e?.response?.status ?? '', e?.message ?? e);
  process.exit(1);
});
