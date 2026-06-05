#!/usr/bin/env bash
# Thin web shim for the claude-memory spine. THIS FILE CONTAINS NO HOOK LOGIC.
# A web session is a fresh container with no ~/.claude, BUT the platform pre-clones
# all in-scope repos into it. So:
#   detect web  ->  DISCOVER the pre-cloned dotclaude checkout  ->  delegate to its
#   shared loader/saver. No cloning, no copy of hook logic, nothing goes stale.
#
# Off the web this exits immediately -- local machines use their own ~/.claude hooks,
# so nothing here runs on your home/work PC and there is no double-loading.
#
# CONTRACT: must NEVER wedge a session. Every path -> exit 0.
# Usage (from .claude/settings.json):  bootstrap.sh load   |   bootstrap.sh save

MODE="${1:-load}"
BRANCH='main'   # dotclaude default branch (Phase 1 merged to default)
WANT='rfog88/dotclaude'
NAME='dotclaude'

# Only the web needs bootstrapping; local machines already have the shared hooks.
[ -z "$CLAUDE_CODE_REMOTE" ] && exit 0

# Canonicalize any remote URL to owner/repo (the last two path segments), lowercased.
# Robust to proxy path prefixes of ANY depth (e.g. .../git/owner/repo), scp-style
# git@host:owner/repo, ssh://, and a trailing .git -- not just today's '/git/' prefix.
normalize() {
  local r="$1"
  r="${r#*://}"          # strip scheme://  (no-op for scp-style git@host:...)
  r="${r%/}"             # strip a trailing slash
  r="${r%.git}"          # strip a trailing .git
  r="${r//:/\/}"         # scp-style / userinfo / port colons -> '/'
  local repo rest owner
  repo="${r##*/}"        # last path segment        = repo
  rest="${r%/*}"         # everything before it
  owner="${rest##*/}"    # last segment of the rest = owner
  printf '%s/%s' "$owner" "$repo" | tr '[:upper:]' '[:lower:]'
}
remote_matches() { local d="$1" w="$2" r; r="$(git -C "$d" remote get-url origin 2>/dev/null)" || return 1; [ "$(normalize "$r")" = "$w" ]; }
discover_checkout() {
  local want="$1" name="$2" pj="$3" c base
  for c in "/home/user/$name" "$HOME/$name" "/workspace/$name" "/workspaces/$name" "$(dirname "$pj")/$name"; do
    [ -d "$c/.git" ] && remote_matches "$c" "$want" && { printf '%s' "$c"; return 0; }
  done
  for base in /home/user "$HOME" /workspace /workspaces; do
    [ -d "$base" ] || continue
    for c in "$base"/*; do
      [ -d "$c/.git" ] || continue
      remote_matches "$c" "$want" && { printf '%s' "$c"; return 0; }
    done
  done
  return 1
}

# Visible one-liner: load -> stdout (injected into context), save -> stderr.
warn() {
  if [ "$MODE" = "load" ]; then
    if command -v jq >/dev/null 2>&1; then
      jq -n --arg c "claude-memory: $1" '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$c}}'
    else
      printf '%s\n' "claude-memory: $1"
    fi
  else
    printf '%s\n' "claude-memory: $1" >&2
  fi
}

PJ="${CLAUDE_PROJECT_DIR:-$PWD}"
DOT="$(discover_checkout "$WANT" "$NAME" "$PJ")"
if [ -z "$DOT" ]; then
  warn "no dotclaude checkout found in this web container (is Rfog88/dotclaude in repo scope?). Skipping memory auto-load."
  exit 0
fi

# bring our branch's shared hooks into the checkout (platform auth); best-effort
git -C "$DOT" fetch --quiet origin "$BRANCH"          >/dev/null 2>&1
git -C "$DOT" checkout --quiet "$BRANCH"              >/dev/null 2>&1
git -C "$DOT" pull --quiet --ff-only origin "$BRANCH" >/dev/null 2>&1

case "$MODE" in
  load) SCRIPT="$DOT/hooks/memory-load.sh" ;;
  save) SCRIPT="$DOT/hooks/memory-save.sh" ;;
  *)    exit 0 ;;
esac

# Delegate. exec passes the hook's stdin payload straight through to the shared script.
if [ -f "$SCRIPT" ]; then exec bash "$SCRIPT"; fi

warn "shared $MODE hook not found in the dotclaude checkout. Skipping."
exit 0
