# Claude Code session-close guarantee (zsh). Multi-terminal safe.
#
# Problem: a SessionEnd hook fires non-interactively at teardown — it can't prompt you
# or run /end-session. So /end-session can be silently skipped on /exit, Ctrl-D, or
# Ctrl-C, and the session log + "next step" never get written.
#
# Fix: wrap `claude` so that AFTER an interactive session exits, if THIS terminal's
# session wasn't closed via /end-session, we resume THAT exact session headlessly and
# run it. It doesn't block the exit — it guarantees the close runs on the way out.
#
# Multiple terminals: every project shares one sessions.json, so we must not act on a
# global "current" pointer. Each launch exports a unique CLAUDE_WRAP_TOKEN; the
# SessionStart hook records token→session-id; on exit we resolve our own id from the
# token and target it explicitly with `--resume <id>` (never `-c`, which would resume
# whichever terminal was most recent).
#
# Install: add to ~/.zshrc, then `source ~/.zshrc` (or open a new terminal):
#   source /Users/deepeshz2/Documents/highlevel-assignment/.claude/scripts/claude-wrapper.zsh
#
# Scope: auto-close only triggers in projects that have .claude/hooks/session-state.mjs,
# so it is safe to enable globally.

claude() {
  # Bypass for non-interactive / headless / self-invoked runs so we never recurse.
  if [[ -n "$CLAUDE_AUTOCLOSE" || ! -t 0 ]]; then
    command claude "$@"
    return $?
  fi
  for arg in "$@"; do
    case "$arg" in
      -p|--print) command claude "$@"; return $? ;;
    esac
  done

  local proj_hook=".claude/hooks/session-state.mjs"
  # Unique per launch: PID + two RANDOMs. Distinguishes concurrent terminals.
  local tok="wrap-$$-${RANDOM}-${RANDOM}"

  # Run the real interactive session. Control returns here however it exits
  # (/exit, Ctrl-D, Ctrl-C — anything short of kill -9). The token reaches the
  # SessionStart hook via claude's inherited environment.
  CLAUDE_WRAP_TOKEN="$tok" command claude "$@"
  local ec=$?

  # Resolve THIS terminal's session id from our token (empty if this project isn't tracked).
  local sid=""
  [[ -f "$proj_hook" ]] && sid="$(node "$proj_hook" resolve-token "$tok" 2>/dev/null)"

  # If that specific session wasn't closed via /end-session, close it now — resuming
  # exactly it (not -c) so the saved log has the right conversation's context.
  if [[ -n "$sid" ]] && node "$proj_hook" needs-close "$sid" >/dev/null 2>&1; then
    print -P "%F{yellow}↩ Session $sid left open — running /end-session to save progress + next step…%f"
    CLAUDE_AUTOCLOSE=1 CLAUDE_WRAP_TOKEN="$tok" \
      command claude --resume "$sid" -p "/end-session" --permission-mode bypassPermissions
    print -P "%F{green}✓ Session $sid closed and saved.%f"
  fi

  return $ec
}
