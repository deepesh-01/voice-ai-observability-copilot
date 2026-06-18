<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';

// Setup-milestone shell: verify the backend is reachable, list installs, and probe the LIVE
// HighLevel connection (not just whether a token exists locally).
// The full agent/call/issue dashboard (R2.4-R2.6) is built once the KPI schema lands.
interface LiveStatus {
  loading: boolean;
  connected?: boolean;
  voiceAiScopeOk?: boolean;
  detail?: string;
}

const backendOk = ref<boolean | null>(null);
const installs = ref<string[]>([]);
const loading = ref(true);
const statuses = reactive<Record<string, LiveStatus>>({});

async function load() {
  loading.value = true;
  try {
    const health = await fetch('/health').then((r) => r.json());
    backendOk.value = Boolean(health?.ok);
    const data = await fetch('/api/installs').then((r) => r.json());
    installs.value = Array.isArray(data?.installs) ? data.installs : [];
  } catch {
    backendOk.value = false;
  } finally {
    loading.value = false;
  }
}

async function checkStatus(key: string) {
  statuses[key] = { loading: true };
  try {
    const s = await fetch(`/api/installs/${encodeURIComponent(key)}/status`).then((r) => r.json());
    statuses[key] = {
      loading: false,
      connected: s.connected,
      voiceAiScopeOk: s.voiceAiScopeOk,
      detail: s.detail,
    };
  } catch {
    statuses[key] = { loading: false, connected: false, detail: 'Could not reach backend.' };
  }
}

function badgeClass(s: LiveStatus): string {
  if (s.loading) return 'warn';
  if (s.connected && s.voiceAiScopeOk) return 'ok';
  if (s.connected) return 'warn';
  return 'bad';
}

onMounted(load);
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="header-row">
        <div>
          <h1>Voice AI Observability Copilot</h1>
          <p>Monitor &amp; Analyze your HighLevel Voice AI agents — automated KPI scoring and recommendations.</p>
        </div>
        <button class="btn ghost" :disabled="loading" @click="load">
          {{ loading ? 'Refreshing…' : '↻ Refresh' }}
        </button>
      </div>
    </header>

    <section class="card">
      <div class="status-row">
        <span class="dot" :class="backendOk ? 'ok' : 'warn'"></span>
        <span v-if="loading">Checking backend…</span>
        <span v-else-if="backendOk">Backend connected</span>
        <span v-else>Backend unreachable — start the server (<code>cd server &amp;&amp; npm run dev</code>)</span>
      </div>
    </section>

    <section class="card">
      <h3 style="margin-top: 0">Connected HighLevel accounts</h3>
      <p class="muted small">Local token on file. Click “Check HighLevel status” to verify it’s still live.</p>

      <div v-if="installs.length">
        <div v-for="id in installs" :key="id" class="install-row">
          <div class="install-head">
            <span class="dot" :class="statuses[id] ? badgeClass(statuses[id]) : 'idle'"></span>
            <span class="mono">{{ id }}</span>
            <button class="btn small" :disabled="statuses[id]?.loading" @click="checkStatus(id)">
              {{ statuses[id]?.loading ? 'Checking…' : 'Check HighLevel status' }}
            </button>
          </div>
          <p v-if="statuses[id] && !statuses[id].loading" class="detail" :class="badgeClass(statuses[id])">
            {{ statuses[id].detail }}
          </p>
        </div>
      </div>

      <div v-else>
        <p class="muted">No HighLevel account connected yet.</p>
        <a class="btn" href="/oauth/install">Connect HighLevel account</a>
      </div>
    </section>
  </div>
</template>

<style scoped>
.header-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.small { font-size: 12.5px; }
.install-row { padding: 10px 0; border-top: 1px solid var(--border); }
.install-row:first-of-type { border-top: none; }
.install-head { display: flex; align-items: center; gap: 10px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.detail { margin: 6px 0 0 19px; font-size: 13px; }
.detail.ok { color: var(--ok); }
.detail.warn { color: var(--warn); }
.detail.bad { color: #dc2626; }
.dot.bad { background: #dc2626; }
.dot.idle { background: #c7ccd4; }
.btn.small { padding: 4px 10px; font-size: 12.5px; }
.btn.ghost { background: #fff; color: var(--accent); border: 1px solid var(--border); }
</style>
