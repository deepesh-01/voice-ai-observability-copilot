<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import {
  bookingStatusClass,
  bookingStatusLabel,
  fetchCall,
  fetchLead,
  formatDuration,
  formatTime,
  kpiLabel,
  parseTranscript,
  scoreClass,
  scoreColor,
  sourceLabel,
  type CallLead,
  type Deviation,
  type StoredCall,
  type Turn,
  type UseAction,
} from '../api';
import { ensureAgents, displayName } from '../agents';

const props = defineProps<{
  callId: string;
  /** Back context label for the back button */
  backLabel?: string;
}>();

const emit = defineEmits<{
  back: [];
}>();

// ── State ─────────────────────────────────────────────────────────────────────

const loading = ref(true);
const error = ref<string | null>(null);
const storedCall = ref<StoredCall | null>(null);
const lead = ref<CallLead | null>(null);
const showNative = ref(false);
const highlightedTurn = ref<number | null>(null);

// ── Load ──────────────────────────────────────────────────────────────────────

// `silent` (the Refresh path) keeps the current call visible and swaps in fresh
// data when it arrives — no loader flash, stale data kept on failure.
async function load(silent = false) {
  if (!silent) {
    loading.value = true;
    error.value = null;
  }
  try {
    // The lead is supplementary — a missing/failed lead must not blank the call view.
    const [call, leadResult] = await Promise.all([
      fetchCall(props.callId),
      fetchLead(props.callId).catch(() => null),
    ]);
    storedCall.value = call;
    lead.value = leadResult;
    if (call?.locationId) await ensureAgents(call.locationId);
  } catch (e) {
    if (!silent) error.value = e instanceof Error ? e.message : 'Failed to load call.';
  } finally {
    if (!silent) loading.value = false;
  }
}

onMounted(() => load());
// Header Refresh calls this — silent in-place reload (App shows the spinner + toast).
defineExpose({ reload: () => load(true) });

// ── Derived ───────────────────────────────────────────────────────────────────

const analysis = computed(() => storedCall.value?.analysis ?? null);

// ── Lead facts + signals ──────────────────────────────────────────────────────

/** Identity/booking facts to render as a labelled list (skips empties). */
const leadFacts = computed((): { label: string; value: string }[] => {
  const l = lead.value;
  if (!l) return [];
  const rows: { label: string; value: string }[] = [];
  if (l.callerName) rows.push({ label: 'Name', value: l.callerName });
  if (l.phone) rows.push({ label: 'Phone', value: l.phone });
  if (l.email) rows.push({ label: 'Email', value: l.email });
  if (l.problem) rows.push({ label: 'Reason', value: l.problem });
  if (l.treatment) rows.push({ label: 'Treatment', value: l.treatment });
  if (l.bookedAt) rows.push({ label: 'Booked for', value: formatTime(l.bookedAt) });
  return rows;
});

/** Raw native extractedData as key/value pairs for the provenance drawer. */
const nativeEntries = computed((): { key: string; value: string }[] => {
  const native = lead.value?.native;
  if (!native) return [];
  return Object.entries(native)
    .filter(([, v]) => v != null && v !== '')
    .map(([key, v]) => ({ key, value: String(v) }));
});

const turns = computed((): Turn[] => {
  const raw = storedCall.value?.rawCall;
  if (!raw || typeof raw !== 'object') return [];
  const rc = raw as Record<string, unknown>;
  return parseTranscript(rc.transcript as string | undefined);
});

/** Map from turn index → UseAction (first that covers it) */
const useActionByTurn = computed((): Map<number, UseAction> => {
  const map = new Map<number, UseAction>();
  for (const ua of analysis.value?.useActions ?? []) {
    for (let i = ua.startTurn; i <= ua.endTurn; i++) {
      if (!map.has(i)) map.set(i, ua);
    }
  }
  return map;
});

/** Which turn indices are UseAction start turns */
const useActionStarts = computed((): Set<number> => {
  const s = new Set<number>();
  for (const ua of analysis.value?.useActions ?? []) {
    s.add(ua.startTurn);
  }
  return s;
});

/** Map from turn index → all deviations pointing to it */
const deviationsByTurn = computed((): Map<number, Deviation[]> => {
  const map = new Map<number, Deviation[]>();
  for (const dev of analysis.value?.deviations ?? []) {
    if (dev.turnIndex != null) {
      const arr = map.get(dev.turnIndex) ?? [];
      arr.push(dev);
      map.set(dev.turnIndex, arr);
    }
  }
  return map;
});

/** For each KPI, track which turn indices count as evidence */
const evidenceByTurn = computed((): Map<number, string[]> => {
  const map = new Map<number, string[]>();
  for (const kpi of analysis.value?.kpiScores ?? []) {
    for (const idx of kpi.evidence) {
      const arr = map.get(idx) ?? [];
      arr.push(kpi.key);
      map.set(idx, arr);
    }
  }
  return map;
});

// ── Turn scroll / highlight ───────────────────────────────────────────────────

function scrollToTurn(index: number) {
  highlightedTurn.value = index;
  nextTick(() => {
    const el = document.getElementById(`turn-${index}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Clear highlight after animation
      setTimeout(() => {
        if (highlightedTurn.value === index) highlightedTurn.value = null;
      }, 2400);
    }
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };

const sortedDeviations = computed(() =>
  [...(analysis.value?.deviations ?? [])].sort(
    (a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3)
  )
);

function kpiScoreColor(score: number): string {
  return scoreColor(score);
}

function devKpiLabel(dev: Deviation): string {
  return dev.kpi === 'general' ? 'General' : kpiLabel(dev.kpi);
}
</script>

<template>
  <div class="call-view">
    <!-- Back -->
    <button class="back-btn" @click="emit('back')">
      ← {{ backLabel ?? 'Back' }}
    </button>

    <!-- Loading -->
    <div v-if="loading" class="state-block card">
      <span class="spinner spinner-lg"></span>
      <p>Loading call…</p>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="state-block card">
      <div class="state-block-icon">!</div>
      <h3>Could not load call</h3>
      <p>{{ error }}</p>
      <button class="btn" @click="load()">Retry</button>
    </div>

    <template v-else-if="storedCall && analysis">
      <!-- Call header -->
      <div class="call-header card">
        <div class="call-header-top">
          <div class="call-header-meta">
            <p class="call-header-label">Call</p>
            <p class="call-id">{{ callId }}</p>
            <div class="call-header-details">
              <span v-if="storedCall.callAt">{{ formatTime(storedCall.callAt) }}</span>
              <span v-if="storedCall.durationSec">· {{ formatDuration(storedCall.durationSec) }}</span>
              <span v-if="analysis.agentId">· Agent: {{ displayName(storedCall.locationId, analysis.agentId) }}</span>
            </div>
          </div>
          <div class="call-overall-score" :class="scoreClass(analysis.overallScore)">
            {{ analysis.overallScore }}
            <span class="score-sub">/100</span>
          </div>
        </div>
        <p class="call-summary">{{ analysis.summary }}</p>
      </div>

      <!-- Main content: two-column on wider screens -->
      <div class="call-body">
        <!-- Left column: lead/outcome + KPI scores + deviations -->
        <div class="call-left">
          <!-- Lead & Outcome: business result + the two observability signals -->
          <div v-if="lead" class="card section lead-card">
            <h3 class="section-title">
              Lead &amp; Outcome
              <span
                class="source-badge"
                :class="`source-badge--${lead.source}`"
                :title="lead.source === 'ghl'
                  ? 'Facts taken from the agent’s native extractedData (ground-truth).'
                  : 'Facts inferred by the LLM from the transcript.'"
              >{{ sourceLabel(lead.source) }}</span>
            </h3>

            <!-- Booking status -->
            <div class="lead-status-row">
              <span class="booking-pill" :class="`booking-pill--${bookingStatusClass(lead.bookingStatus)}`">
                {{ bookingStatusLabel(lead.bookingStatus) }}
              </span>
              <span v-if="lead.confirmed" class="confirmed-chip" title="The agent confirmed the booking back to the caller.">✓ Confirmed</span>
            </div>

            <!-- Identity / treatment facts -->
            <dl v-if="leadFacts.length" class="lead-facts">
              <template v-for="fact in leadFacts" :key="fact.label">
                <dt>{{ fact.label }}</dt>
                <dd>{{ fact.value }}</dd>
              </template>
            </dl>
            <p v-else class="no-data" style="padding: 4px 0;">No identity or treatment facts captured.</p>

            <!-- Observability signals (only when flagged) -->
            <div v-if="lead.missedOpportunity || lead.humanActionNeeded" class="signal-list">
              <div v-if="lead.missedOpportunity" class="signal-item signal-item--missed">
                <span class="signal-icon">⚑</span>
                <div>
                  <span class="signal-label">Missed opportunity</span>
                  <span class="signal-tag">R2.3</span>
                  <p v-if="lead.missedOpportunityReason" class="signal-reason">{{ lead.missedOpportunityReason }}</p>
                </div>
              </div>
              <div v-if="lead.humanActionNeeded" class="signal-item signal-item--human">
                <span class="signal-icon">⚑</span>
                <div>
                  <span class="signal-label">Needs human action</span>
                  <span class="signal-tag">R2.6</span>
                  <p v-if="lead.humanActionReason" class="signal-reason">{{ lead.humanActionReason }}</p>
                </div>
              </div>
            </div>
            <div v-else class="signal-clear">
              <span class="signal-clear-icon">✓</span> No missed opportunity or human action needed.
            </div>

            <!-- Native extractedData drawer (GHL-confirmed provenance) -->
            <div v-if="nativeEntries.length" class="native-drawer">
              <button class="native-toggle" :aria-expanded="showNative" @click="showNative = !showNative">
                <span class="native-caret" :class="{ 'native-caret--open': showNative }">▸</span>
                Native extractedData ({{ nativeEntries.length }})
              </button>
              <dl v-if="showNative" class="native-grid">
                <template v-for="entry in nativeEntries" :key="entry.key">
                  <dt>{{ entry.key }}</dt>
                  <dd>{{ entry.value }}</dd>
                </template>
              </dl>
            </div>
          </div>

          <!-- KPI scorecards -->
          <div class="card section">
            <h3 class="section-title">KPI Scores</h3>
            <div v-if="analysis.kpiScores.length" class="kpi-score-list">
              <div
                v-for="kpi in analysis.kpiScores"
                :key="kpi.key"
                class="kpi-scorecard"
              >
                <div class="kpi-scorecard-header">
                  <span class="kpi-scorecard-label">{{ kpiLabel(kpi.key) }}</span>
                  <span class="kpi-scorecard-score" :style="{ color: kpiScoreColor(kpi.score) }">{{ kpi.score }}</span>
                </div>
                <div class="kpi-bar-track">
                  <div
                    class="kpi-bar-fill"
                    :style="{ '--fill-scale': kpi.score / 100, background: kpiScoreColor(kpi.score) }"
                  ></div>
                </div>
                <p class="kpi-rationale">{{ kpi.rationale }}</p>
                <!-- Evidence chips: click → scroll to that turn in transcript -->
                <div v-if="kpi.evidence.length" class="evidence-chips">
                  <span class="evidence-label">Evidence turns:</span>
                  <button
                    v-for="idx in kpi.evidence"
                    :key="idx"
                    class="evidence-chip"
                    :title="`Go to turn ${idx} in transcript`"
                    @click="scrollToTurn(idx)"
                  >
                    T{{ idx }}
                  </button>
                </div>
              </div>
            </div>
            <div v-else class="no-data">No KPI scores available.</div>
          </div>

          <!-- Deviations -->
          <div class="card section">
            <h3 class="section-title">
              Deviations
              <span v-if="sortedDeviations.length" class="deviation-count">{{ sortedDeviations.length }}</span>
            </h3>
            <div v-if="!sortedDeviations.length" class="state-block" style="padding: 20px 0;">
              <div class="state-block-icon">✓</div>
              <h3>No deviations found</h3>
              <p>The agent met expectations on this call.</p>
            </div>
            <div v-else class="deviation-list">
              <div
                v-for="(dev, i) in sortedDeviations"
                :key="i"
                class="deviation-item"
                :class="`deviation-item--${dev.severity}`"
              >
                <div class="deviation-header">
                  <span class="badge" :class="`badge-${dev.severity}`">{{ dev.severity.toUpperCase() }}</span>
                  <span class="chip">{{ devKpiLabel(dev) }}</span>
                  <button
                    v-if="dev.turnIndex != null"
                    class="turn-link"
                    :title="`Jump to turn ${dev.turnIndex}`"
                    @click="scrollToTurn(dev.turnIndex!)"
                  >
                    Turn {{ dev.turnIndex }} ↗
                  </button>
                </div>
                <p class="deviation-desc">{{ dev.description }}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Right column: transcript with use-action overlays -->
        <div class="call-right">
          <div class="card section transcript-card">
            <h3 class="section-title">
              Transcript
              <span class="turn-count">{{ turns.length }} turns</span>
            </h3>

            <!-- Use actions legend -->
            <div v-if="analysis.useActions.length" class="ua-legend">
              <span class="ua-dot"></span>
              <span class="ua-legend-text">Use Action segments require human attention (R2.6)</span>
            </div>

            <div v-if="!turns.length" class="no-data">
              Transcript not available for this call.
            </div>
            <div v-else class="transcript">
              <template v-for="turn in turns" :key="turn.index">
                <!-- Use action header banner when this turn starts a span -->
                <div
                  v-if="useActionStarts.has(turn.index)"
                  class="ua-banner"
                >
                  <div class="ua-banner-inner">
                    <span class="ua-banner-icon">⚑</span>
                    <div>
                      <span class="ua-banner-label">{{ useActionByTurn.get(turn.index)?.label }}</span>
                      <span class="ua-banner-reason">{{ useActionByTurn.get(turn.index)?.reason }}</span>
                    </div>
                  </div>
                </div>

                <!-- Turn bubble -->
                <div
                  :id="`turn-${turn.index}`"
                  class="turn"
                  :class="[
                    `turn--${turn.speaker}`,
                    { 'turn--use-action': useActionByTurn.has(turn.index) },
                    { 'turn--highlighted': highlightedTurn === turn.index },
                    { 'turn--deviated': deviationsByTurn.has(turn.index) },
                  ]"
                >
                  <div class="turn-meta">
                    <span class="turn-speaker">{{ turn.speaker === 'agent' ? 'Agent' : 'Caller' }}</span>
                    <span class="turn-index">T{{ turn.index }}</span>
                    <!-- Deviation badges inline in transcript -->
                    <span
                      v-for="(dev, di) in deviationsByTurn.get(turn.index)"
                      :key="`${turn.index}-${di}`"
                      class="badge"
                      :class="`badge-${dev.severity}`"
                      style="font-size: 10px; padding: 1px 5px;"
                      :title="dev.description"
                    >{{ dev.severity[0].toUpperCase() }}</span>
                    <!-- Evidence KPI chips -->
                    <span
                      v-for="kpiKey in evidenceByTurn.get(turn.index)"
                      :key="kpiKey"
                      class="chip"
                      style="font-size: 10px; padding: 0 5px;"
                    >{{ kpiLabel(kpiKey) }}</span>
                  </div>
                  <p class="turn-text">{{ turn.text }}</p>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.call-view {}

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

/* Call header */
.call-header-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.call-header-label {
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  margin: 0 0 3px;
}
.call-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  font-weight: 600;
  margin: 0 0 4px;
  word-break: break-all;
}
.call-header-details {
  font-size: 12.5px;
  color: var(--muted);
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.call-overall-score {
  font-size: 40px;
  font-weight: 800;
  line-height: 1;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.call-overall-score.score-ok   { color: var(--ok); }
.call-overall-score.score-warn { color: var(--warn); }
.call-overall-score.score-bad  { color: #dc2626; }
.score-sub { font-size: 14px; font-weight: 400; color: var(--muted); }

.call-summary {
  font-size: 14px;
  color: var(--muted);
  margin: 0;
  line-height: 1.55;
}

/* Two-column body */
.call-body {
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 0 16px;
  align-items: start;
}

@media (max-width: 860px) {
  .call-body { grid-template-columns: 1fr; }
}

/* Left column */
.call-left { display: flex; flex-direction: column; }
.call-right { }

.section { }
.section-title {
  margin: 0 0 14px;
  font-size: 15px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Lead & Outcome card */
.lead-card .section-title { justify-content: space-between; }

.source-badge {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.03em;
  padding: 2px 8px;
  border-radius: 999px;
  white-space: nowrap;
}
.source-badge--ghl { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
.source-badge--llm { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }

.lead-status-row { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.booking-pill {
  display: inline-flex; align-items: center;
  font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 7px;
}
.booking-pill--booked   { background: #ecfdf5; color: #047857; }
.booking-pill--negative { background: #fef2f2; color: #b91c1c; }
.booking-pill--neutral  { background: #eef0f3; color: var(--muted); }
.confirmed-chip { font-size: 11.5px; font-weight: 600; color: #047857; }

.lead-facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 5px 12px;
  margin: 0 0 14px;
}
.lead-facts dt {
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--muted); padding-top: 1px;
}
.lead-facts dd { margin: 0; font-size: 13px; color: var(--text); word-break: break-word; }

.signal-list { display: flex; flex-direction: column; gap: 8px; }
.signal-item {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 9px 11px; border-radius: 8px; border-left-width: 3px; border-left-style: solid;
  /* These are the call's key call-outs — a soft entrance draws the eye without shouting. */
  animation: signal-in 260ms var(--ease-out) both;
}
.signal-item--human { animation-delay: 50ms; }
@keyframes signal-in {
  from { opacity: 0; transform: translateY(4px); }
}
@media (prefers-reduced-motion: reduce) {
  .signal-item { animation: none; }
}
.signal-item--missed { background: #fffbeb; border-left-color: #f59e0b; }
.signal-item--human  { background: #eff6ff; border-left-color: var(--accent); }
.signal-icon { font-size: 13px; line-height: 1.4; flex-shrink: 0; }
.signal-item--missed .signal-icon { color: #d97706; }
.signal-item--human .signal-icon { color: var(--accent); }
.signal-label { font-size: 12.5px; font-weight: 700; color: var(--text); }
.signal-tag {
  font-size: 9.5px; font-weight: 700; letter-spacing: 0.04em; color: var(--muted);
  background: rgba(0,0,0,0.05); border-radius: 4px; padding: 1px 5px; margin-left: 6px;
  vertical-align: middle;
}
.signal-reason { margin: 3px 0 0; font-size: 12px; line-height: 1.5; color: var(--text); }

.signal-clear {
  font-size: 12.5px; color: #047857;
  display: flex; align-items: center; gap: 6px;
  padding: 8px 11px; background: #f0fdf4; border-radius: 8px;
}
.signal-clear-icon { font-weight: 800; }

/* Native extractedData drawer */
.native-drawer { margin-top: 14px; border-top: 1px solid var(--border); padding-top: 12px; }
.native-toggle {
  background: none; border: none; cursor: pointer; font-family: inherit;
  font-size: 12px; font-weight: 600; color: var(--muted);
  display: inline-flex; align-items: center; gap: 6px; padding: 0;
  transition: color 120ms var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .native-toggle:hover { color: var(--text); }
}
.native-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
.native-caret { display: inline-block; transition: transform 140ms var(--ease-out); font-size: 10px; }
.native-caret--open { transform: rotate(90deg); }
.native-grid {
  display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 10px 0 0;
  background: #f7f8fa; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px;
  /* Reveal the raw fields as the drawer opens — content shouldn't pop in from nothing. */
  animation: native-reveal 200ms var(--ease-out) both;
}
@keyframes native-reveal {
  from { opacity: 0; transform: translateY(-4px); }
}
@media (prefers-reduced-motion: reduce) {
  .native-caret { transition: none; }
  .native-grid { animation: none; }
}
.native-grid dt {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; color: var(--muted); word-break: break-word;
}
.native-grid dd { margin: 0; font-size: 12px; color: var(--text); word-break: break-word; }

/* KPI scorecards */
.kpi-score-list { display: flex; flex-direction: column; gap: 14px; }
/* Cascade the bar reveals top-down (mirrors AgentView's KPI profile) so the
 * scorecards read as a sequence, not a simultaneous flash. */
.kpi-score-list > .kpi-scorecard:nth-child(1) .kpi-bar-fill { animation-delay: 40ms; }
.kpi-score-list > .kpi-scorecard:nth-child(2) .kpi-bar-fill { animation-delay: 90ms; }
.kpi-score-list > .kpi-scorecard:nth-child(3) .kpi-bar-fill { animation-delay: 140ms; }
.kpi-score-list > .kpi-scorecard:nth-child(4) .kpi-bar-fill { animation-delay: 190ms; }
.kpi-score-list > .kpi-scorecard:nth-child(5) .kpi-bar-fill { animation-delay: 240ms; }
.kpi-score-list > .kpi-scorecard:nth-child(6) .kpi-bar-fill { animation-delay: 290ms; }

.kpi-scorecard { display: flex; flex-direction: column; gap: 5px; }

.kpi-scorecard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.kpi-scorecard-label { font-size: 13px; font-weight: 600; color: var(--text); }
.kpi-scorecard-score { font-size: 15px; font-weight: 800; font-variant-numeric: tabular-nums; }

.kpi-bar-track { height: 6px; border-radius: 999px; background: #eef0f3; overflow: hidden; }
.kpi-bar-fill {
  height: 100%; width: 100%;
  transform-origin: left center;
  transform: scaleX(var(--fill-scale, 0));
  animation: kpi-grow 560ms var(--ease-out) both;
}
@keyframes kpi-grow { from { transform: scaleX(0); } }
@media (prefers-reduced-motion: reduce) { .kpi-bar-fill { animation: none; } }

.kpi-rationale { font-size: 12px; color: var(--muted); margin: 2px 0 0; line-height: 1.5; }

.evidence-chips { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
.evidence-label { font-size: 10.5px; color: var(--muted); font-weight: 600; }
.evidence-chip {
  padding: 2px 7px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  color: #1d4ed8;
  cursor: pointer;
  font-family: inherit;
  transition: background 100ms var(--ease-out), transform 120ms var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .evidence-chip:hover { background: #dbeafe; }
}
.evidence-chip:active { transform: scale(0.94); }
.evidence-chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* Deviations */
.deviation-count {
  font-size: 12px;
  font-weight: 700;
  padding: 1px 7px;
  background: #fef2f2;
  color: #dc2626;
  border-radius: 999px;
}

.deviation-list { display: flex; flex-direction: column; gap: 10px; }

.deviation-item {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  border-left-width: 3px;
}
.deviation-item--high   { border-left-color: #dc2626; }
.deviation-item--medium { border-left-color: var(--warn); }
.deviation-item--low    { border-left-color: var(--ok); }

.deviation-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; flex-wrap: wrap; }
.deviation-desc { font-size: 13px; margin: 0; line-height: 1.5; color: var(--text); }

.turn-link {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--accent);
  padding: 0;
  font-family: inherit;
  margin-left: auto;
  transition: opacity 120ms var(--ease-out);
}
.turn-link:active { opacity: 0.6; }
.turn-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* Transcript */
.transcript-card { }

.turn-count {
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.ua-legend {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 14px;
  padding: 7px 10px;
  background: #fef9ec;
  border: 1px solid #fde68a;
  border-radius: 8px;
}
.ua-dot {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: #fbbf24;
  flex-shrink: 0;
}
.ua-legend-text { font-size: 12px; color: #92400e; }

.transcript { display: flex; flex-direction: column; gap: 0; }

/* Use action banner */
.ua-banner {
  margin: 8px 0 0;
  border-radius: 8px 8px 0 0;
  background: #fef9ec;
  border: 1px solid #fde68a;
  border-bottom: none;
  overflow: hidden;
}
.ua-banner-inner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px 6px;
}
.ua-banner-icon { font-size: 13px; color: #d97706; flex-shrink: 0; line-height: 1.4; }
.ua-banner-label { font-size: 12.5px; font-weight: 700; color: #92400e; display: block; }
.ua-banner-reason { font-size: 11.5px; color: #a16207; display: block; margin-top: 1px; }

/* Turn bubbles */
.turn {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  transition: background 0.25s ease;
}
.turn:last-child { border-bottom: none; }

.turn--agent { background: #f7f8fa; }
.turn--caller { background: #fff; }

.turn--use-action {
  background: #fffbeb;
  border-left: 3px solid #fbbf24;
}

.turn--highlighted {
  background: #eff6ff !important;
  border-left: 3px solid var(--accent) !important;
  transition: background 0.1s ease;
}

.turn--deviated { border-left: 3px solid #fca5a5; }
.turn--deviated.turn--use-action { border-left: 3px solid #fbbf24; }

.turn-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 4px;
  flex-wrap: wrap;
}

.turn-speaker {
  font-size: 10.5px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--muted);
}
.turn--agent .turn-speaker { color: var(--accent); }
.turn--caller .turn-speaker { color: #7c3aed; }

.turn-index {
  font-size: 10px;
  color: #c7ccd4;
  font-variant-numeric: tabular-nums;
}

.turn-text {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--text);
}

/* Misc shared */
.no-data { font-size: 13px; color: var(--muted); padding: 10px 0; }

.badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.04em; white-space: nowrap; }
.badge-high   { background: #fef2f2; color: #dc2626; }
.badge-medium { background: #fffbeb; color: #d97706; }
.badge-low    { background: #f0fdf4; color: #16a34a; }

.chip { display: inline-block; padding: 1px 7px; border-radius: 6px; font-size: 11px;
  font-weight: 500; background: #eef0f3; color: var(--muted); border: 1px solid var(--border); }

.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

.btn {
  display: inline-block; background: var(--accent); color: #fff; text-decoration: none;
  padding: 8px 14px; border-radius: 8px; font-size: 14px; border: none; cursor: pointer; font-family: inherit;
}
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid var(--border);
  border-top-color: var(--accent); border-radius: 50%; animation: spin 0.7s linear infinite; vertical-align: middle; }
.spinner-lg { width: 28px; height: 28px; border-width: 3px; }
@keyframes spin { to { transform: rotate(360deg); } }

.state-block { display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 40px 20px; text-align: center; color: var(--muted); font-size: 14px; }
.state-block-icon { font-size: 24px; opacity: 0.5; }
.state-block h3 { margin: 0; font-size: 15px; color: var(--text); }
.state-block p { margin: 0; max-width: 340px; }
</style>
