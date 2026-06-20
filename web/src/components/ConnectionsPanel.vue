<script setup lang="ts">
import { onUnmounted, reactive, ref, watch, nextTick } from 'vue';
import { fetchInstallStatus } from '../api';

const { installs, backendOk } = defineProps<{
  installs: string[];
  backendOk: boolean | null;
}>();

const open = ref(false);
const triggerEl = ref<HTMLButtonElement | null>(null);
const closeEl = ref<HTMLButtonElement | null>(null);

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

// ── Modal lifecycle: Esc to close, lock body scroll, return focus to trigger ──
function close() {
  open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close();
}
watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    nextTick(() => closeEl.value?.focus());
  } else {
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
    triggerEl.value?.focus();
  }
});
onUnmounted(() => {
  document.removeEventListener('keydown', onKey);
  document.body.style.overflow = '';
});
</script>

<template>
  <!-- Compact corner trigger — status dot shows backend health at a glance. -->
  <button
    ref="triggerEl"
    class="conn-trigger"
    :title="backendOk ? 'Connections — backend connected' : 'Connections — backend status'"
    aria-label="Connections & Settings"
    @click="open = true"
  >
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
    <span class="conn-dot" :class="backendOk ? 'ok' : 'warn'"></span>
  </button>

  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="modal-backdrop" @click.self="close">
        <div class="modal" role="dialog" aria-modal="true" aria-label="Connections & Settings">
          <div class="modal-header">
            <div class="modal-title-wrap">
              <span class="dot" :class="backendOk ? 'ok' : 'warn'"></span>
              <h2 class="modal-title">Connections &amp; Settings</h2>
              <span v-if="installs.length" class="account-count">{{ installs.length }} account{{ installs.length === 1 ? '' : 's' }}</span>
            </div>
            <button ref="closeEl" class="modal-close" aria-label="Close" @click="close">✕</button>
          </div>

          <div class="modal-body">
            <div class="backend-row">
              <span v-if="backendOk" class="ok-text">● Backend connected</span>
              <span v-else class="bad-text">● Backend unreachable — run <code>cd server &amp;&amp; npm run dev</code></span>
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
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ── Trigger icon ────────────────────────────────────────────────────────────── */
.conn-trigger {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: #fff;
  border: 1px solid var(--border);
  color: var(--muted);
  cursor: pointer;
  font-family: inherit;
  transition: background 120ms var(--ease-out), border-color 120ms var(--ease-out),
    color 120ms var(--ease-out), transform 120ms var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .conn-trigger:hover { color: var(--text); border-color: var(--muted); }
}
.conn-trigger:active { transform: scale(0.95); }
.conn-trigger:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.conn-dot {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 2px solid var(--bg);
}
.conn-dot.ok { background: var(--ok); }
.conn-dot.warn { background: var(--warn); }

/* ── Modal ───────────────────────────────────────────────────────────────────── */
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(17, 22, 35, 0.42);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.modal {
  width: 100%;
  max-width: 460px;
  max-height: 80vh;
  overflow-y: auto;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
  /* Modals stay center-anchored (not trigger-anchored) — see Emil's exception. */
  transform-origin: center;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
}
.modal-title-wrap { display: flex; align-items: center; gap: 8px; min-width: 0; }
.modal-title { margin: 0; font-size: 15px; font-weight: 700; }
.account-count {
  font-size: 11.5px;
  font-weight: 500;
  padding: 1px 7px;
  border-radius: 999px;
  background: #eef0f3;
  color: var(--muted);
}
.modal-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: none;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 14px;
  font-family: inherit;
  transition: background 120ms var(--ease-out), color 120ms var(--ease-out), transform 120ms var(--ease-out);
  flex-shrink: 0;
}
@media (hover: hover) and (pointer: fine) {
  .modal-close:hover { background: #f1f2f4; color: var(--text); }
}
.modal-close:active { transform: scale(0.92); }
.modal-close:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.modal-body { padding: 6px 18px 18px; }

.backend-row { padding: 12px 0 6px; font-size: 13px; }
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

/* ── Transitions: backdrop fades, modal scales from center (Emil). Exit is faster. ── */
.modal-enter-active { transition: opacity 200ms var(--ease-out); }
.modal-leave-active { transition: opacity 150ms var(--ease-out); }
.modal-enter-active .modal { transition: transform 200ms var(--ease-out), opacity 200ms var(--ease-out); }
.modal-leave-active .modal { transition: transform 150ms var(--ease-out), opacity 150ms var(--ease-out); }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .modal { transform: scale(0.96); opacity: 0; }
.modal-leave-to .modal { transform: scale(0.97); opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .conn-trigger:active, .modal-close:active { transform: none; }
  .modal-enter-from .modal, .modal-leave-to .modal { transform: none; }
}
</style>
