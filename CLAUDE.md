# Project context — load before starting work

This project uses the claude-memory spine for persistent state. Before responding to any task:
1. Read the project state:
   - Web: `/home/user/claude-memory/projects/vantyx/STATE.md`
   - Local: `~/.cache/claude-memory/projects/vantyx/STATE.md`
   - Use whichever path exists.
2. Read shared user context: same memory store root, `shared/user_role.md`
3. Reference Active task, Next steps, and Open questions to orient yourself.

Memory store root: `/home/user/claude-memory` (web) or `~/.cache/claude-memory` (local).

The `.claude/hooks/bootstrap.sh` does this automatically when the platform fires SessionStart — if you see memory already loaded, skip these steps.
