paperclip
paperclip-converting-plans-to-tasks
para-memory-files
terminal-bench-loop
diagnose-why-work-stopped
escalate-to-board
board-notify
prompt-fill
lead-update
demo-smoke-check

# MCP servers (connected to this agent):
#   lovable — https://mcp.lovable.dev (v1 API, OAuth). Tools used: get_me /
#             list_workspaces, create_project (name=<slug>), set_project_visibility,
#             deploy_project (publishes <slug>.lovable.app), send_message. Driven
#             directly by the agent in pipeline step 3. There is NO file-export /
#             read-source tool, so demos deploy via Lovable hosting (served under
#             <slug>.usevantyx.com by the Cloudflare proxy), not Vercel.
