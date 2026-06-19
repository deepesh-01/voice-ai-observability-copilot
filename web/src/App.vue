<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { fetchInstalls } from './api';
import { ensureAgents, displayName } from './agents';
import AgentView from './components/AgentView.vue';
import CallView from './components/CallView.vue';
import ConnectionsPanel from './components/ConnectionsPanel.vue';
import OverviewView from './components/OverviewView.vue';

// ── View state machine ────────────────────────────────────────────────────────
// overview → agent → call (each push adds to the stack)

type View =
  | { kind: 'overview' }
  | { kind: 'agent'; agentId: string }
  | { kind: 'call'; callId: string; fromAgentId?: string };

const viewStack = ref<View[]>([{ kind: 'overview' }]);

const currentView = computed((): View => viewStack.value[viewStack.value.length - 1]);

/** Respect the OS "reduce motion" setting — jump instead of smooth-scrolling. */
function scrollToTop() {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
}

function pushView(v: View) {
  viewStack.value = [...viewStack.value, v];
  scrollToTop();
}

function popView() {
  if (viewStack.value.length > 1) {
    viewStack.value = viewStack.value.slice(0, -1);
    scrollToTop();
  }
}

function selectAgent(agentId: string) {
  pushView({ kind: 'agent', agentId });
}

function selectCall(callId: string) {
  const cur = currentView.value;
  pushView({
    kind: 'call',
    callId,
    fromAgentId: cur.kind === 'agent' ? cur.agentId : undefined,
  });
}

function backFromCall() {
  popView();
}

function backFromAgent() {
  popView();
}

// ── Back button label from context ───────────────────────────────────────────

const backLabelForCall = computed((): string => {
  const cur = currentView.value;
  if (cur.kind !== 'call') return 'Back';
  if (cur.fromAgentId) return `← ${displayName(locationId.value, cur.fromAgentId)}`;
  return 'Back to agent';
});

// ── Installs / location ───────────────────────────────────────────────────────

const installs = ref<string[]>([]);
const loadingInstalls = ref(true);
const backendOk = ref<boolean | null>(null);
const selectedLocation = ref<string>('');

async function loadInstalls() {
  loadingInstalls.value = true;
  try {
    const res = await fetch('/health').then((r) => r.json());
    backendOk.value = Boolean(res?.ok);
    installs.value = await fetchInstalls();
    if (installs.value.length && !selectedLocation.value) {
      selectedLocation.value = installs.value[0];
    }
    // Warm the agent-name cache so breadcrumbs/labels show names, not ids.
    if (selectedLocation.value) void ensureAgents(selectedLocation.value);
  } catch {
    backendOk.value = false;
  } finally {
    loadingInstalls.value = false;
  }
}

function refresh() {
  // Reset to overview and reload
  viewStack.value = [{ kind: 'overview' }];
  loadInstalls();
}

onMounted(loadInstalls);

// The active locationId to pass down to views
const locationId = computed(() => selectedLocation.value);

// Switching location resets the drill-down — a stale agent/call belongs to the old
// location. The :key on the views below forces a fresh load for the new location.
watch(selectedLocation, (loc) => {
  viewStack.value = [{ kind: 'overview' }];
  if (loc) void ensureAgents(loc);
});

// Breadcrumb derivation
const breadcrumbs = computed(() => {
  return viewStack.value.map((v, i) => {
    let label = '';
    if (v.kind === 'overview') label = 'All Agents';
    else if (v.kind === 'agent') {
      const name = displayName(locationId.value, v.agentId);
      label = name.length > 24 ? name.slice(0, 24) + '…' : name;
    } else label = v.callId.slice(0, 12) + '…';
    return { label, index: i };
  });
});

function jumpToBreadcrumb(index: number) {
  if (index < viewStack.value.length - 1) {
    viewStack.value = viewStack.value.slice(0, index + 1);
    scrollToTop();
  }
}
</script>

<template>
  <div class="app-shell">
    <!-- Header -->
    <header class="app-header">
      <div class="header-row">
        <div>
          <h1>Voice AI Observability Copilot</h1>
          <p>Monitor &amp; Analyze your HighLevel Voice AI agents — automated KPI scoring and recommendations.</p>
        </div>
        <button class="btn ghost" :disabled="loadingInstalls" @click="refresh">
          {{ loadingInstalls ? 'Refreshing…' : '↻ Refresh' }}
        </button>
      </div>
    </header>

    <!-- Connections: collapsible, demoted below header -->
    <ConnectionsPanel :installs="installs" :backend-ok="backendOk" />

    <!-- No backend / loading state -->
    <div v-if="loadingInstalls" class="card" style="margin-top: 18px;">
      <div class="status-row">
        <span class="spinner"></span>
        <span>Connecting…</span>
      </div>
    </div>

    <template v-else-if="backendOk === false">
      <div class="card" style="margin-top: 18px;">
        <div class="status-row">
          <span class="dot warn"></span>
          <span>Backend unreachable — start the server (<code>cd server &amp;&amp; npm run dev</code>)</span>
        </div>
      </div>
    </template>

    <template v-else>
      <!-- No installs: prompt connection -->
      <div v-if="!installs.length" class="state-block card" style="margin-top: 18px;">
        <div class="state-block-icon">—</div>
        <h3>No HighLevel account connected</h3>
        <p>Connect your HighLevel account to start monitoring Voice AI agent calls.</p>
        <a class="btn" href="/oauth/install">Connect HighLevel account</a>
      </div>

      <template v-else>
        <!-- Location picker (only when >1 account) -->
        <div v-if="installs.length > 1" class="location-picker card">
          <label class="location-label" for="location-select">Location</label>
          <select id="location-select" v-model="selectedLocation" class="location-select">
            <option v-for="loc in installs" :key="loc" :value="loc">{{ loc }}</option>
          </select>
        </div>

        <!-- Dashboard area -->
        <div class="dashboard" style="margin-top: 18px;">
          <!-- Breadcrumb trail -->
          <nav v-if="viewStack.length > 1" class="breadcrumb" aria-label="Navigation breadcrumbs">
            <button
              v-for="(crumb, i) in breadcrumbs"
              :key="i"
              class="crumb"
              :class="{ 'crumb--active': i === breadcrumbs.length - 1 }"
              :disabled="i === breadcrumbs.length - 1"
              :aria-current="i === breadcrumbs.length - 1 ? 'page' : undefined"
              @click="jumpToBreadcrumb(i)"
            >
              <span v-if="i > 0" class="crumb-sep">›</span>
              {{ crumb.label }}
            </button>
          </nav>

          <!-- Views -->
          <OverviewView
            v-if="currentView.kind === 'overview'"
            :key="locationId"
            :location-id="locationId"
            @select-agent="selectAgent"
          />

          <AgentView
            v-else-if="currentView.kind === 'agent'"
            :location-id="locationId"
            :agent-id="currentView.agentId"
            @back="backFromAgent"
            @select-call="selectCall"
          />

          <CallView
            v-else-if="currentView.kind === 'call'"
            :call-id="currentView.callId"
            :back-label="backLabelForCall"
            @back="backFromCall"
          />
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.header-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }

.btn { display: inline-block; background: var(--accent); color: #fff; text-decoration: none;
  padding: 8px 14px; border-radius: 8px; font-size: 14px; border: none; cursor: pointer; font-family: inherit; }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.btn.ghost { background: #fff; color: var(--accent); border: 1px solid var(--border); }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }

.location-picker {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 18px;
  padding: 12px 20px;
}
.location-label { font-size: 13px; font-weight: 600; color: var(--muted); white-space: nowrap; }
.location-select {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  color: var(--text);
  background: #f7f8fa;
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 5px 10px;
  cursor: pointer;
  flex: 1;
  max-width: 400px;
}
.location-select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* Breadcrumb */
.breadcrumb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0;
  margin-bottom: 14px;
}

.crumb {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  font-family: inherit;
  font-size: 13px;
  color: var(--accent);
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
  font-weight: 600;
  transition: background 0.1s ease;
}
@media (hover: hover) and (pointer: fine) {
  .crumb:hover:not(:disabled) { background: #eff6ff; }
}
.crumb:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.crumb--active { color: var(--text); cursor: default; font-weight: 700; }
.crumb--active:hover { background: none; }
.crumb:disabled { opacity: 1; }

.crumb-sep { color: var(--muted); font-size: 15px; margin-right: 2px; }

/* Status row / dot / spinner shared in root (read from global style.css) */
.status-row { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.dot.warn { background: var(--warn); }
.dot.ok { background: var(--ok); }

.spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid var(--border);
  border-top-color: var(--accent); border-radius: 50%; animation: spin 0.7s linear infinite; vertical-align: middle; }
@keyframes spin { to { transform: rotate(360deg); } }

.state-block { display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 40px 20px; text-align: center; color: var(--muted); font-size: 14px; }
.state-block-icon { font-size: 24px; opacity: 0.5; }
.state-block h3 { margin: 0; font-size: 15px; color: var(--text); }
.state-block p { margin: 0; max-width: 340px; }
</style>
