#!/usr/bin/env bash
# Thin web shim for the claude-memory spine. THIS FILE CONTAINS NO HOOK LOGIC.
# It exists only because a web session is a fresh machine with no ~/.claude:
#   detect env  ->  fetch the SHARED loader/saver from dotclaude  ->  delegate.
# Updating the real hook in dotclaude updates behavior everywhere; this shim
# never goes stale because it holds no copy of that logic.
#
# Local machines already have the shared hooks in their own ~/.claude (the
# dotclaude repo), so this shim is INERT off the web -> immediate exit 0, no
# double-loading.
#
# CONTRACT: must NEVER wedge a session. Every failure path -> exit 0.
# Usage (from .claude/settings.json):  bootstrap.sh load   |   bootstrap.sh save

MODE="${1:-load}"
DOTCLAUDE_URL='https://github.com/Rfog88/dotclaude.git'
BRANCH='claude/mcp-stack-setup-yQkp4'   # TODO Phase 1 completion: -> 'main'

# Only the web needs bootstrapping; local machines use their own ~/.claude hooks.
[ -z "$CLAUDE_CODE_REMOTE" ] && exit 0

{
  CACHE="${HOME:-$USERPROFILE}/.cache/dotclaude"
  if [ -d "$CACHE/.git" ]; then
    git -C "$CACHE" fetch --quiet origin "$BRANCH" >/dev/null 2>&1
    git -C "$CACHE" checkout --quiet "$BRANCH"      >/dev/null 2>&1
    git -C "$CACHE" pull --quiet --ff-only origin "$BRANCH" >/dev/null 2>&1
  else
    mkdir -p "$(dirname "$CACHE")" >/dev/null 2>&1
    git clone --quiet --branch "$BRANCH" "$DOTCLAUDE_URL" "$CACHE" >/dev/null 2>&1
  fi

  case "$MODE" in
    load) SCRIPT="$CACHE/hooks/memory-load.sh" ;;
    save) SCRIPT="$CACHE/hooks/memory-save.sh" ;;
    *)    exit 0 ;;
  esac

  # Delegate. exec passes the hook's stdin payload straight through to the shared script.
  [ -f "$SCRIPT" ] && exec bash "$SCRIPT"
} 2>/dev/null

exit 0
