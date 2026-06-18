# Post-exit session close logic. Sourced by the `claude` shim (claude-wrapper.zsh) AFTER
# an interactive session exits. Read fresh from disk on every call, so edits here take
# effect immediately with NO shell reload.
#
# Input env: CLAUDE_WRAP_TOKEN — this terminal's per-launch token.
# Runs in the caller's CWD (the project dir the session ran in).
#
# Defined-then-called so `return` scopes to this function, not the calling shim.

_claude_postexit() {
  local proj_hook=".claude/hooks/session-state.mjs"
  [[ -f "$proj_hook" ]] || return 0   # project doesn't track sessions → nothing to do

  # Resolve THIS terminal's session id from its token (never a global "current").
  local sid
  sid="$(node "$proj_hook" resolve-token "$CLAUDE_WRAP_TOKEN" 2>/dev/null)"
  [[ -n "$sid" ]] || return 0

  # Already closed via /end-session? Then there's nothing to do.
  node "$proj_hook" needs-close "$sid" >/dev/null 2>&1 || return 0

  # Empty session (opened then exited without input) → no transcript to --resume and
  # nothing worth saving. Skip rather than fail.
  local tpath
  tpath="$(node "$proj_hook" transcript-of "$sid" 2>/dev/null)"
  if [[ -n "$tpath" && ! -s "$tpath" ]]; then
    print -P "%F{yellow}↩ Session $sid had no conversation — nothing to save, skipping /end-session.%f"
    return 0
  fi

  # Real session left open → resume exactly it (not -c) and run /end-session.
  print -P "%F{yellow}↩ Session $sid left open — running /end-session to save progress + next step…%f"
  CLAUDE_AUTOCLOSE=1 CLAUDE_WRAP_TOKEN="$CLAUDE_WRAP_TOKEN" \
    command claude --resume "$sid" -p "/end-session" --permission-mode bypassPermissions
  local close_ec=$?

  if [[ $close_ec -eq 0 ]]; then
    print -P "%F{green}✓ Session $sid closed and saved.%f"
  else
    print -P "%F{red}✗ Auto-close FAILED for $sid (exit $close_ec — see message above).%f"
    print -P "%F{red}  Progress was NOT saved. Run \`claude -c\` then /end-session to recover.%f"
  fi
  return 0
}

_claude_postexit
