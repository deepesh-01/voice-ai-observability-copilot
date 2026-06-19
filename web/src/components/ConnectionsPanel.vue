<script setup lang="ts">
import { reactive, ref } from 'vue';
import { fetchInstallStatus } from '../api';

const { installs, backendOk } = defineProps<{
  installs: string[];
  backendOk: boolean | null;
}>();

const open = ref(false);

interface LiveStatus {
  loading: boolean;
  connected?: boolean;
  voiceAiScopeOk?: boolean;
  detail?: string;
}

const statuses = reactive<Record<string, LiveStatus>>({});

async function checkStatus(key: string) {
  statuses[key] = { loading: true };
  try {
    const s = await fetchInstallStatus(key);
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
</script>

<template>
  <div class="connections-panel card">
    <button class="panel-toggle" :aria-expanded="open" @click="open = !open">
      <div class="toggle-left">
        <span class="dot" :class="backendOk ? 'ok' : 'warn'"></span>
        <span class="toggle-label">Connections &amp; Settings</span>
        <span v-if="installs.length" class="account-count">{{ installs.length }} account{{ installs.length === 1 ? '' : 's' }}</span>
      </div>
      <span class="chevron" :class="{ 'chevron--open': open }">›</span>
    </button>

    <div v-show="open" class="panel-body">
      <div class="backend-row">
        <span v-if="backendOk" class="ok-text">Backend connected</span>
        <span v-else class="bad-text">Backend unreachable — run <code>cd server &amp;&amp; npm run dev</code></span>
      </div>

      <div v-if="installs.length">
        <div v-for="id in installs" :key="id" class="install-row">
          <div class="install-head">
            <span class="dot" :class="statuses[id] ? badgeClass(statuses[id]) : 'idle'"></span>
            <span class="mono">{{ id }}</span>
            <button class="btn small ghost" :disabled="statuses[id]?.loading" @click="checkStatus(id)">
              {{ statuses[id]?.loading ? 'Checking…' : 'Check HighLevel status' }}
            </button>
          </div>
          <p v-if="statuses[id] && !statuses[id].loading" class="detail" :class="badgeClass(statuses[id])">
            {{ statuses[id].detail }}
            <a
              v-if="statuses[id].connected === false || statuses[id].voiceAiScopeOk === false"
              class="reinstall-link"
              href="/oauth/install"
            >Re-authorize →</a>
          </p>
        </div>
        <div class="connect-action">
          <a class="btn ghost small" href="/oauth/install">+ Connect / re-authorize account</a>
        </div>
      </div>

      <div v-else class="empty-connections">
        <p class="muted">No HighLevel account connected yet.</p>
        <a class="btn" href="/oauth/install">Connect HighLevel account</a>
      </div>
    </div>
  </div>
</template>

<style scoped>
.connections-panel { padding: 0; }

.panel-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  background: none;
  border: none;
  cursor: pointer;
  padding: 14px 20px;
  font-family: inherit;
  font-size: 13.5px;
  color: var(--text);
  text-align: left;
}
.panel-toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  border-radius: 12px;
}

.toggle-left { display: flex; align-items: center; gap: 8px; }
.toggle-label { font-weight: 600; }

.account-count {
  font-size: 11.5px;
  font-weight: 500;
  padding: 1px 7px;
  border-radius: 999px;
  background: #eef0f3;
  color: var(--muted);
}

.chevron {
  font-size: 18px;
  color: var(--muted);
  display: inline-block;
  transition: transform 0.22s ease;
  line-height: 1;
  transform: rotate(0deg);
}
.chevron--open { transform: rotate(90deg); }

.panel-body {
  padding: 0 20px 16px;
  border-top: 1px solid var(--border);
}

.backend-row {
  padding: 10px 0 6px;
  font-size: 13px;
}
.ok-text { color: var(--ok); }
.bad-text { color: #dc2626; }

.install-row { padding: 10px 0; border-top: 1px solid var(--border); }
.install-row:first-of-type { border-top: none; }
.install-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }

.detail { margin: 6px 0 0 17px; font-size: 13px; }
.detail.ok { color: var(--ok); }
.detail.warn { color: var(--warn); }
.detail.bad { color: #dc2626; }

.dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.dot.ok { background: var(--ok); }
.dot.warn { background: var(--warn); }
.dot.bad { background: #dc2626; }
.dot.idle { background: #c7ccd4; }

.btn { display: inline-block; background: var(--accent); color: #fff; text-decoration: none;
  padding: 8px 14px; border-radius: 8px; font-size: 14px; border: none; cursor: pointer; font-family: inherit; }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.btn.small { padding: 4px 10px; font-size: 12px; }
.btn.ghost { background: #fff; color: var(--accent); border: 1px solid var(--border); }

.connect-action { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
.reinstall-link { margin-left: 8px; font-weight: 600; white-space: nowrap; color: var(--accent); }
.empty-connections { padding: 12px 0; }
</style>
