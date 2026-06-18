<script setup lang="ts">
import { onMounted, ref } from 'vue';

// Setup-milestone shell: verify the backend is reachable and show install state.
// The full agent/call/issue dashboard (R2.4-R2.6) is built once the KPI schema lands.
const backendOk = ref<boolean | null>(null);
const installs = ref<string[]>([]);
const loading = ref(true);

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

onMounted(load);
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <h1>Voice AI Observability Copilot</h1>
      <p>Monitor &amp; Analyze your HighLevel Voice AI agents — automated KPI scoring and recommendations.</p>
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
      <div v-if="installs.length">
        <div v-for="id in installs" :key="id" class="status-row" style="margin: 6px 0">
          <span class="dot ok"></span><span>{{ id }}</span>
        </div>
      </div>
      <div v-else>
        <p class="muted">No HighLevel account connected yet.</p>
        <a class="btn" href="/oauth/install">Connect HighLevel account</a>
      </div>
    </section>
  </div>
</template>
