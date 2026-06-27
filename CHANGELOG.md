# Changelog

## [0.3.0] — 2026-04-06

### Added
- **ARIA chat bubble** — floating `◈` button opens a GPT-4o-mini chat panel with streaming responses
  - Persistent conversation history stored in SQLite
  - Native OpenAI function calling with 10 tools
  - Human-in-the-loop (HITL) approval cards for `write_source_file` and `git_commit_and_push`
  - Quick-prompt buttons, clear button
- **Skills registry tab** — manage tools available to agents and ARIA
  - View all built-in skills with status
  - Register MCP HTTP servers (generic adapter for any MCP-compatible tool server)
  - Register web search skills
  - Toggle on/off, test, delete
- **Task file viewer** — FILES toggle in task detail panel
  - Lists workspace output files for any task
  - VIEW (in new tab) and download (↓) buttons
  - Correct path resolution (taskId-prefixed)
- **Git integration** — project root mounted at `/git-root` in container
  - `git` installed in Alpine container
  - ARIA can read/write source files and run git operations
- **OpenAI provider in OpenClaw** — GPT-4o-mini configured as primary model
  - Fallback chain: local GPU → OpenRouter free models

### Fixed
- `crypto.randomUUID()` replaced with HTTP-safe `uid()` polyfill (was failing on non-HTTPS origins)
- Agent loop now rejects immediate `TASK_COMPLETE` without tool use — forces model to actually write files
- File download paths in task detail corrected (were missing taskId prefix)
- OpenClaw config updated with `openai/gpt-4o-mini` as primary agent model
- DB updated for both agents to reflect new model

---

## [0.2.0] — 2026-04-05

### Added
- **Agentic loop** — multi-step ReAct execution (up to 12 steps, 90s timeout per step)
  - Tools: `web_search`, `fetch_url`, `run_python`, `write_file`, `read_file`, `remember`, `recall`, `list_files`, `spawn_task`
  - Text-based `TOOL: name\nparam: value` format (works with any instruction-following model)
  - Live step streaming via SSE → task detail reasoning log
  - Nudge on missing tool call or completion
  - Verification pass (`VERIFY_PASS/VERIFY_FAIL`) — implemented but not wired
- **Persistent agent memory** — `remember`/`recall` tools backed by SQLite
- **Task workspace** — per-task file storage at `/app/workspace/{taskId}/`
- **Task steps API** — `GET /api/tasks/steps?taskId=`
- **Files API** — `GET /api/files`, `GET /api/files/download`
- **SSE `task_step` events** — real-time reasoning log in UI
- `session_end:{sessionKey}` EventEmitter event on GatewayClient for awaitable responses
- `step_count` and `current_tool` columns on `tasks` table

### Fixed
- Stale build served from Docker volume — force-rebuild via BUILD_ID deletion
- Gateway double-resolve guard for `session_end` + legacy chat events

---

## [0.1.0] — 2026-04-04

### Added
- Initial Mission Control dashboard
- Fallout Shelter-style station layout (deck plan with rooms)
- Mobile responsive layout — bottom nav, slide-up sheets
- Task management — create, dispatch, delete, status changes
- Agent management — create, assign to rooms, model configuration
- Real-time SSE event stream — task updates, agent status, activity log
- Gateway WebSocket client with device identity signing
- OpenClaw integration — send tasks to agents via `chat.send` RPC
- Model fallover chain — local GPU → OpenRouter free models
- Scotland local time (Europe/London timezone)
- Activity log with live feed
- Comms tab — send messages to orchestrator agent
- Settings panel — gateway status, workspace info
