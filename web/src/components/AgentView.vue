<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  agentLabel,
  fetchAnalyses,
  fetchKpiAverages,
  fetchRecommendations,
  formatDuration,
  formatTime,
  kpiLabel,
  scoreClass,
  scoreColor,
  type AgentRecommendations,
  type CallSummary,
  type KpiAverage,
} from '../api';
import KpiBar from './KpiBar.vue';

const props = defineProps<{
  locationId: string;
  agentId: string;
}>();

const emit = defineEmits<{
  back: [];
  selectCall: [callId: string];
}>();

// ── State ─────────────────────────────────────────────────────────────────────

const loadingMain = ref(true);
const errorMain = ref<string | null>(null);
const calls = ref<CallSummary[]>([]);
const kpiAverages = ref<KpiAverage[]>([]);

const loadingRecs = ref(false);
const errorRecs = ref<string | null>(null);
const recommendations = ref<AgentRecommendations | null>(null);
const recsLoaded = ref(false);

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadMain() {
  loadingMain.value = true;
  errorMain.value = null;
  try {
    const [callData, kpiData] = await Promise.all([
      fetchAnalyses({ locationId: props.locationId, agentId: props.agentId, limit: 100 }),
      fetchKpiAverages({ locationId: props.locationId, agentId: props.agentId }),
    ]);
    calls.value = callData;
    // Sort KPIs weakest-first for the profile
    kpiAverages.value = [...kpiData].sort((a, b) => a.avgScore - b.avgScore);
  } catch (e) {
    errorMain.value = e instanceof Error ? e.message : 'Failed to load agent data.';
  } finally {
    loadingMain.value = false;
  }
}

async function loadRecommendations() {
  if (recsLoaded.value) return;
  loadingRecs.value = true;
  errorRecs.value = null;
  try {
    const data = await fetchRecommendations({
      locationId: props.locationId,
      agentId: props.agentId,
    });
    recommendations.value = data;
    recsLoaded.value = true;
  } catch (e) {
    errorRecs.value = e instanceof Error ? e.message : 'Failed to synthesize recommendations.';
  } finally {
    loadingRecs.value = false;
  }
}

onMounted(() => {
  loadMain();
  // Lazy-load recommendations without blocking the agent view
  loadRecommendations();
});

watch(() => [props.locationId, props.agentId], () => {
  recsLoaded.value = false;
  recommendations.value = null;
  loadMain();
  loadRecommendations();
});

// ── Computed ──────────────────────────────────────────────────────────────────

const avgScore = computed(() => {
  if (!calls.value.length) return null;
  return Math.round(calls.value.reduce((acc, c) => acc + c.overallScore, 0) / calls.value.length);
});

const weakestKpi = computed(() => kpiAverages.value[0] ?? null);

// Kind label helpers
const kindLabels: Record<string, string> = {
  prompt: 'Prompt edit',
  script: 'Script change',
  configuration: 'Configuration',
  process: 'Process',
};
function kindLabel(kind: string): string {
  return kindLabels[kind] ?? kind;
}
</script>

<template>
  <div class="agent-view">
    <!-- Back link -->
    <button class="back-btn" @click="emit('back')">
      ← All agents
    </button>

    <!-- Agent header -->
    <div class="agent-header card" v-if="!loadingMain && !errorMain">
      <div class="agent-header-top">
        <div>
          <p class="agent-header-label">Agent</p>
          <h2 class="agent-header-id">{{ agentLabel(agentId) }}</h2>
        </div>
        <div v-if="avgScore !== null" class="agent-header-score" :class="scoreClass(avgScore)">
          {{ avgScore }}
          <span class="score-sub">/100 avg</span>
        </div>
      </div>
      <p v-if="weakestKpi" class="agent-header-alert">
        Weakest KPI: <strong>{{ kpiLabel(weakestKpi.kpiKey) }}</strong> at {{ weakestKpi.avgScore }}/100 across {{ weakestKpi.calls }} call{{ weakestKpi.calls === 1 ? '' : 's' }}
      </p>
    </div>

    <!-- Loading main -->
    <div v-if="loadingMain" class="state-block card">
      <span class="spinner spinner-lg"></span>
      <p>Loading agent data…</p>
    </div>

    <!-- Error main -->
    <div v-else-if="errorMain" class="state-block card">
      <div class="state-block-icon">!</div>
      <h3>Could not load agent</h3>
      <p>{{ errorMain }}</p>
      <button class="btn" @click="loadMain">Retry</button>
    </div>

    <template v-else>
      <!-- KPI Profile -->
      <div class="card section">
        <h3 class="section-title">KPI Profile</h3>
        <div v-if="kpiAverages.length" class="kpi-profile">
          <KpiBar
            v-for="(kpi, i) in kpiAverages"
            :key="kpi.kpiKey"
            :kpi-key="kpi.kpiKey"
            :score="kpi.avgScore"
            :calls="kpi.calls"
            :flagged="i === 0"
            :show-score="true"
          />
        </div>
        <div v-else class="state-block">
          <p>No KPI data yet. KPI scores appear after at least one call is analyzed.</p>
        </div>
      </div>

      <!-- Recommendations panel (lazy-loaded, Opus synthesis ~10–30s) -->
      <div class="card section">
        <div class="recs-header">
          <h3 class="section-title">Recommendations</h3>
          <span v-if="loadingRecs" class="recs-synthesizing">
            <span class="spinner"></span>
            Synthesizing across {{ calls.length }} call{{ calls.length === 1 ? '' : 's' }}…
          </span>
        </div>

        <div v-if="loadingRecs" class="recs-loading-body">
          <p class="muted" style="font-size: 13px;">
            Claude Opus is analyzing call patterns and building actionable fixes.
            This takes 10–30 seconds.
          </p>
        </div>

        <div v-else-if="errorRecs" class="state-block">
          <div class="state-block-icon">!</div>
          <h3>Could not load recommendations</h3>
          <p>{{ errorRecs }}</p>
          <button class="btn" @click="loadRecommendations">Retry</button>
        </div>

        <template v-else-if="recommendations">
          <p v-if="recommendations.summary" class="recs-summary">{{ recommendations.summary }}</p>

          <div v-if="!recommendations.recommendations.length" class="state-block" style="padding: 24px 0;">
            <div class="state-block-icon">✓</div>
            <h3>No issues found</h3>
            <p>The agent is performing well across analyzed calls.</p>
          </div>

          <div v-else class="rec-list">
            <div
              v-for="(rec, i) in recommendations.recommendations"
              :key="i"
              class="rec-card"
              :class="`rec-card--${rec.priority}`"
            >
              <div class="rec-card-header">
                <div class="rec-meta">
                  <span class="badge" :class="`badge-${rec.priority}`">
                    {{ rec.priority.toUpperCase() }}
                  </span>
                  <span class="chip" :class="`chip-${rec.kind}`">{{ kindLabel(rec.kind) }}</span>
                  <span class="chip">{{ kpiLabel(rec.kpi) }}</span>
                </div>
                <h4 class="rec-title">{{ rec.title }}</h4>
              </div>

              <div class="rec-body">
                <div class="rec-section">
                  <span class="rec-section-label">Problem</span>
                  <p class="rec-problem">{{ rec.problem }}</p>
                </div>

                <div class="rec-section">
                  <span class="rec-section-label">Recommended Fix</span>
                  <pre class="rec-fix">{{ rec.fix }}</pre>
                </div>

                <div class="rec-section">
                  <span class="rec-section-label">Rationale</span>
                  <p class="rec-rationale">{{ rec.rationale }}</p>
                </div>

                <div v-if="rec.evidenceCallIds.length" class="rec-evidence">
                  <span class="rec-section-label">Evidence</span>
                  <div class="evidence-links">
                    <button
                      v-for="callId in rec.evidenceCallIds"
                      :key="callId"
                      class="evidence-call-link"
                      @click="emit('selectCall', callId)"
                    >
                      {{ callId.slice(0, 16) }}…
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>

        <div v-else class="state-block" style="padding: 24px 0;">
          <p>Recommendations will appear here after synthesis completes.</p>
        </div>
      </div>

      <!-- Call list -->
      <div class="card section">
        <h3 class="section-title">Calls ({{ calls.length }})</h3>

        <div v-if="!calls.length" class="state-block" style="padding: 24px 0;">
          <div class="state-block-icon">—</div>
          <h3>No calls ingested yet</h3>
          <p>Calls appear here after the agent takes a call and the webhook ingests it.</p>
        </div>

        <div v-else class="call-table">
          <div class="call-table-head">
            <span>Score</span>
            <span>Time</span>
            <span>Duration</span>
            <span>Summary</span>
          </div>
          <button
            v-for="call in calls"
            :key="call.callId"
            class="call-row"
            @click="emit('selectCall', call.callId)"
          >
            <span class="call-score" :style="{ color: scoreColor(call.overallScore) }">
              {{ call.overallScore }}
            </span>
            <span class="call-time">{{ formatTime(call.callAt) }}</span>
            <span class="call-dur">{{ formatDuration(call.durationSec) }}</span>
            <span class="call-summary">{{ call.summary }}</span>
            <span class="call-chevron">›</span>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.agent-view {}

.back-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-family: inherit;
  font-size: 13.5px;
  color: var(--accent);
  font-weight: 600;
  padding: 4px 0 12px;
  display: block;
}
.back-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }

/* Agent header */
.agent-header {
  margin-bottom: 4px;
}
.agent-header-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.agent-header-label {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0 0 4px;
}
.agent-header-id {
  font-size: 17px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  margin: 0;
  word-break: break-all;
}
.agent-header-score {
  font-size: 36px;
  font-weight: 800;
  line-height: 1;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.agent-header-score.score-ok   { color: var(--ok); }
.agent-header-score.score-warn { color: var(--warn); }
.agent-header-score.score-bad  { color: #dc2626; }
.score-sub { font-size: 14px; font-weight: 400; color: var(--muted); }

.agent-header-alert {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--muted);
  padding: 8px 12px;
  background: #fffbeb;
  border-radius: 8px;
  border-left: 3px solid var(--warn);
}

/* Sections */
.section { }
.section-title { margin: 0 0 14px; font-size: 15px; font-weight: 700; }

.kpi-profile { display: flex; flex-direction: column; gap: 10px; }

/* Recommendations */
.recs-header { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.recs-header .section-title { margin-bottom: 0; }
.recs-synthesizing { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--muted); }
.recs-loading-body { padding: 8px 0 4px; }

.recs-summary {
  font-size: 14px;
  color: var(--muted);
  margin: 0 0 16px;
  padding: 12px;
  background: #f7f8fa;
  border-radius: 8px;
  border: 1px solid var(--border);
  line-height: 1.55;
}

.rec-list { display: flex; flex-direction: column; gap: 14px; }

.rec-card {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}
.rec-card--high   { border-left: 3px solid #dc2626; }
.rec-card--medium { border-left: 3px solid var(--warn); }
.rec-card--low    { border-left: 3px solid var(--ok); }

.rec-card-header {
  padding: 12px 16px 10px;
  border-bottom: 1px solid var(--border);
  background: #fafbfc;
}
.rec-meta { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; flex-wrap: wrap; }
.rec-title { margin: 0; font-size: 14.5px; font-weight: 700; color: var(--text); }

.rec-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }

.rec-section { display: flex; flex-direction: column; gap: 4px; }
.rec-section-label {
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--muted);
}
.rec-problem { margin: 0; font-size: 13.5px; line-height: 1.55; }
.rec-rationale { margin: 0; font-size: 13px; color: var(--muted); line-height: 1.55; }

.rec-fix {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
  background: #f0f4ff;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  padding: 10px 12px;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.55;
  color: #1e3a6e;
}

.rec-evidence { display: flex; flex-direction: column; gap: 6px; }
.evidence-links { display: flex; flex-wrap: wrap; gap: 6px; }

.evidence-call-link {
  background: #eef0f3;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 11.5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  cursor: pointer;
  color: var(--accent);
  font-weight: 600;
  transition: background 0.12s ease;
}
.evidence-call-link:hover { background: #dbeafe; border-color: #93c5fd; }
.evidence-call-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* Call table */
.call-table { display: flex; flex-direction: column; }

.call-table-head {
  display: grid;
  grid-template-columns: 52px 130px 80px 1fr;
  gap: 8px;
  padding: 6px 12px 8px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
}

.call-row {
  display: grid;
  grid-template-columns: 52px 130px 80px 1fr 20px;
  gap: 8px;
  align-items: center;
  padding: 11px 12px;
  border-bottom: 1px solid var(--border);
  background: none;
  border-top: none;
  border-left: none;
  border-right: none;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: background 0.1s ease;
}
.call-row:last-child { border-bottom: none; }
.call-row:hover { background: #f7f8fa; }
.call-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 4px; }

.call-score {
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.call-time { font-size: 12.5px; color: var(--muted); white-space: nowrap; }
.call-dur { font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
.call-summary {
  font-size: 13px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.call-chevron { color: var(--muted); font-size: 16px; text-align: right; }

/* Shared badges / chips (scoped copies to avoid global bleed) */
.badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.04em; white-space: nowrap; }
.badge-high   { background: #fef2f2; color: #dc2626; }
.badge-medium { background: #fffbeb; color: #d97706; }
.badge-low    { background: #f0fdf4; color: #16a34a; }

.chip { display: inline-block; padding: 1px 7px; border-radius: 6px; font-size: 11px;
  font-weight: 500; background: #eef0f3; color: var(--muted); border: 1px solid var(--border); }
.chip-prompt        { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }
.chip-script        { background: #f5f3ff; color: #6d28d9; border-color: #ddd6fe; }
.chip-configuration { background: #fff7ed; color: #c2410c; border-color: #fed7aa; }
.chip-process       { background: #f0fdf4; color: #15803d; border-color: #bbf7d0; }

.btn {
  display: inline-block; background: var(--accent); color: #fff; text-decoration: none;
  padding: 8px 14px; border-radius: 8px; font-size: 14px; border: none; cursor: pointer; font-family: inherit;
}
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid var(--border);
  border-top-color: var(--accent); border-radius: 50%; animation: spin 0.7s linear infinite; vertical-align: middle; }
.spinner-lg { width: 28px; height: 28px; border-width: 3px; }
@keyframes spin { to { transform: rotate(360deg); } }

.state-block { display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 40px 20px; text-align: center; color: var(--muted); font-size: 14px; }
.state-block-icon { font-size: 24px; opacity: 0.5; }
.state-block h3 { margin: 0; font-size: 15px; color: var(--text); }
.state-block p { margin: 0; max-width: 340px; }
.muted { color: var(--muted); }
</style>
