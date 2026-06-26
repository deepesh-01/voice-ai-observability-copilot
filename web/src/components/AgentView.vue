<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  shortId,
  UNASSIGNED_AGENT,
  countSignals,
  fetchAnalyses,
  fetchKpiAverages,
  fetchLeads,
  fetchRecommendations,
  previewRecommendation,
  applyRecommendation,
  formatDuration,
  formatTime,
  kpiLabel,
  scoreClass,
  scoreColor,
  type AgentRecommendations,
  type RecommendationPreview,
  type CallLead,
  type CallSummary,
  type KpiAverage,
} from '../api';
import { ensureAgents, displayName } from '../agents';
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
const leads = ref<CallLead[]>([]);

// Signal filters — toggle to narrow the call list to flagged calls.
const filterMissed = ref(false);
const filterHuman = ref(false);

const loadingRecs = ref(false);
const errorRecs = ref<string | null>(null);
const recommendations = ref<AgentRecommendations | null>(null);
const recsLoaded = ref(false);

// ── Apply-recommendation state ──────────────────────────────────────────────────
// `previewIndex` = the rec whose prompt change is being generated (button spinner).
// `preview` = the modal's content (current vs revised prompt) awaiting confirmation.
// `applying` = the live PATCH is in flight (writes are one-at-a-time, server-serialized).
// `appliedIndexes` = recs already applied THIS synthesis; once any is applied the rest
// are disabled until a refresh, since their previews were built on the now-stale prompt.
const previewIndex = ref<number | null>(null);
const preview = ref<RecommendationPreview | null>(null);
const applying = ref(false);
const applyError = ref<string | null>(null);
const appliedIndexes = ref<Set<number>>(new Set());
const applyNotice = ref<string | null>(null);

// ── Data loading ──────────────────────────────────────────────────────────────

// `silent` (the Refresh path) keeps the current content visible and swaps in fresh
// data — no loader flash, stale data kept on failure. Recommendations are left as-is
// (they have their own Refresh; re-synthesis is expensive).
async function loadMain(silent = false) {
  if (!silent) {
    loadingMain.value = true;
    errorMain.value = null;
  }
  try {
    const [callData, kpiData, leadData] = await Promise.all([
      fetchAnalyses({ locationId: props.locationId, agentId: props.agentId, limit: 100 }),
      fetchKpiAverages({ locationId: props.locationId, agentId: props.agentId }),
      fetchLeads({ locationId: props.locationId, agentId: props.agentId, limit: 200 }).catch(() => []),
      ensureAgents(props.locationId),
    ]);
    calls.value = callData;
    leads.value = leadData;
    // Sort KPIs weakest-first for the profile
    kpiAverages.value = [...kpiData].sort((a, b) => a.avgScore - b.avgScore);
  } catch (e) {
    if (!silent) errorMain.value = e instanceof Error ? e.message : 'Failed to load agent data.';
  } finally {
    if (!silent) loadingMain.value = false;
  }
}

/**
 * `reload` re-fetches (bypasses the once-per-session guard); `force` bypasses the SERVER
 * cache and re-runs Opus. The Refresh button passes only `reload` — the server returns the
 * cached synthesis when the agent's call count is unchanged, so it re-synthesizes (and spends
 * tokens) ONLY when there are genuinely new calls. `force` is reserved (scripts), not the UI.
 */
async function loadRecommendations(opts: { reload?: boolean; force?: boolean } = {}) {
  if (recsLoaded.value && !opts.reload && !opts.force) return;
  loadingRecs.value = true;
  errorRecs.value = null;
  try {
    const data = await fetchRecommendations({
      locationId: props.locationId,
      agentId: props.agentId,
      refresh: opts.force === true,
    });
    recommendations.value = data;
    recsLoaded.value = true;
    // Fresh synthesis reflects the current prompt → previous "applied" flags no longer apply.
    appliedIndexes.value = new Set();
    applyNotice.value = null;
  } catch (e) {
    errorRecs.value = e instanceof Error ? e.message : 'Failed to synthesize recommendations.';
  } finally {
    loadingRecs.value = false;
  }
}

// ── Apply a recommendation to the agent prompt ──────────────────────────────────

/** Step 1: build the revised prompt (Opus) and open the confirm modal. No write. */
async function openPreview(i: number) {
  if (applying.value || previewIndex.value !== null) return;
  applyError.value = null;
  previewIndex.value = i;
  try {
    preview.value = await previewRecommendation({
      locationId: props.locationId,
      agentId: props.agentId,
      index: i,
    });
  } catch (e) {
    applyError.value = e instanceof Error ? e.message : 'Could not build the prompt change.';
  } finally {
    previewIndex.value = null;
  }
}

function closePreview() {
  if (applying.value) return; // don't dismiss mid-write
  preview.value = null;
  applyError.value = null;
}

/** Step 2: write the previewed prompt to the live agent (serialized server-side). */
async function confirmApply() {
  if (!preview.value || applying.value) return;
  const current = preview.value;
  applying.value = true;
  applyError.value = null;
  try {
    const result = await applyRecommendation({
      locationId: props.locationId,
      agentId: props.agentId,
      revisedPrompt: current.revisedPrompt,
      baselinePrompt: current.currentPrompt,
    });
    // The server returns 4xx/5xx (→ throw) on a failed/unverified write; this guards the
    // 2xx-but-not-ok case so we never claim success the read-back didn't confirm.
    if (!result.ok) {
      applyError.value = 'The update could not be verified on the agent. Please try again.';
      return;
    }
    appliedIndexes.value = new Set(appliedIndexes.value).add(current.index);
    applyNotice.value = `Updated the agent prompt — “${current.recommendation.title}”. Refresh recommendations to apply more.`;
    preview.value = null;
  } catch (e) {
    applyError.value = e instanceof Error ? e.message : 'Failed to update the agent.';
  } finally {
    applying.value = false;
  }
}

/** Is the Apply button for rec `i` disabled? (a write/preview is busy, or a sibling was applied) */
function applyDisabled(i: number): boolean {
  return (
    applying.value ||
    previewIndex.value !== null ||
    appliedIndexes.value.has(i) ||
    appliedIndexes.value.size > 0
  );
}

type DiffRow = { type: 'same' | 'add' | 'del'; text: string };

/** A minimal LCS line-diff — renders the current→revised prompt change in the modal. */
function lineDiff(before: string, after: string): DiffRow[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: 'same', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'del', text: a[i] });
      i++;
    } else {
      rows.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) rows.push({ type: 'del', text: a[i++] });
  while (j < m) rows.push({ type: 'add', text: b[j++] });
  return rows;
}

const diffRows = computed<DiffRow[]>(() =>
  preview.value ? lineDiff(preview.value.currentPrompt, preview.value.revisedPrompt) : [],
);

onMounted(() => {
  loadMain();
  // Lazy-load recommendations without blocking the agent view
  loadRecommendations();
});

watch(() => [props.locationId, props.agentId], () => {
  recsLoaded.value = false;
  recommendations.value = null;
  filterMissed.value = false;
  filterHuman.value = false;
  loadMain();
  loadRecommendations();
});

// Header Refresh calls this — silent reload of the main data in place (App shows the
// spinner + toast). Recommendations are NOT re-synthesized here (no surprise Opus spend);
// they have their own cache-aware Refresh button.
defineExpose({ reload: () => loadMain(true) });

// ── Computed ──────────────────────────────────────────────────────────────────

const avgScore = computed(() => {
  if (!calls.value.length) return null;
  return Math.round(calls.value.reduce((acc, c) => acc + c.overallScore, 0) / calls.value.length);
});

const weakestKpi = computed(() => kpiAverages.value[0] ?? null);

// ── Observability signals ─────────────────────────────────────────────────────

const leadByCall = computed((): Map<string, CallLead> => {
  const map = new Map<string, CallLead>();
  for (const l of leads.value) map.set(l.callId, l);
  return map;
});

const signalCounts = computed(() => countSignals(leads.value));

/** Calls narrowed by the active signal filters (both filters = AND). */
const filteredCalls = computed((): CallSummary[] => {
  if (!filterMissed.value && !filterHuman.value) return calls.value;
  return calls.value.filter((c) => {
    const lead = leadByCall.value.get(c.callId);
    if (!lead) return false;
    if (filterMissed.value && !lead.missedOpportunity) return false;
    if (filterHuman.value && !lead.humanActionNeeded) return false;
    return true;
  });
});

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
          <h2 class="agent-header-name">{{ displayName(locationId, agentId) }}</h2>
          <p v-if="agentId !== UNASSIGNED_AGENT" class="agent-header-id">{{ shortId(agentId) }}</p>
        </div>
        <div v-if="avgScore !== null" class="agent-header-score" :class="scoreClass(avgScore)">
          {{ avgScore }}
          <span class="score-sub">/100 avg</span>
        </div>
      </div>
      <p v-if="weakestKpi" class="agent-header-alert">
        Weakest KPI: <strong>{{ kpiLabel(weakestKpi.kpiKey) }}</strong> at {{ weakestKpi.avgScore }}/100 across {{ weakestKpi.calls }} call{{ weakestKpi.calls === 1 ? '' : 's' }}
      </p>
      <div v-if="leads.length" class="agent-signals">
        <span class="signal-stat signal-stat--missed">
          ⚑ {{ signalCounts.missed }} missed opportunit{{ signalCounts.missed === 1 ? 'y' : 'ies' }}
        </span>
        <span class="signal-stat signal-stat--human">
          ⚑ {{ signalCounts.human }} need{{ signalCounts.human === 1 ? 's' : '' }} human action
        </span>
      </div>
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
      <button class="btn" @click="loadMain()">Retry</button>
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
          <button
            v-else-if="recommendations"
            class="recs-refresh"
            title="Re-check — re-synthesizes (and uses Opus) only when there are new calls; cached otherwise"
            @click="loadRecommendations({ reload: true })"
          >↻ Refresh</button>
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
          <button class="btn" @click="loadRecommendations({ reload: true })">Retry</button>
        </div>

        <template v-else-if="recommendations">
          <p v-if="recommendations.summary" class="recs-summary">{{ recommendations.summary }}</p>

          <!-- Post-apply notice: the prompt changed, so the remaining previews are stale. -->
          <div v-if="applyNotice" class="apply-notice" role="status">
            <span class="apply-notice-icon">✓</span>
            <span class="apply-notice-text">{{ applyNotice }}</span>
            <button class="btn-sm" @click="loadRecommendations({ reload: true })">Refresh</button>
          </div>

          <!-- Preview-time error (couldn't build the change). Apply-time errors show in the modal. -->
          <div v-if="applyError && !preview" class="apply-error" role="alert">
            <span>{{ applyError }}</span>
            <button class="apply-error-dismiss" aria-label="Dismiss" @click="applyError = null">×</button>
          </div>

          <div v-if="!recommendations.recommendations.length" class="state-block" style="padding: 24px 0;">
            <div class="state-block-icon">✓</div>
            <h3>No issues found</h3>
            <p>The agent is performing well across analyzed calls.</p>
          </div>

          <div v-else class="rec-list">
            <div
              v-for="(rec, i) in recommendations.recommendations"
              :key="i"
              class="rec-card stagger-item"
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

              <div class="rec-actions">
                <span v-if="appliedIndexes.has(i)" class="rec-applied">✓ Applied to agent</span>
                <button
                  v-else
                  class="btn-apply"
                  :disabled="applyDisabled(i)"
                  :title="appliedIndexes.size > 0
                    ? 'Refresh recommendations before applying another (the prompt has changed)'
                    : 'Preview this change and update the agent prompt'"
                  @click="openPreview(i)"
                >
                  <span v-if="previewIndex === i" class="spinner"></span>
                  {{ previewIndex === i ? 'Preparing…' : 'Apply to agent' }}
                </button>
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
        <div class="calls-header">
          <h3 class="section-title">Calls ({{ filteredCalls.length }}<span v-if="filteredCalls.length !== calls.length"> of {{ calls.length }}</span>)</h3>
          <div v-if="leads.length" class="signal-filters">
            <button
              class="filter-toggle filter-toggle--missed"
              :class="{ 'filter-toggle--on': filterMissed }"
              :aria-pressed="filterMissed"
              @click="filterMissed = !filterMissed"
            >⚑ Missed opp</button>
            <button
              class="filter-toggle filter-toggle--human"
              :class="{ 'filter-toggle--on': filterHuman }"
              :aria-pressed="filterHuman"
              @click="filterHuman = !filterHuman"
            >⚑ Needs human</button>
          </div>
        </div>

        <div v-if="!calls.length" class="state-block" style="padding: 24px 0;">
          <div class="state-block-icon">—</div>
          <h3>No calls ingested yet</h3>
          <p>Calls appear here after the agent takes a call and the webhook ingests it.</p>
        </div>

        <div v-else-if="!filteredCalls.length" class="state-block" style="padding: 24px 0;">
          <div class="state-block-icon">—</div>
          <h3>No calls match the filter</h3>
          <p>No calls flagged for the selected signal{{ filterMissed && filterHuman ? 's' : '' }}. Clear the filter to see all calls.</p>
        </div>

        <div v-else class="call-table">
          <div class="call-table-head">
            <span>Score</span>
            <span>Time</span>
            <span>Duration</span>
            <span>Summary</span>
            <span>Signals</span>
          </div>
          <button
            v-for="call in filteredCalls"
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
            <span class="call-signals">
              <span
                v-if="leadByCall.get(call.callId)?.missedOpportunity"
                class="row-sig row-sig--missed"
                title="Missed opportunity (R2.3)"
              >MO</span>
              <span
                v-if="leadByCall.get(call.callId)?.humanActionNeeded"
                class="row-sig row-sig--human"
                title="Needs human action (R2.6)"
              >HA</span>
            </span>
            <span class="call-chevron">›</span>
          </button>
        </div>
      </div>
    </template>

    <!-- Apply preview / confirm modal -->
    <div v-if="preview" class="modal-overlay" @click.self="closePreview">
      <div class="modal apply-modal" role="dialog" aria-modal="true" aria-labelledby="apply-modal-title">
        <div class="apply-modal-header">
          <div>
            <p class="apply-modal-eyebrow">Apply to agent prompt</p>
            <h3 id="apply-modal-title">{{ preview.recommendation.title }}</h3>
          </div>
          <button class="modal-close" aria-label="Close" :disabled="applying" @click="closePreview">×</button>
        </div>

        <p class="apply-change-summary">
          <span class="apply-change-label">Change</span>
          {{ preview.changeSummary || 'Integrates this recommendation into the agent prompt.' }}
        </p>

        <div class="apply-diff" aria-label="Prompt changes">
          <div
            v-for="(row, di) in diffRows"
            :key="di"
            class="diff-row"
            :class="`diff-row--${row.type}`"
          >
            <span class="diff-gutter">{{ row.type === 'add' ? '+' : row.type === 'del' ? '−' : '' }}</span>
            <span class="diff-text">{{ row.text || ' ' }}</span>
          </div>
        </div>

        <p class="apply-warning">
          This writes the new prompt to the live HighLevel agent. Configured actions are preserved
          and verified after the write.
        </p>

        <div v-if="applyError" class="apply-error" role="alert">{{ applyError }}</div>

        <div class="apply-modal-actions">
          <button class="btn-secondary" :disabled="applying" @click="closePreview">Cancel</button>
          <button class="btn-apply btn-apply--confirm" :disabled="applying" @click="confirmApply">
            <span v-if="applying" class="spinner"></span>
            {{ applying ? 'Updating agent…' : 'Confirm & update agent' }}
          </button>
        </div>
      </div>
    </div>
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
  transition: opacity 120ms var(--ease-out);
}
.back-btn:active { opacity: 0.6; }
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
.agent-header-name {
  font-size: 20px;
  font-weight: 700;
  margin: 0;
}
.agent-header-id {
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--muted);
  margin: 3px 0 0;
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

.agent-signals { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.signal-stat {
  font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px;
}
.signal-stat--missed { background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
.signal-stat--human  { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }

/* Sections */
.section { }
.section-title { margin: 0 0 14px; font-size: 15px; font-weight: 700; }

.kpi-profile { display: flex; flex-direction: column; gap: 10px; }
/* Cascade the bar reveals so the profile reads top-down (:deep reaches into KpiBar). */
.kpi-profile > :nth-child(1) :deep(.kpi-bar-fill) { animation-delay: 40ms; }
.kpi-profile > :nth-child(2) :deep(.kpi-bar-fill) { animation-delay: 90ms; }
.kpi-profile > :nth-child(3) :deep(.kpi-bar-fill) { animation-delay: 140ms; }
.kpi-profile > :nth-child(4) :deep(.kpi-bar-fill) { animation-delay: 190ms; }
.kpi-profile > :nth-child(5) :deep(.kpi-bar-fill) { animation-delay: 240ms; }
.kpi-profile > :nth-child(6) :deep(.kpi-bar-fill) { animation-delay: 290ms; }

/* Recommendations */
.recs-header { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.recs-header .section-title { margin-bottom: 0; }
.recs-synthesizing { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--muted); }
.recs-refresh {
  margin-left: auto;
  background: none;
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 4px 10px;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--accent);
  cursor: pointer;
  transition: background 120ms var(--ease-out), transform 120ms var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .recs-refresh:hover { background: #eff6ff; }
}
.recs-refresh:active { transform: scale(0.97); }
.recs-refresh:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
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
  transition: background 120ms var(--ease-out), border-color 120ms var(--ease-out),
    transform 120ms var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .evidence-call-link:hover { background: #dbeafe; border-color: #93c5fd; }
}
.evidence-call-link:active { transform: scale(0.96); }
.evidence-call-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* Call list header + signal filters */
.calls-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; margin-bottom: 14px; flex-wrap: wrap;
}
.calls-header .section-title { margin-bottom: 0; }
.signal-filters { display: flex; gap: 6px; }
.filter-toggle {
  font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
  padding: 4px 10px; border-radius: 999px; background: #fff;
  border: 1px solid var(--border); color: var(--muted);
  transition: background 120ms var(--ease-out), border-color 120ms var(--ease-out),
    color 120ms var(--ease-out), transform 120ms var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .filter-toggle:hover { border-color: var(--muted); }
}
.filter-toggle:active { transform: scale(0.97); }
.filter-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  .filter-toggle:active { transform: none; }
}
.filter-toggle--missed.filter-toggle--on { background: #fffbeb; color: #b45309; border-color: #fde68a; }
.filter-toggle--human.filter-toggle--on { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }

/* Per-row signal badges */
.call-signals { display: flex; gap: 4px; align-items: center; }
.row-sig {
  font-size: 10px; font-weight: 800; letter-spacing: 0.03em;
  padding: 1px 5px; border-radius: 5px; line-height: 1.5;
}
.row-sig--missed { background: #fef3c7; color: #b45309; }
.row-sig--human  { background: #dbeafe; color: #1d4ed8; }

/* Call table */
.call-table { display: flex; flex-direction: column; }

.call-table-head {
  display: grid;
  grid-template-columns: 52px 130px 80px 1fr 64px;
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
  grid-template-columns: 52px 130px 80px 1fr 64px 20px;
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
  transition: background 100ms var(--ease-out);
}
.call-row:last-child { border-bottom: none; }
@media (hover: hover) and (pointer: fine) {
  .call-row:hover { background: #f7f8fa; }
}
.call-row:active { background: #eef2f9; }
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

/* ── Apply-recommendation: per-card action, notices, confirm modal + diff ─────── */
.rec-actions {
  display: flex; justify-content: flex-end; align-items: center;
  margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--border);
}
.rec-applied { font-size: 13px; font-weight: 600; color: var(--ok); display: inline-flex; align-items: center; gap: 6px; }

.btn-apply {
  display: inline-flex; align-items: center; gap: 7px;
  background: var(--accent); color: #fff; border: none; cursor: pointer; font-family: inherit;
  padding: 7px 14px; border-radius: 8px; font-size: 13px; font-weight: 600;
  transition: background 120ms var(--ease-out), transform 120ms var(--ease-out), opacity 120ms var(--ease-out);
}
@media (hover: hover) and (pointer: fine) { .btn-apply:hover:not(:disabled) { background: #1d4ed8; } }
.btn-apply:active:not(:disabled) { transform: scale(0.97); }
.btn-apply:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.btn-apply:disabled { opacity: 0.45; cursor: not-allowed; }
.btn-apply .spinner { border-color: rgba(255, 255, 255, 0.4); border-top-color: #fff; }
.btn-apply--confirm { padding: 9px 16px; font-size: 14px; }

.btn-secondary {
  background: none; color: var(--muted); border: 1px solid var(--border); cursor: pointer; font-family: inherit;
  padding: 9px 16px; border-radius: 8px; font-size: 14px; font-weight: 600;
  transition: background 120ms var(--ease-out), color 120ms var(--ease-out);
}
@media (hover: hover) and (pointer: fine) { .btn-secondary:hover:not(:disabled) { background: #f1f2f4; color: var(--text); } }
.btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-sm {
  background: var(--ok); color: #fff; border: none; cursor: pointer; font-family: inherit;
  padding: 5px 11px; border-radius: 7px; font-size: 12.5px; font-weight: 600; flex-shrink: 0;
}

.apply-notice {
  display: flex; align-items: center; gap: 10px;
  background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px;
  padding: 10px 12px; margin: 4px 0 14px; font-size: 13px; color: #166534;
}
.apply-notice-icon { font-weight: 700; }
.apply-notice-text { flex: 1; }

.apply-error {
  display: flex; align-items: center; gap: 10px;
  background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px;
  padding: 10px 12px; margin: 4px 0 14px; font-size: 13px; color: #b91c1c;
}
.apply-error-dismiss { margin-left: auto; background: none; border: none; color: #b91c1c; font-size: 16px; cursor: pointer; line-height: 1; }

.modal-overlay {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(17, 22, 35, 0.42);
  display: flex; align-items: center; justify-content: center; padding: 24px;
}
.apply-modal {
  width: 100%; max-width: 720px; max-height: 86vh; display: flex; flex-direction: column;
  background: var(--card); border: 1px solid var(--border); border-radius: 14px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18); overflow: hidden;
}
.apply-modal-header {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding: 16px 18px; border-bottom: 1px solid var(--border);
}
.apply-modal-header h3 { margin: 2px 0 0; font-size: 16px; }
.apply-modal-eyebrow { margin: 0; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--accent); }
.modal-close {
  display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;
  border-radius: 7px; background: none; border: none; color: var(--muted); cursor: pointer; font-size: 16px;
  font-family: inherit; flex-shrink: 0; transition: background 120ms var(--ease-out), color 120ms var(--ease-out);
}
@media (hover: hover) and (pointer: fine) { .modal-close:hover:not(:disabled) { background: #f1f2f4; color: var(--text); } }
.modal-close:disabled { opacity: 0.4; cursor: not-allowed; }

.apply-change-summary { margin: 14px 18px 0; font-size: 13.5px; color: var(--text); }
.apply-change-label { display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin-right: 8px; }

.apply-diff {
  margin: 12px 18px; flex: 1; overflow-y: auto;
  border: 1px solid var(--border); border-radius: 10px; background: #fbfcfd;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5;
}
.diff-row { display: flex; padding: 0 8px; white-space: pre-wrap; word-break: break-word; }
.diff-gutter { flex-shrink: 0; width: 14px; text-align: center; color: var(--muted); user-select: none; }
.diff-text { flex: 1; }
.diff-row--add { background: #f0fdf4; color: #166534; }
.diff-row--add .diff-gutter { color: #16a34a; }
.diff-row--del { background: #fef2f2; color: #b91c1c; }
.diff-row--del .diff-text { text-decoration: line-through; opacity: 0.8; }
.diff-row--del .diff-gutter { color: #dc2626; }

.apply-warning { margin: 0 18px; font-size: 12.5px; color: var(--muted); }
.apply-modal .apply-error { margin: 12px 18px 0; }
.apply-modal-actions {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 16px 18px; margin-top: 12px; border-top: 1px solid var(--border);
}

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
