# Claude Code session-close guarantee — STABLE thin shim (zsh).
#
# This file is sourced from ~/.zshrc and defines the `claude` function. Keep it MINIMAL
# and stable: a shell caches a function in memory at source time, so editing a sourced
# function requires reloading every open shell. To avoid that, all the logic that we
# actually iterate on lives in claude-postexit.zsh, which this shim reads FRESH from disk
# on every invocation — so you can change the close behavior with no shell reload.
#
# Install (one line in ~/.zshrc), then reload once with `exec zsh`:
#   source /path/to/highlevel-assignment/.claude/scripts/claude-wrapper.zsh

# Directory of this file, resolved at source time (so the shim can find its sibling script).
_CLAUDE_WRAP_DIR="${0:A:h}"

claude() {
  # Bypass for headless / non-interactive / self-invoked runs so we never recurse.
  if [[ -n "$CLAUDE_AUTOCLOSE" || ! -t 0 ]]; then
    command claude "$@"
    return $?
  fi
  for arg in "$@"; do
    case "$arg" in
      -p|--print) command claude "$@"; return $? ;;
    esac
  done

  # Unique per launch (PID + two RANDOMs) → correlates this terminal to its session,
  # so concurrent terminals never act on each other. Reaches the SessionStart hook via env.
  local tok="wrap-$$-${RANDOM}-${RANDOM}"
  CLAUDE_WRAP_TOKEN="$tok" command claude "$@"
  local ec=$?

  # Delegate the post-exit close to the on-disk script, read fresh each time.
  local post="$_CLAUDE_WRAP_DIR/claude-postexit.zsh"
  [[ -r "$post" ]] && CLAUDE_WRAP_TOKEN="$tok" source "$post"

  return $ec
}
