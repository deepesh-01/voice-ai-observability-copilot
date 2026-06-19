<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { agentLabel, deriveAgents, fetchAnalyses, fetchKpiAverages, scoreClass, scoreColor, type AgentSummary } from '../api';
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
const totalCalls = ref(0);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const [calls, kpiAvgs] = await Promise.all([
      fetchAnalyses({ locationId: props.locationId, limit: 500 }),
      fetchKpiAverages({ locationId: props.locationId }),
    ]);
    totalCalls.value = calls.length;
    agents.value = deriveAgents(calls, kpiAvgs);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load agents.';
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const overallAvg = computed(() => {
  if (!agents.value.length) return null;
  const sum = agents.value.reduce((acc, a) => acc + a.avgScore * a.callCount, 0);
  return Math.round(sum / totalCalls.value);
});
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
    </div>

    <!-- Loading -->
    <div v-if="loading" class="state-block">
      <span class="spinner spinner-lg"></span>
      <p>Loading agents…</p>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="state-block">
      <div class="state-block-icon">!</div>
      <h3>Could not load agents</h3>
      <p>{{ error }}</p>
      <button class="btn" @click="load">Retry</button>
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
        class="agent-card"
        @click="emit('selectAgent', agent.agentId)"
      >
        <div class="agent-card-header">
          <div class="agent-id-row">
            <span class="agent-id">{{ agentLabel(agent.agentId) }}</span>
            <span class="agent-calls">{{ agent.callCount }} call{{ agent.callCount === 1 ? '' : 's' }}</span>
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

/* Agent grid */
.agent-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
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
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.agent-card:hover {
  border-color: var(--accent);
  box-shadow: 0 2px 12px rgba(37, 99, 235, 0.08);
}
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

.agent-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
}

.agent-calls {
  font-size: 12px;
  color: var(--muted);
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
