#!/usr/bin/env node
/**
 * Session lifecycle state for this project.
 * Maintains a registry of sessions in .claude/state/sessions.json:
 *   { current: <id>, sessions: { <id>: {cwd, source, startedAt, status, isDevSession, endedAt, closedVia} } }
 *
 * Subcommands:
 *   start      (SessionStart hook; reads hook JSON on stdin) → register active session + inject the
 *              "is this a development session?" instruction back to the model.
 *   set-dev X  (model runs after asking the user) → record yes/no on the current session.
 *   end        (/end-session skill) → mark the current session cleanly ended.
 *   end-hook   (SessionEnd hook; reads hook JSON on stdin) → if still active (unclean/forced exit),
 *              mark ended and warn the user that /end-session wasn't run.
 *   list       → print the registry (active + all).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const STATE = resolve(projectDir, '.claude/state/sessions.json');

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
const readStdin = () => {
  if (process.stdin.isTTY) return {};
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
};
const now = () => new Date().toISOString();

const cmd = process.argv[2];
const st = load();

if (cmd === 'start') {
  const input = readStdin();
  const id = input.session_id || 'unknown';
  const prev = st.sessions[id] || {};
  st.sessions[id] = {
    cwd: input.cwd || projectDir,
    source: input.source || 'startup',
    startedAt: prev.startedAt || now(),
    status: 'active',
    isDevSession: prev.isDevSession ?? null,
    endedAt: null,
  };
  st.current = id;
  save(st);
  const context =
    `Session ${id} started in this project. Per the session practice (docs/sessions/README.md): ` +
    `(1) ASK the user "Is this a development session?" via AskUserQuestion, then record it with ` +
    `\`node .claude/hooks/session-state.mjs set-dev <yes|no>\`. ` +
    `(2) Before this session ends, run the /end-session skill to save progress + the next step.`;
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }),
  );
} else if (cmd === 'set-dev') {
  const val = String(process.argv[3] ?? '').toLowerCase();
  const isDev = ['yes', 'y', 'true', '1', 'dev', 'development'].includes(val);
  const id = st.current;
  if (id && st.sessions[id]) {
    st.sessions[id].isDevSession = isDev;
    save(st);
  }
  console.log(`session ${id}: isDevSession=${isDev}`);
} else if (cmd === 'end') {
  const id = st.current;
  if (id && st.sessions[id]) {
    st.sessions[id].status = 'ended';
    st.sessions[id].endedAt = now();
    st.sessions[id].closedVia = 'end-session-skill';
    save(st);
  }
  console.log(`session ${id}: ended (clean)`);
} else if (cmd === 'end-hook') {
  const input = readStdin();
  const id = input.session_id || st.current;
  const s = id ? st.sessions[id] : null;
  if (s && s.status === 'active') {
    s.status = 'ended';
    s.endedAt = now();
    s.closedVia = 'session-end-hook (unclean — /end-session not run)';
    save(st);
    process.stdout.write(
      JSON.stringify({
        systemMessage:
          `⚠️ Session ${id} ended WITHOUT running /end-session — progress/next-step may be unsaved. ` +
          `Next session: check docs/sessions for an unfinished log.`,
      }),
    );
  }
} else if (cmd === 'list') {
  const active = Object.entries(st.sessions)
    .filter(([, v]) => v.status === 'active')
    .map(([id, v]) => ({ id, ...v }));
  console.log(JSON.stringify({ current: st.current, activeCount: active.length, active, all: st.sessions }, null, 2));
} else {
  console.error('usage: session-state.mjs <start|set-dev <yes|no>|end|end-hook|list>');
  process.exit(1);
}
