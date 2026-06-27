// ARIA Chat — OpenAI streaming with HITL tool approval
import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { run, queryAll, queryOne, logActivity } from '@/lib/db'
import { v4 as uuid } from 'uuid'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const GIT_ROOT = process.env.GIT_ROOT || '/git-root'

// ── Tool schemas for OpenAI function calling ──────────────────
const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  { type: 'function', function: { name: 'list_tasks', description: 'List current tasks with status', parameters: { type: 'object', properties: { status: { type: 'string', enum: ['all', 'backlog', 'active', 'done', 'failed'] } } } } },
  { type: 'function', function: { name: 'list_agents', description: 'List all agents', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'create_task', description: 'Create a new task and optionally dispatch it', parameters: { type: 'object', required: ['title'], properties: { title: { type: 'string' }, description: { type: 'string' }, priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }, agent_id: { type: 'string' }, dispatch: { type: 'boolean' } } } } },
  { type: 'function', function: { name: 'read_source_file', description: 'Read a file from the Mission Control source code', parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string', description: 'Relative path from project root (e.g. app/src/lib/db.ts)' } } } } },
  { type: 'function', function: { name: 'list_source_files', description: 'List files in the source code', parameters: { type: 'object', properties: { dir: { type: 'string', description: 'Subdirectory, e.g. app/src/components' } } } } },
  { type: 'function', function: { name: 'write_source_file', description: '[REQUIRES APPROVAL] Write or update a file in the source code', parameters: { type: 'object', required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' }, reason: { type: 'string' } } } } },
  { type: 'function', function: { name: 'git_status', description: 'Show git status of the codebase', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'git_diff', description: 'Show uncommitted changes', parameters: { type: 'object', properties: { staged: { type: 'boolean' } } } } },
  { type: 'function', function: { name: 'git_log', description: 'Show recent commits', parameters: { type: 'object', properties: { n: { type: 'number' } } } } },
  { type: 'function', function: { name: 'git_commit_and_push', description: '[REQUIRES APPROVAL] Stage all changes, commit, and push to GitHub', parameters: { type: 'object', required: ['message'], properties: { message: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } } } } },
  { type: 'function', function: { name: 'web_search', description: 'Search the web', parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } } } },
]

const HITL_TOOLS = new Set(['write_source_file', 'git_commit_and_push'])

// ── Tool execution ────────────────────────────────────────────
async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'list_tasks': {
      const status = args.status as string | undefined
      const where = !status || status === 'all' ? '' : `WHERE status='${status}'`
      const rows = queryAll<{ title: string; status: string; priority: string; agent_id: string; result: string }>(
        `SELECT title, status, priority, agent_id, result FROM tasks ${where} ORDER BY updated_at DESC LIMIT 20`
      )
      if (!rows.length) return 'No tasks found.'
      return rows.map(t => `[${t.status.toUpperCase()}] ${t.title} (${t.priority})${t.result ? ' — ' + t.result.slice(0, 60) : ''}`).join('\n')
    }
    case 'list_agents': {
      const rows = queryAll<{ name: string; room: string; status: string; model_primary: string; soul: string }>(
        'SELECT name, room, status, model_primary, soul FROM agents'
      )
      return rows.map(a => `${a.name} | room: ${a.room} | ${a.status} | model: ${a.model_primary}${a.soul ? '\n  Soul: ' + a.soul.slice(0, 80) : ''}`).join('\n\n')
    }
    case 'create_task': {
      const id = uuid()
      const { title, description = '', priority = 'medium', agent_id } = args as Record<string, string>
      const assignTo = agent_id || queryOne<{ id: string }>('SELECT id FROM agents ORDER BY created_at ASC LIMIT 1')?.id || null
      run(`INSERT INTO tasks (id, title, description, status, priority, agent_id) VALUES (?, ?, ?, 'backlog', ?, ?)`, [id, title, description, priority, assignTo])
      logActivity('task_created', `Chat: created task "${title}"`, {})
      if (args.dispatch) {
        try {
          const { dispatchTask } = await import('@/lib/dispatch')
          await dispatchTask(id)
          return `Created and dispatched: "${title}"`
        } catch (e) { return `Created "${title}" but dispatch failed: ${String(e)}` }
      }
      return `Created task: "${title}" (id: ${id.slice(0, 8)})`
    }
    case 'read_source_file': {
      const filePath = (args.path as string).replace(/\.\./g, '')
      const safe = path.join(GIT_ROOT, filePath)
      if (!safe.startsWith(GIT_ROOT)) return 'Path not allowed'
      try { return fs.readFileSync(safe, 'utf8').slice(0, 6000) }
      catch { return `File not found: ${filePath}` }
    }
    case 'list_source_files': {
      const dir = path.join(GIT_ROOT, ((args.dir as string) || 'app/src').replace(/\.\./g, ''))
      try {
        function walk(d: string, prefix = ''): string[] {
          return fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
            if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '.next') return []
            const rel = prefix ? `${prefix}/${e.name}` : e.name
            return e.isDirectory() ? walk(path.join(d, e.name), rel) : [rel]
          })
        }
        return walk(dir).join('\n') || '(empty)'
      } catch { return 'Directory not found' }
    }
    case 'git_status': {
      try { return execSync('git status', { cwd: GIT_ROOT, encoding: 'utf8' }) }
      catch (e) { return `git error: ${String(e)}` }
    }
    case 'git_diff': {
      try {
        return execSync(`git diff${args.staged ? ' --staged' : ''}`, { cwd: GIT_ROOT, encoding: 'utf8' }).slice(0, 5000) || '(no changes)'
      } catch (e) { return `git error: ${String(e)}` }
    }
    case 'git_log': {
      try { return execSync(`git log --oneline -${(args.n as number) || 10}`, { cwd: GIT_ROOT, encoding: 'utf8' }) }
      catch (e) { return `git error: ${String(e)}` }
    }
    case 'web_search': {
      try {
        const encoded = encodeURIComponent((args.query as string).slice(0, 200))
        const resp = await fetch(`https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`, { headers: { 'User-Agent': 'OpenClaw/1.0' }, signal: AbortSignal.timeout(8000) })
        const data = await resp.json() as Record<string, unknown>
        const lines: string[] = []
        if (data.AbstractText) lines.push(String(data.AbstractText))
        if (data.Answer) lines.push(`Answer: ${data.Answer}`)
        return lines.join('\n\n') || `No instant answer for: "${args.query}"`
      } catch (e) { return `Search failed: ${String(e)}` }
    }
    default: return `Unknown tool: ${name}`
  }
}

// ── HITL execution (after approval) ──────────────────────────
export async function executeHitlTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'write_source_file': {
      const filePath = (args.path as string).replace(/\.\./g, '')
      const content = args.content as string
      const safe = path.join(GIT_ROOT, filePath)
      if (!safe.startsWith(GIT_ROOT)) return 'Path not allowed'
      const dir = path.dirname(safe)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(safe, content)
      return `Written: ${filePath} (${content.length} bytes)`
    }
    case 'git_commit_and_push': {
      const message = args.message as string
      const files = args.files as string[] | undefined
      try {
        if (files?.length) { for (const f of files) execSync(`git add "${f}"`, { cwd: GIT_ROOT }) }
        else execSync('git add -A', { cwd: GIT_ROOT })
        execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: GIT_ROOT })
        const pushOut = execSync('git push', { cwd: GIT_ROOT, encoding: 'utf8' })
        return `Committed and pushed: "${message}"\n${pushOut}`
      } catch (e: unknown) {
        const err = e as { stderr?: string; message?: string }
        return `Git error: ${err.stderr ?? err.message ?? String(e)}`
      }
    }
    default: return `Unknown HITL tool: ${name}`
  }
}

// ── System prompt ─────────────────────────────────────────────
function buildSystemPrompt(): string {
  const tasks = queryAll<{ title: string; status: string }>(`SELECT title, status FROM tasks ORDER BY updated_at DESC LIMIT 10`)
  const agents = queryAll<{ name: string; status: string; model_primary: string }>(`SELECT name, status, model_primary FROM agents`)
  return `You are ARIA, the AI operations officer of Mission Control — an autonomous agent management platform running on OpenClaw.

INFRASTRUCTURE:
- Stack: Next.js + SQLite + OpenClaw gateway (WebSocket at port 18789)
- Source code: mounted at /git-root (github.com/gustav0thethird/openclaw-command-deck)
- Agents run agentic loops via OpenClaw, producing files in /app/workspace/{taskId}/
- Models: OpenAI gpt-4o-mini (primary), local GPU, OpenRouter fallbacks

CURRENT STATE:
Agents: ${agents.map(a => `${a.name} (${a.status}, ${a.model_primary})`).join(' | ') || 'none'}
Recent tasks: ${tasks.map(t => `[${t.status}] ${t.title}`).join(' | ') || 'none'}

CAPABILITIES:
- Read/write source code, run git operations (write/push require approval)
- Create and dispatch tasks to agents
- Answer questions about the codebase and infrastructure
- Search the web

STYLE: Precise and space-themed. When making code changes, always explain what you're changing and why before requesting approval.`
}

// ── Message persistence ───────────────────────────────────────
type OAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam

function loadHistory(): OAIMessage[] {
  const rows = queryAll<{ role: string; content: string | null; tool_calls: string | null; tool_call_id: string | null; name: string | null }>(
    `SELECT role, content, tool_calls, tool_call_id, name FROM chat_messages ORDER BY created_at ASC LIMIT 50`
  )
  const raw = rows.map(r => {
    if (r.role === 'tool') return { role: 'tool' as const, content: r.content ?? '', tool_call_id: r.tool_call_id ?? '' }
    if (r.role === 'assistant' && r.tool_calls) return { role: 'assistant' as const, content: r.content ?? null, tool_calls: JSON.parse(r.tool_calls) as OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] }
    return { role: r.role as 'user' | 'assistant', content: r.content ?? '' }
  })

  // Repair: ensure every assistant tool_call has a matching tool result.
  // Dangling tool calls (e.g. from interrupted HITL) corrupt all future API calls.
  const repaired: OAIMessage[] = []
  for (let i = 0; i < raw.length; i++) {
    const msg = raw[i]
    repaired.push(msg)
    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      const respondedIds = new Set<string>()
      for (let j = i + 1; j < raw.length; j++) {
        const next = raw[j]
        if (next.role !== 'tool') break
        if ('tool_call_id' in next) respondedIds.add(next.tool_call_id)
      }
      for (const tc of msg.tool_calls) {
        if (!respondedIds.has(tc.id)) {
          repaired.push({ role: 'tool', tool_call_id: tc.id, content: '[Action was interrupted — no result available]' })
        }
      }
    }
  }
  return repaired
}

function saveMsg(role: string, content: string | null, extra: { toolCalls?: unknown; toolCallId?: string; name?: string } = {}) {
  run(`INSERT INTO chat_messages (id, role, content, tool_calls, tool_call_id, name) VALUES (?,?,?,?,?,?)`,
    [uuid(), role, content, extra.toolCalls ? JSON.stringify(extra.toolCalls) : null, extra.toolCallId ?? null, extra.name ?? null])
}

// ── GET: history ──────────────────────────────────────────────
export async function GET() {
  const rows = queryAll<{ id: string; role: string; content: string | null; tool_calls: string | null; created_at: number }>(
    `SELECT id, role, content, tool_calls, created_at FROM chat_messages ORDER BY created_at ASC LIMIT 100`
  )
  return NextResponse.json(rows)
}

// ── POST: send message ────────────────────────────────────────
export async function POST(req: Request) {
  const body = await req.json() as { message?: string; clear?: boolean }
  if (body.clear) { run('DELETE FROM chat_messages'); run('DELETE FROM pending_approvals'); return NextResponse.json({ ok: true }) }

  const userMsg = body.message?.trim()
  if (!userMsg) return NextResponse.json({ error: 'message required' }, { status: 400 })
  saveMsg('user', userMsg)

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (d: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(d)}\n\n`))
      try {
        const messages: OAIMessage[] = [{ role: 'system', content: buildSystemPrompt() }, ...loadHistory()]
        let keepGoing = true
        while (keepGoing) {
          const completion = await openai.chat.completions.create({ model: 'gpt-4o-mini', messages, tools: TOOLS, tool_choice: 'auto', stream: true })
          let text = ''
          const tcMap = new Map<number, { id: string; name: string; args: string }>()
          for await (const chunk of completion) {
            const delta = chunk.choices[0]?.delta
            if (!delta) continue
            if (delta.content) { text += delta.content; send({ type: 'text', content: delta.content }) }
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (!tcMap.has(tc.index)) tcMap.set(tc.index, { id: '', name: '', args: '' })
                const e = tcMap.get(tc.index)!
                if (tc.id) e.id = tc.id
                if (tc.function?.name) e.name = tc.function.name
                if (tc.function?.arguments) e.args += tc.function.arguments
              }
            }
          }
          const toolCalls = [...tcMap.values()]
          if (toolCalls.length === 0) {
            saveMsg('assistant', text)
            keepGoing = false
          } else {
            const fmtCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = toolCalls.map(tc => ({ id: tc.id, type: 'function' as const, function: { name: tc.name, arguments: tc.args } }))
            saveMsg('assistant', text || null, { toolCalls: fmtCalls })
            messages.push({ role: 'assistant', content: text || null, tool_calls: fmtCalls })
            let hitlPaused = false
            for (const tc of toolCalls) {
              let args: Record<string, unknown> = {}
              try { args = JSON.parse(tc.args) } catch {}
              if (HITL_TOOLS.has(tc.name)) {
                const approvalId = uuid()
                run(`INSERT INTO pending_approvals (id, action_type, action_data) VALUES (?,?,?)`,
                  [approvalId, tc.name, JSON.stringify({ name: tc.name, args, toolCallId: tc.id })])
                const preview = tc.name === 'write_source_file'
                  ? `File: ${args.path}\nSize: ${(args.content as string)?.length ?? 0} bytes${args.reason ? '\nReason: ' + args.reason : ''}`
                  : `Commit: "${args.message}"\n${(args.files as string[] | undefined)?.length ? 'Files: ' + (args.files as string[]).join(', ') : 'Staging: all changes'}`
                send({ type: 'approval_required', id: approvalId, tool: tc.name, toolCallId: tc.id, preview })
                const placeholder = `[AWAITING_APPROVAL:${approvalId}]`
                saveMsg('tool', placeholder, { toolCallId: tc.id, name: tc.name })
                messages.push({ role: 'tool', tool_call_id: tc.id, content: placeholder })
                hitlPaused = true
              } else {
                send({ type: 'tool_call', name: tc.name, args })
                let result: string
                try { result = await executeTool(tc.name, args) }
                catch (e) { result = `Error: ${String(e)}` }
                send({ type: 'tool_result', name: tc.name, ok: !result.startsWith('Error'), content: result.slice(0, 600) })
                saveMsg('tool', result, { toolCallId: tc.id, name: tc.name })
                messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
              }
            }
            if (hitlPaused) keepGoing = false
          }
        }
        send({ type: 'done' })
      } catch (e) {
        console.error('[Chat]', e)
        send({ type: 'error', message: String(e) })
      }
      controller.close()
    }
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } })
}
