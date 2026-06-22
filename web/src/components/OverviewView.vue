<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { deriveAgents, fetchAnalyses, fetchKpiAverages, fetchLeads, scoreClass, scoreColor, shortId, UNASSIGNED_AGENT, type AgentSummary, type CallLead } from '../api';
import { ensureAgents, displayName } from '../agents';
import KpiBar from './KpiBar.vue';

const props = defineProps<{
  locationId: string;
}>();

const emit = defineEmits<{
  selectAgent: [agentId: string];
}>();

const loading = ref(true);
const error = ref<string | null>(null);
const agents = ref<AgentSummary[]>([]);
const leads = ref<CallLead[]>([]);
const totalCalls = ref(0);

// `silent` (the Refresh path) keeps the current content visible and just swaps in
// fresh data when it arrives — no loader flash, and stale data is kept on failure.
async function load(silent = false) {
  if (!silent) {
    loading.value = true;
    error.value = null;
  }
  try {
    const [calls, kpiAvgs, leadData] = await Promise.all([
      fetchAnalyses({ locationId: props.locationId, limit: 500 }),
      fetchKpiAverages({ locationId: props.locationId }),
      fetchLeads({ locationId: props.locationId, limit: 500 }).catch(() => []),
      ensureAgents(props.locationId),
    ]);
    totalCalls.value = calls.length;
    agents.value = deriveAgents(calls, kpiAvgs);
    leads.value = leadData;
  } catch (e) {
    if (!silent) error.value = e instanceof Error ? e.message : 'Failed to load agents.';
  } finally {
    if (!silent) loading.value = false;
  }
}

onMounted(() => load());
// Header Refresh calls this — silent in-place reload (App shows the spinner + toast).
defineExpose({ reload: () => load(true) });

const overallAvg = computed(() => {
  if (!agents.value.length) return null;
  const sum = agents.value.reduce((acc, a) => acc + a.avgScore * a.callCount, 0);
  return Math.round(sum / totalCalls.value);
});

/** Per-agent signal tallies, keyed by agentId (undefined agent → UNASSIGNED bucket). */
const signalsByAgent = computed((): Map<string, { missed: number; human: number }> => {
  const map = new Map<string, { missed: number; human: number }>();
  for (const l of leads.value) {
    const id = l.agentId ?? UNASSIGNED_AGENT;
    const entry = map.get(id) ?? { missed: 0, human: 0 };
    if (l.missedOpportunity) entry.missed += 1;
    if (l.humanActionNeeded) entry.human += 1;
    map.set(id, entry);
  }
  return map;
});

/** Location-wide signal totals for the summary strip. */
const totalSignals = computed(() => {
  let missed = 0;
  let human = 0;
  for (const s of signalsByAgent.value.values()) {
    missed += s.missed;
    human += s.human;
  }
  return { missed, human };
});

/** Signal counts for one agent, defaulting to zeros (template helper). */
function agentSignals(agentId: string): { missed: number; human: number } {
  return signalsByAgent.value.get(agentId) ?? { missed: 0, human: 0 };
}
</script>

<template>
  <div class="overview">
    <!-- Summary strip -->
    <div v-if="!loading && !error && agents.length" class="summary-strip">
      <div class="summary-item">
        <span class="summary-value">{{ agents.length }}</span>
        <span class="summary-label">Agent{{ agents.length === 1 ? '' : 's' }}</span>
      </div>
      <div class="summary-sep"></div>
      <div class="summary-item">
        <span class="summary-value">{{ totalCalls }}</span>
        <span class="summary-label">Calls analyzed</span>
      </div>
      <div v-if="overallAvg !== null" class="summary-sep"></div>
      <div v-if="overallAvg !== null" class="summary-item">
        <span class="summary-value" :style="{ color: scoreColor(overallAvg) }">{{ overallAvg }}</span>
        <span class="summary-label">Avg overall score</span>
      </div>
      <template v-if="leads.length">
        <div class="summary-sep"></div>
        <div class="summary-item" title="Calls flagged as a missed opportunity (R2.3)">
          <span class="summary-value" style="color: #b45309">{{ totalSignals.missed }}</span>
          <span class="summary-label">Missed</span>
        </div>
        <div class="summary-sep"></div>
        <div class="summary-item" title="Calls needing human action (R2.6)">
          <span class="summary-value" style="color: #1d4ed8">{{ totalSignals.human }}</span>
          <span class="summary-label">Need human</span>
        </div>
      </template>
    </div>

    <!-- Loading — shared full-viewport loader: same size + position as the boot
         spinner and the App "Connecting…" loader, so the handoff has no shift. -->
    <div v-if="loading" class="page-loader">
      <span class="spinner spinner-lg"></span>
      <p>Loading agents…</p>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="state-block">
      <div class="state-block-icon">!</div>
      <h3>Could not load agents</h3>
      <p>{{ error }}</p>
      <button class="btn" @click="load()">Retry</button>
    </div>

    <!-- Empty -->
    <div v-else-if="!agents.length" class="state-block">
      <div class="state-block-icon">—</div>
      <h3>No calls ingested yet</h3>
      <p>Calls appear here after the Voice AI agent takes a call. Once a call completes, the webhook ingests and scores it automatically.</p>
    </div>

    <!-- Agent grid -->
    <div v-else class="agent-grid">
      <button
        v-for="agent in agents"
        :key="agent.agentId"
        class="agent-card stagger-item"
        @click="emit('selectAgent', agent.agentId)"
      >
        <div class="agent-card-header">
          <div class="agent-id-row">
            <span class="agent-name">{{ displayName(locationId, agent.agentId) }}</span>
            <span class="agent-calls">
              <span v-if="agent.agentId !== UNASSIGNED_AGENT" class="agent-id-sub">{{ shortId(agent.agentId) }} · </span>{{ agent.callCount }} call{{ agent.callCount === 1 ? '' : 's' }}
            </span>
          </div>
          <div class="agent-score" :class="scoreClass(agent.avgScore)">
            {{ agent.avgScore }}
            <span class="score-label">/100</span>
          </div>
        </div>

        <!-- KPI mini-strip -->
        <div v-if="agent.kpiAverages.length" class="kpi-strip">
          <KpiBar
            v-for="(kpi, i) in agent.kpiAverages"
            :key="kpi.kpiKey"
            :kpi-key="kpi.kpiKey"
            :score="kpi.avgScore"
            :flagged="i === 0"
            :show-score="true"
          />
        </div>
        <p v-else class="no-kpi-text">KPI data not yet available</p>

        <!-- Per-agent observability signal counts -->
        <div v-if="leads.length" class="agent-signal-row">
          <template v-if="agentSignals(agent.agentId).missed || agentSignals(agent.agentId).human">
            <span v-if="agentSignals(agent.agentId).missed" class="agent-sig agent-sig--missed">
              ⚑ {{ agentSignals(agent.agentId).missed }} missed
            </span>
            <span v-if="agentSignals(agent.agentId).human" class="agent-sig agent-sig--human">
              ⚑ {{ agentSignals(agent.agentId).human }} need human
            </span>
          </template>
          <span v-else class="agent-sig agent-sig--clear">✓ No signals flagged</span>
        </div>

        <div class="agent-card-footer">
          <span class="view-detail">View detail →</span>
        </div>
      </button>
    </div>
  </div>
</template>

<style scoped>
.overview {}

.summary-strip {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 24px;
  margin-bottom: 20px;
}

.summary-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 0 24px;
}

.summary-value {
  font-size: 22px;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.summary-label {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}

.summary-sep {
  width: 1px;
  height: 32px;
  background: var(--border);
}

/* Agent grid — auto-fit + centered so a small number of cards sit centered
 * rather than lonely on the left; cards cap at 420px so they don't stretch wide. */
.agent-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 420px));
  justify-content: center;
  gap: 16px;
}

.agent-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px 20px;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  transition: border-color 150ms var(--ease-out), box-shadow 150ms var(--ease-out),
    transform 140ms var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .agent-card:hover {
    border-color: var(--accent);
    box-shadow: 0 2px 12px rgba(37, 99, 235, 0.08);
  }
}
.agent-card:active { transform: scale(0.99); }
.agent-card:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.agent-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.agent-id-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.agent-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 220px;
}

.agent-calls {
  font-size: 12px;
  color: var(--muted);
}
.agent-id-sub {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}

.agent-score {
  font-size: 28px;
  font-weight: 800;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.agent-score.score-ok   { color: var(--ok); }
.agent-score.score-warn { color: var(--warn); }
.agent-score.score-bad  { color: #dc2626; }

.score-label {
  font-size: 13px;
  font-weight: 400;
  color: var(--muted);
}

.kpi-strip {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.no-kpi-text {
  font-size: 12px;
  color: var(--muted);
  margin: 0;
}

/* Per-agent signal row */
.agent-signal-row { display: flex; flex-wrap: wrap; gap: 6px; }
.agent-sig {
  font-size: 11.5px; font-weight: 600; padding: 2px 8px; border-radius: 999px;
}
.agent-sig--missed { background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
.agent-sig--human  { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
.agent-sig--clear  { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }

.agent-card-footer {
  border-top: 1px solid var(--border);
  padding-top: 10px;
}

.view-detail {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
}
</style>
