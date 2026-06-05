# `.claude/` — claude-memory web shim (Phase 1 pilot)

This directory is a **thin bootstrap** so that a **web** Claude Code session (a fresh
container with no `~/.claude`) auto-loads this project's memory from the
[`claude-memory`](https://github.com/Rfog88/claude-memory) spine.

- `settings.json` registers `SessionStart`/`SessionEnd` hooks that call `hooks/bootstrap.sh`.
- `hooks/bootstrap.sh` holds **no hook logic**. On the web it fetches the shared loader/saver
  from the [`dotclaude`](https://github.com/Rfog88/dotclaude) repo and delegates. Off the web
  it exits immediately — local machines use their own `~/.claude` hooks, so there is no
  double-loading and nothing here runs on your home/work PC.

**Status:** lives on branch `claude/mcp-stack-setup-yQkp4`. It only goes live once merged to
the default branch — gated on the Phase 1 cross-machine hard test passing, the same green
light as the dotclaude merge. Do not merge to `master` before then.

**Web prerequisites:** `Rfog88/claude-memory` and `Rfog88/dotclaude` must both be in the web
session's repository scope (the shim clones dotclaude for the shared hooks; the shared loader
clones claude-memory for the content).
