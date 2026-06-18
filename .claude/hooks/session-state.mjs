#!/usr/bin/env node
/**
 * Session lifecycle state for this project. Multi-terminal safe.
 *
 * Registry at .claude/state/sessions.json:
 *   { current: <id>, sessions: { <id>: {cwd, source, startedAt, status, isDevSession,
 *                                        endedAt, closedVia, wrapToken} } }
 *
 * `current` is a best-effort convenience pointer ONLY. With multiple terminals open in
 * the same project it gets clobbered by whichever session started last, so nothing that
 * must be correct relies on it. Instead, each terminal is correlated to its own session
 * via CLAUDE_WRAP_TOKEN (a unique value the shell wrapper exports before launching claude;
 * the SessionStart hook records token→id). Mutations target an EXPLICIT session id,
 * resolved in this order: CLI arg → env token → current.
 *
 * Concurrent hook firings can race on the JSON file, so every read-modify-write runs
 * under a lock (.sessions.json.lock).
 *
 * Subcommands:
 *   start              (SessionStart hook; stdin=hook JSON) → register active session,
 *                      record wrapToken, inject the "dev session?" instruction + last end record.
 *   set-dev X [id]     → record yes/no on the resolved session.
 *   end [id]           (/end-session skill) → mark the resolved session cleanly ended.
 *   end-hook           (SessionEnd hook; stdin=hook JSON) → mark ended-if-active (keyed by the
 *                      stdin session_id, so never clobbers another terminal), log + warn.
 *   needs-close [id]   → exit 0 if the resolved session was NOT closed via /end-session.
 *   resolve-token TOK  → print the session id whose wrapToken === TOK (empty if none).
 *   list               → print the registry.
 */
import {
  readFileSync, writeFileSync, appendFileSync, mkdirSync,
  openSync, closeSync, unlinkSync, statSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const STATE = resolve(projectDir, '.claude/state/sessions.json');
const LOCK = STATE + '.lock';
const LOG = resolve(projectDir, '.claude/state/session-end.log');

const now = () => new Date().toISOString();

// --- durable proof a lifecycle event fired (SessionEnd output renders inconsistently) ---
const logEvent = (line) => {
  const entry = `${now()} ${line}\n`;
  try {
    mkdirSync(dirname(LOG), { recursive: true });
    appendFileSync(LOG, entry);
  } catch {
    /* logging is best-effort */
  }
  return entry.trimEnd();
};

// --- state io ---
const load = () => {
  try {
    return JSON.parse(readFileSync(STATE, 'utf8'));
  } catch {
    return { current: null, sessions: {} };
  }
};
const save = (s) => {
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify(s, null, 2) + '\n');
};

// --- cross-process lock (atomic O_EXCL create; steals locks older than 5s) ---
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const acquireLock = () => {
  mkdirSync(dirname(LOCK), { recursive: true });
  for (let i = 0; i < 100; i++) {
    try {
      closeSync(openSync(LOCK, 'wx'));
      return true;
    } catch {
      try {
        if (Date.now() - statSync(LOCK).mtimeMs > 5000) unlinkSync(LOCK);
      } catch {
        /* lock vanished between stat and unlink — fine */
      }
      sleep(20);
    }
  }
  return false; // give up after ~2s and proceed un-locked rather than hang the hook
};
const releaseLock = () => {
  try {
    unlinkSync(LOCK);
  } catch {
    /* already released */
  }
};
// Run fn against the freshest state under the lock, then persist.
const withLock = (fn) => {
  const locked = acquireLock();
  try {
    const fresh = load();
    const result = fn(fresh);
    save(fresh);
    return result;
  } finally {
    if (locked) releaseLock();
  }
};

const readStdin = () => {
  if (process.stdin.isTTY) return {};
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
};

// Resolve which session a command targets: explicit arg → this terminal's env token → current.
const resolveId = (explicit, state) => {
  if (explicit) return explicit;
  const tok = process.env.CLAUDE_WRAP_TOKEN;
  if (tok) {
    const hit = Object.entries(state.sessions).find(([, v]) => v.wrapToken === tok);
    if (hit) return hit[0];
  }
  return state.current;
};

const cmd = process.argv[2];

if (cmd === 'start') {
  const input = readStdin();
  const id = input.session_id || 'unknown';
  const wrapToken = process.env.CLAUDE_WRAP_TOKEN || null;
  withLock((st) => {
    const prev = st.sessions[id] || {};
    st.sessions[id] = {
      cwd: input.cwd || projectDir,
      source: input.source || 'startup',
      startedAt: prev.startedAt || now(),
      status: 'active',
      isDevSession: prev.isDevSession ?? null,
      endedAt: null,
      closedVia: undefined,
      wrapToken: wrapToken ?? prev.wrapToken ?? null,
      // Used by the wrapper to skip auto-close for empty sessions (no conversation to resume).
      transcriptPath: input.transcript_path || prev.transcriptPath || null,
    };
    st.current = id;
  });
  // Surface the previous session's SessionEnd record — the reliable place the user sees it.
  let lastEnd = '';
  try {
    const lines = readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean);
    if (lines.length) lastEnd = ` Previous SessionEnd hook record: "${lines[lines.length - 1]}".`;
  } catch {
    /* no prior end-events logged yet */
  }
  const context =
    `Session ${id} started in this project.${lastEnd} Per the session practice (docs/sessions/README.md): ` +
    `(1) ASK the user "Is this a development session?" via AskUserQuestion, then record it with ` +
    `\`node .claude/hooks/session-state.mjs set-dev <yes|no>\`. ` +
    `(2) Before this session ends, run the /end-session skill to save progress + the next step.`;
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }),
  );
} else if (cmd === 'set-dev') {
  const val = String(process.argv[3] ?? '').toLowerCase();
  const isDev = ['yes', 'y', 'true', '1', 'dev', 'development'].includes(val);
  const id = withLock((st) => {
    const target = resolveId(process.argv[4], st);
    if (target && st.sessions[target]) st.sessions[target].isDevSession = isDev;
    return target;
  });
  console.log(`session ${id}: isDevSession=${isDev}`);
} else if (cmd === 'end') {
  const id = withLock((st) => {
    const target = resolveId(process.argv[3], st);
    if (target && st.sessions[target]) {
      st.sessions[target].status = 'ended';
      st.sessions[target].endedAt = now();
      st.sessions[target].closedVia = 'end-session-skill';
    }
    return target;
  });
  console.log(`session ${id}: ended (clean)`);
} else if (cmd === 'end-hook') {
  const input = readStdin();
  const reason = input.reason || 'unknown';
  // Key off the stdin session_id — the authoritative id for THIS terminal's teardown.
  // Never fall back to `current` here: that could close a different terminal's session.
  const { id, wasActive } = withLock((st) => {
    const tid = input.session_id || resolveId(null, st);
    const s = tid ? st.sessions[tid] : null;
    const active = !!(s && s.status === 'active');
    if (active) {
      s.status = 'ended';
      s.endedAt = now();
      s.closedVia = `session-end-hook (unclean — /end-session not run; reason=${reason})`;
    }
    return { id: tid, wasActive: active };
  });
  const logged = logEvent(
    `end-hook  session=${id} reason=${reason} ` +
      (wasActive ? 'CLOSED-UNCLEAN (/end-session was not run)' : 'noop (already ended cleanly)'),
  );
  const msg = wasActive
    ? `⚠️ SessionEnd hook fired for ${id} WITHOUT /end-session — progress/next-step may be unsaved. ` +
      `Logged to .claude/state/session-end.log; next session will surface this.`
    : `✅ SessionEnd hook fired for ${id} (clean close). Logged to .claude/state/session-end.log.`;
  process.stderr.write(msg + '\n');
  process.stderr.write(logged + '\n');
  process.stdout.write(JSON.stringify({ systemMessage: msg }));
} else if (cmd === 'needs-close') {
  // Did /end-session run for the resolved session? Only `closedVia` can tell skill-close
  // from fallback-close (the SessionEnd hook always marks `ended`). Exit 0 = needs close.
  const st = load();
  const id = resolveId(process.argv[3], st);
  const s = id ? st.sessions[id] : null;
  const needs = !!(s && s.closedVia !== 'end-session-skill');
  console.log(needs ? `yes (session=${id} closedVia=${s ? s.closedVia ?? 'active' : 'none'})` : 'no');
  process.exit(needs ? 0 : 1);
} else if (cmd === 'resolve-token') {
  // Print the session id this terminal's wrapper launched (empty string if not found).
  const tok = process.argv[3];
  const st = load();
  const hit = tok ? Object.entries(st.sessions).find(([, v]) => v.wrapToken === tok) : null;
  process.stdout.write(hit ? hit[0] : '');
} else if (cmd === 'transcript-of') {
  // Print the recorded transcript path for a session (empty if unknown). The wrapper uses
  // this to skip auto-close for empty sessions, which have no conversation to --resume.
  const id = process.argv[3];
  const st = load();
  const s = id ? st.sessions[id] : null;
  process.stdout.write(s && s.transcriptPath ? s.transcriptPath : '');
} else if (cmd === 'list') {
  const st = load();
  const active = Object.entries(st.sessions)
    .filter(([, v]) => v.status === 'active')
    .map(([id, v]) => ({ id, ...v }));
  console.log(JSON.stringify({ current: st.current, activeCount: active.length, active, all: st.sessions }, null, 2));
} else {
  console.error('usage: session-state.mjs <start|set-dev <yes|no> [id]|end [id]|end-hook|needs-close [id]|resolve-token <tok>|list>');
  process.exit(1);
}
