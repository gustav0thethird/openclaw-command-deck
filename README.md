# OpenClaw Command Deck — Mission Control

**Version 0.3.0**

A space-station-themed autonomous agent management dashboard built on top of OpenClaw.

## Features

- **Fallout Shelter-style station layout** — rooms, agents, live task status
- **Agentic task execution** — multi-step ReAct loop with tool use (web search, Python, file I/O, memory, subtask spawning)
- **ARIA chat bubble** — floating AI assistant (GPT-4o-mini) with full codebase access, git operations, and human-in-the-loop approval for critical actions
- **Skills registry** — register MCP HTTP servers and custom tools for agents to use
- **Task file viewer** — browse and download workspace files from any completed task
- **Real-time SSE updates** — live task steps, agent status, activity log
- **OpenAI via OpenClaw** — GPT-4o-mini as primary model, local GPU + OpenRouter as fallbacks

## Stack

- **Frontend**: Next.js 14 (App Router), React, TypeScript
- **Backend**: Next.js API routes, better-sqlite3, OpenClaw WebSocket gateway
- **AI**: OpenAI GPT-4o-mini (primary), local Qwen 2.5, OpenRouter free models (fallback)
- **Infra**: Docker, SQLite, Server-Sent Events

## Quick Start

```bash
cd mission-control
docker compose up -d
# App available at http://localhost:4000
```

## Architecture

```
Browser ──SSE──► /api/events
        ──REST──► /api/tasks, /api/agents, /api/chat, /api/skills
                          │
                    Next.js API Routes
                          │
              ┌───────────┼───────────┐
              │           │           │
           SQLite    OpenClaw GW   OpenAI
              │      (port 18789)  (gpt-4o-mini)
         /app/data    WebSocket
              │
         /app/workspace/{taskId}/  ← agent output files
```

## Agent Loop

Tasks are dispatched to agents via an agentic ReAct loop:

1. Build system prompt (soul + tools + task)
2. Send to OpenClaw → GPT-4o-mini
3. Parse response for `TOOL: <name>` calls
4. Execute tool, feed result back
5. Repeat up to 12 steps
6. Complete on `TASK_COMPLETE: <summary>`

Tools: `web_search`, `fetch_url`, `run_python`, `write_file`, `read_file`, `remember`, `recall`, `list_files`, `spawn_task`

## ARIA Chat

The `◈` bubble (bottom-right) opens a direct chat with ARIA:

- Reads/writes Mission Control source code (`/git-root`)
- Creates and dispatches tasks
- Runs git operations (commit/push require your approval via HITL modal)
- Full conversation history

## Skills

The **SKILLS** tab manages tools available to agents:

- **Built-in**: web search, Python, file I/O, memory
- **MCP HTTP**: connect any MCP-compatible tool server at a URL
- **Web Search**: DuckDuckGo instant answers (no API key required)

## Environment Variables

| Variable | Description |
|---|---|
| `OPENCLAW_GATEWAY_URL` | WebSocket URL for OpenClaw gateway |
| `OPENCLAW_GATEWAY_TOKEN` | Auth token |
| `OPENAI_API_KEY` | OpenAI API key for GPT-4o-mini |
| `WORKSPACE_PATH` | Where agent files are saved (default: `/app/workspace`) |
| `GIT_ROOT` | Mounted project root for ARIA code access (default: `/git-root`) |
| `DATABASE_PATH` | SQLite DB path (default: `/app/data/mc.db`) |
| `MISSION_CONTROL_URL` | Public URL of this app — required for Etsy OAuth (default: `http://localhost:4000`) |
| `LOCAL_GPU_URL` | Base URL for local GPU/LLM server (default: `http://localhost:11435/v1`) |
| `COMFY_URL` | ComfyUI server URL for image generation (default: `http://localhost:8188`) |
| `IDENTITY_PATH` | Host path to OpenClaw identity dir (docker-compose volume) |
| `GIT_ROOT_PATH` | Host path to mount as `/git-root` for ARIA git access |
| `VAULT_PATH` | Host path to Obsidian vault (mounted as `/obsidian`) |
