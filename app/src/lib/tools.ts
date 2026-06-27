// Tool registry — skills agents can invoke during the agentic loop
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { run, queryAll, queryOne } from './db'
import { v4 as uuid } from 'uuid'

const WORKSPACE = process.env.WORKSPACE_PATH || '/app/workspace'

// When a task belongs to an epic, all tasks share one workspace (epic-{epicId}/)
// This lets MERCHANT write product_brief.txt and ARTIST read it without UUID paths
function workDir(taskId: string, epicId?: string): string {
  return epicId ? path.join(WORKSPACE, `epic-${epicId}`) : path.join(WORKSPACE, taskId)
}

// Models sometimes emit literal \n instead of real newlines in JSON args — fix it
function unescapeContent(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '')
}

export interface ToolResult {
  ok: boolean
  output: string
}

export interface ToolDef {
  name: string
  description: string
  params: string  // plain text for system prompt
  execute(args: Record<string, string>, context: { taskId: string; agentId: string; depth?: number; epicId?: string }): Promise<ToolResult>
}

// ─── web_search ───────────────────────────────────────────────
const webSearch: ToolDef = {
  name: 'web_search',
  description: 'Search the web and get back a summary of results',
  params: 'query: the search query',
  async execute({ query }) {
    if (!query) return { ok: false, output: 'Missing query' }
    try {
      const encoded = encodeURIComponent(query.slice(0, 200))

      // Try DuckDuckGo instant answers first (fast, structured)
      const resp = await fetch(`https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`, {
        headers: { 'User-Agent': 'OpenClaw-Agent/1.0' },
        signal: AbortSignal.timeout(8000),
      })
      const data = await resp.json() as Record<string, unknown>

      const lines: string[] = []
      if (data.AbstractText) lines.push(String(data.AbstractText))
      if (data.Answer) lines.push(`Answer: ${data.Answer}`)
      if (Array.isArray(data.Results)) {
        const results = (data.Results as Array<Record<string, unknown>>)
          .slice(0, 3).map(r => String(r.Text ?? '')).filter(Boolean)
        if (results.length) lines.push('Results:\n' + results.map(r => `- ${r}`).join('\n'))
      }
      if (Array.isArray(data.RelatedTopics)) {
        const topics = (data.RelatedTopics as Array<Record<string, unknown>>)
          .slice(0, 5).map(t => String(t.Text ?? t.Name ?? '')).filter(Boolean)
        if (topics.length) lines.push('Related:\n' + topics.map(t => `- ${t}`).join('\n'))
      }
      if (lines.length) return { ok: true, output: lines.join('\n\n') }

      // Fallback: scrape DuckDuckGo HTML for actual search snippets
      const htmlResp = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        signal: AbortSignal.timeout(12000),
      })
      const html = await htmlResp.text()

      const snippets: string[] = []
      const titleRe = /class="result__a"[^>]*>([\s\S]*?)<\/a>/g
      const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
      const clean = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim()
      const titles = [...html.matchAll(titleRe)].map(m => clean(m[1])).filter(Boolean).slice(0, 5)
      const snips = [...html.matchAll(snippetRe)].map(m => clean(m[1])).filter(Boolean).slice(0, 5)
      for (let i = 0; i < Math.max(titles.length, snips.length); i++) {
        const t = titles[i] ?? ''
        const s = snips[i] ?? ''
        if (t || s) snippets.push(t ? `${t}: ${s}` : s)
        if (snippets.length >= 5) break
      }

      if (snippets.length) return { ok: true, output: `Search results for "${query}":\n` + snippets.map((s, i) => `${i + 1}. ${s}`).join('\n') }
      return { ok: true, output: `No results found for: "${query}". Use fetch_url to check a specific website instead.` }
    } catch (err) {
      return { ok: false, output: `Search failed: ${String(err)}` }
    }
  },
}

// ─── fetch_url ────────────────────────────────────────────────
const fetchUrl: ToolDef = {
  name: 'fetch_url',
  description: 'Fetch a URL and return its text content',
  params: 'url: the full URL to fetch',
  async execute({ url }) {
    if (!url) return { ok: false, output: 'Missing url' }
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'OpenClaw-Agent/1.0' },
        signal: AbortSignal.timeout(10000),
      })
      const text = await resp.text()
      const stripped = text
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{3,}/g, '\n')
        .trim()
        .slice(0, 3000)
      return { ok: true, output: stripped || '(empty page)' }
    } catch (err) {
      return { ok: false, output: `Fetch failed: ${String(err)}` }
    }
  },
}

// ─── run_python ───────────────────────────────────────────────
const runPython: ToolDef = {
  name: 'run_python',
  description: 'Execute Python 3 code and return stdout/stderr',
  params: 'code: the Python code to run',
  async execute({ code }, { taskId }) {
    if (!code) return { ok: false, output: 'Missing code' }
    const dir = path.join(WORKSPACE, taskId)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `_run_${Date.now()}.py`)
    try {
      fs.writeFileSync(file, unescapeContent(code))
      const out = execSync(`python3 "${file}"`, {
        timeout: 15000,
        encoding: 'utf8',
        cwd: dir,
        env: { ...process.env, HOME: '/tmp' },
      })
      return { ok: true, output: out.slice(0, 2000) || '(no output)' }
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string }
      const out = ((e.stdout ?? '') + '\n' + (e.stderr ?? '')).trim()
      return { ok: false, output: out.slice(0, 1500) || String(e.message) }
    } finally {
      try { fs.unlinkSync(file) } catch {}
    }
  },
}

// ─── read_file ────────────────────────────────────────────────
const readFile: ToolDef = {
  name: 'read_file',
  description: 'Read a file from the task workspace',
  params: 'path: filename (e.g. script.py or product_brief.txt — all tasks in this epic share a workspace)',
  async execute({ path: filePath }, { taskId, epicId }) {
    if (!filePath) return { ok: false, output: 'Missing path' }
    const safe = filePath.replace(/\.\./g, '').replace(/^\//, '')
    const baseDir = workDir(taskId, epicId)
    // First try in the shared/task workspace
    let full = path.join(baseDir, safe)
    // Fall back: cross-task path like "uuid/file.txt" still supported for legacy
    if (!fs.existsSync(full) && safe.includes('/')) {
      full = path.join(WORKSPACE, safe)
    }
    if (!full.startsWith(WORKSPACE)) return { ok: false, output: 'Path not allowed' }
    try {
      const content = fs.readFileSync(full, 'utf8')
      return { ok: true, output: content.slice(0, 4000) }
    } catch {
      return { ok: false, output: `File not found: ${safe}` }
    }
  },
}

// ─── write_file ───────────────────────────────────────────────
const writeFile: ToolDef = {
  name: 'write_file',
  description: 'Write content to a file in the task workspace (creates or overwrites)',
  params: 'path: filename\ncontent: the file content',
  async execute({ path: filePath, content }, { taskId, epicId }) {
    if (!filePath || content == null) return { ok: false, output: 'Missing path or content' }
    const safe = filePath.replace(/\.\./g, '').replace(/^\//, '')
    // Block overwriting image files with empty content (common agent mistake)
    const isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(safe)
    if (isImage && content.length === 0) {
      return { ok: false, output: `Refused: cannot overwrite image file "${safe}" with empty content. Use generate_image to create images.` }
    }
    const dir = workDir(taskId, epicId)
    const full = path.join(dir, safe)
    if (!full.startsWith(WORKSPACE)) return { ok: false, output: 'Path not allowed' }
    try {
      const fileDir = path.dirname(full)
      if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true })
      fs.writeFileSync(full, unescapeContent(content))
      const { broadcast } = require('./events')
      try { broadcast('file_saved', { taskId, path: `${epicId ? 'epic-' + epicId : taskId}/${safe}` }) } catch {}
      return { ok: true, output: `Saved ${safe} (${content.length} bytes)` }
    } catch (err) {
      return { ok: false, output: `Write failed: ${String(err)}` }
    }
  },
}

// ─── remember ─────────────────────────────────────────────────
const remember: ToolDef = {
  name: 'remember',
  description: 'Save something to your persistent memory (survives between tasks)',
  params: 'key: short label for this memory\nvalue: what to remember',
  async execute({ key, value }, { agentId }) {
    if (!key || !value) return { ok: false, output: 'Missing key or value' }
    const existing = queryAll<{ id: string }>(
      'SELECT id FROM memories WHERE agent_id=? AND key=?', [agentId, key]
    )[0]
    if (existing) {
      run('UPDATE memories SET value=?,updated_at=unixepoch()*1000 WHERE id=?', [value, existing.id])
    } else {
      run('INSERT INTO memories (id,agent_id,key,value) VALUES (?,?,?,?)', [uuid(), agentId, key, value])
    }
    return { ok: true, output: `Remembered: "${key}"` }
  },
}

// ─── recall ───────────────────────────────────────────────────
const recall: ToolDef = {
  name: 'recall',
  description: 'Search your persistent memory for relevant information',
  params: 'query: keywords to search for in your memories',
  async execute({ query }, { agentId }) {
    if (!query) return { ok: false, output: 'Missing query' }
    const rows = queryAll<{ key: string; value: string; updated_at: number }>(
      `SELECT key, value, updated_at FROM memories WHERE agent_id=? AND (key LIKE ? OR value LIKE ?) ORDER BY updated_at DESC LIMIT 10`,
      [agentId, `%${query}%`, `%${query}%`]
    )
    if (!rows.length) return { ok: true, output: 'No memories found matching that query.' }
    return {
      ok: true,
      output: rows.map(r => `[${r.key}]: ${r.value}`).join('\n'),
    }
  },
}

// ─── list_files ───────────────────────────────────────────────
const listFiles: ToolDef = {
  name: 'list_files',
  description: 'List files in the task workspace',
  params: '(no params needed)',
  async execute(_args, { taskId, epicId }) {
    const dir = workDir(taskId, epicId)
    if (!fs.existsSync(dir)) return { ok: true, output: 'Workspace is empty' }
    function walk(d: string, prefix = ''): string[] {
      return fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
        if (e.name.startsWith('_run_')) return []
        return e.isDirectory() ? walk(path.join(d, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]
      })
    }
    const files = walk(dir)
    return { ok: true, output: files.length ? files.join('\n') : 'Workspace is empty' }
  },
}

// ─── spawn_task ───────────────────────────────────────────────
const MAX_ACTIVE_TASKS = 5
const MAX_SPAWN_DEPTH = 1

const spawnTask: ToolDef = {
  name: 'spawn_task',
  description: 'Create a subtask. Only use this when the work genuinely needs to be separate. Do not spawn tasks for things you can do yourself.',
  params: 'title: task title\ndescription: what needs to be done\nagent_id: (optional) which agent to assign',
  async execute({ title, description, agent_id }, { taskId, agentId, depth, epicId }) {
    if (!title) return { ok: false, output: 'Missing title' }

    // B3 fix: prevent spawning from within epic tasks
    const taskRow = queryOne<{ epic_id: string | null }>('SELECT epic_id FROM tasks WHERE id=?', [taskId])
    const resolvedEpicId = epicId ?? taskRow?.epic_id ?? null
    if (resolvedEpicId) {
      return { ok: false, output: 'spawn_task is disabled for epic tasks — use sequential task ordering instead.' }
    }

    const currentDepth = (depth as unknown as number) ?? 0
    if (currentDepth >= MAX_SPAWN_DEPTH) {
      return { ok: false, output: `Cannot spawn subtask: maximum task depth (${MAX_SPAWN_DEPTH}) reached. Complete this task directly instead.` }
    }

    const active = queryAll<{ n: number }>(`SELECT COUNT(*) as n FROM tasks WHERE status='active'`)[0]?.n ?? 0
    if (active >= MAX_ACTIVE_TASKS) {
      return { ok: false, output: `Cannot spawn subtask: ${active} tasks already active (max ${MAX_ACTIVE_TASKS}). Complete your current work first.` }
    }

    const id = uuid()
    const assignTo = agent_id || agentId
    const newDepth = currentDepth + 1
    run(
      `INSERT INTO tasks (id,title,description,status,priority,agent_id,depth) VALUES (?,?,?,'backlog','medium',?,?)`,
      [id, title, description ?? '', assignTo, newDepth]
    )
    const { logActivity } = require('./db')
    logActivity('task_created', `Subtask spawned: ${title}`, { taskId, agentId })
    const { broadcast } = require('./events')
    broadcast('task_update', { id, title, description: description ?? '', status: 'backlog', priority: 'medium', agent_id: assignTo, depth: newDepth })
    try {
      const { dispatchTask } = require('./dispatch')
      await dispatchTask(id)
    } catch {}
    return { ok: true, output: `Subtask created: ${title} (id: ${id})` }
  },
}

// ─── create_epic ──────────────────────────────────────────────
const createEpic: ToolDef = {
  name: 'create_epic',
  description: 'Create a high-level epic (goal) and optionally decompose it into tasks',
  params: 'title: epic title\ndescription: what needs to be achieved\ntasks: JSON array of {title,description} objects for subtasks (optional)',
  async execute({ title, description, tasks }, { agentId }) {
    if (!title) return { ok: false, output: 'Missing title' }
    const id = uuid()
    run(`INSERT INTO epics (id,title,description,status,agent_id) VALUES (?,?,?,'active',?)`,
      [id, title, description ?? '', agentId])
    const { broadcast } = require('./events')
    broadcast('epic_update', { id, title, description, status: 'active' })
    let created = 0
    if (tasks) {
      try {
        const list = JSON.parse(tasks) as Array<{ title: string; description?: string }>
        const { dispatchTask } = require('./dispatch')
        for (const t of list) {
          if (!t.title) continue
          const tid = uuid()
          run(`INSERT INTO tasks (id,title,description,status,priority,agent_id,epic_id) VALUES (?,?,?,'backlog','medium',?,?)`,
            [tid, t.title, t.description ?? '', agentId, id])
          broadcast('task_update', { id: tid, title: t.title, status: 'backlog', epic_id: id })
          dispatchTask(tid).catch(() => {})
          created++
        }
      } catch {}
    }
    return { ok: true, output: `Epic created: "${title}" (id: ${id})${created ? `. Spawned ${created} tasks.` : ''}` }
  },
}

// ─── list_epics ───────────────────────────────────────────────
const listEpics: ToolDef = {
  name: 'list_epics',
  description: 'List current epics and their task progress',
  params: '(no params)',
  async execute() {
    const epics = queryAll<{ id: string; title: string; status: string; description: string }>(
      `SELECT id, title, status, description FROM epics ORDER BY created_at DESC LIMIT 20`
    )
    if (!epics.length) return { ok: true, output: 'No epics yet.' }
    const lines = epics.map(e => {
      const tasks = queryAll<{ status: string; n: number }>(
        `SELECT status, COUNT(*) as n FROM tasks WHERE epic_id=? GROUP BY status`, [e.id]
      )
      const total = tasks.reduce((s, r) => s + r.n, 0)
      const done = tasks.find(r => r.status === 'done')?.n ?? 0
      return `[${e.id.slice(0, 8)}] ${e.title} (${e.status}) — ${done}/${total} tasks done`
    })
    return { ok: true, output: lines.join('\n') }
  },
}

// ─── create_agent ─────────────────────────────────────────────
const createAgent: ToolDef = {
  name: 'create_agent',
  description: 'Spawn a new AI agent with a specific role and personality',
  params: 'name: agent name\nsoul: personality and instructions\nroom: room assignment (command/engineering/research/operations/factory/archive/media/comms/treasury)\nmodel: model to use (optional, defaults to gpt-4o-mini)',
  async execute({ name, soul, room, model }) {
    if (!name || !soul) return { ok: false, output: 'Missing name or soul' }
    const id = `agent-${uuid().slice(0, 8)}`
    const validRooms = ['command', 'engineering', 'research', 'operations', 'factory', 'archive', 'media', 'comms', 'treasury']
    const assignedRoom = validRooms.includes(room) ? room : 'engineering'
    run(`INSERT INTO agents (id,name,room,model_primary,soul,status) VALUES (?,?,?,?,?,'idle')`,
      [id, name, assignedRoom, model ?? 'openai/gpt-4o-mini', soul])
    const { broadcast } = require('./events')
    broadcast('agent_update', { id, name, room: assignedRoom, status: 'idle' })
    const { logActivity } = require('./db')
    logActivity('agent_created', `Agent spawned: ${name} assigned to ${assignedRoom}`, { agentId: id })
    return { ok: true, output: `Agent "${name}" created (id: ${id}) in ${assignedRoom}` }
  },
}

// ─── write_knowledge ──────────────────────────────────────────
const writeKnowledge: ToolDef = {
  name: 'write_knowledge',
  description: 'Save a finding or fact to the shared knowledge base (persists across agents and tasks)',
  params: 'key: short label\ncontent: the knowledge content\ntags: comma-separated tags (optional)\nscope: global | agent:<id> | epic:<id> (optional, default global)',
  async execute({ key, content, value, tags, scope }, { agentId }) {
    content = content || value  // allow 'value' as alias for 'content'
    if (!key || !content) return { ok: false, output: 'Missing key or content' }
    const resolvedScope = scope || 'global'
    const tagsJson = JSON.stringify(
      tags ? tags.split(',').map((t: string) => t.trim()).filter(Boolean) : []
    )

    const existing = queryOne<{ id: string }>(
      `SELECT id FROM knowledge WHERE key=? AND scope=?`, [key, resolvedScope]
    )
    if (existing) {
      run(
        `UPDATE knowledge SET content=?, tags=?, source_agent_id=?, updated_at=unixepoch()*1000 WHERE id=?`,
        [content, tagsJson, agentId, existing.id]
      )
    } else {
      run(
        `INSERT INTO knowledge (id, key, content, scope, source_agent_id, tags) VALUES (?,?,?,?,?,?)`,
        [uuid(), key, content, resolvedScope, agentId, tagsJson]
      )
    }
    return { ok: true, output: `Knowledge saved: "${key}" (scope: ${resolvedScope})` }
  },
}

// ─── search_knowledge ─────────────────────────────────────────
const searchKnowledge: ToolDef = {
  name: 'search_knowledge',
  description: 'Search the shared knowledge base for relevant information',
  params: 'query: keywords to search in key and content',
  async execute({ query }) {
    if (!query) return { ok: false, output: 'Missing query' }
    const rows = queryAll<{ key: string; content: string; scope: string; confidence: number; updated_at: number }>(
      `SELECT key, content, scope, confidence, updated_at
       FROM knowledge
       WHERE key LIKE ? OR content LIKE ?
       ORDER BY updated_at DESC
       LIMIT 5`,
      [`%${query}%`, `%${query}%`]
    )
    if (!rows.length) return { ok: true, output: `No knowledge found for: "${query}"` }
    return {
      ok: true,
      output: rows.map(r =>
        `[${r.key}] (scope: ${r.scope}, confidence: ${r.confidence})\n${r.content.slice(0, 500)}`
      ).join('\n\n'),
    }
  },
}

// ─── query_docs ───────────────────────────────────────────────
const queryDocs: ToolDef = {
  name: 'query_docs',
  description: 'Fetch live, up-to-date documentation for a library or framework from context7',
  params: 'library: e.g. "react", "nextjs", "prisma"\ntopic: e.g. "hooks", "routing", "migrations"',
  async execute({ library, topic }) {
    if (!library) return { ok: false, output: 'Missing library' }

    const headers = {
      'User-Agent': 'MissionControl-Agent/1.0',
      'Accept': 'application/json',
    }

    try {
      // Step 1: resolve library ID
      const searchResp = await fetch(
        `https://context7.com/api/v1/search?q=${encodeURIComponent(library)}`,
        { headers, signal: AbortSignal.timeout(10000) }
      )
      if (!searchResp.ok) throw new Error(`Search HTTP ${searchResp.status}`)
      const searchData = await searchResp.json() as { results?: Array<{ id: string; title: string }> }
      const libraryId = searchData.results?.[0]?.id
      if (!libraryId) throw new Error(`No library found for: ${library}`)

      // Step 2: fetch docs
      const topicParam = topic ? `&topic=${encodeURIComponent(topic)}` : ''
      const docsResp = await fetch(
        `https://context7.com/api/v1/${libraryId}?tokens=3000${topicParam}`,
        { headers: { ...headers, Accept: 'text/plain' }, signal: AbortSignal.timeout(15000) }
      )
      if (!docsResp.ok) throw new Error(`Docs HTTP ${docsResp.status}`)
      const docsText = await docsResp.text()
      return { ok: true, output: docsText.slice(0, 3000) || '(empty docs)' }
    } catch (context7Err) {
      // Fallback: search official docs site
      try {
        const fallbackUrl = `https://${library.toLowerCase().replace(/\s+/g, '')}.dev/docs${topic ? `/${topic}` : ''}`
        const fallbackResp = await fetch(fallbackUrl, {
          headers: { 'User-Agent': 'MissionControl-Agent/1.0' },
          signal: AbortSignal.timeout(10000),
        })
        const fallbackText = await fallbackResp.text()
        const stripped = fallbackText
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s{3,}/g, '\n')
          .trim()
          .slice(0, 3000)
        return { ok: true, output: `[Fallback docs for ${library}]\n${stripped}` }
      } catch {
        return { ok: false, output: `query_docs failed: ${String(context7Err)}` }
      }
    }
  },
}

// ─── queue_research ───────────────────────────────────────────
const queueResearch: ToolDef = {
  name: 'queue_research',
  description: "Add a research topic to RAVEN's queue for deep investigation",
  params: 'topic: what to research\nminutes: max time to spend (default 10)',
  async execute({ topic, minutes }, { taskId }) {
    if (!topic) return { ok: false, output: 'Missing topic' }
    const maxMinutes = parseInt(minutes ?? '10', 10) || 10
    const jobId = uuid()
    run(
      `INSERT INTO research_jobs (id, topic, max_minutes, status, requester_task_id, agent_id) VALUES (?,?,?,'pending',?,'agent-raven')`,
      [jobId, topic, maxMinutes, taskId]
    )
    const { broadcast } = require('./events')
    broadcast('research_queued', { id: jobId, topic, max_minutes: maxMinutes })
    return { ok: true, output: `Research job queued (id: ${jobId}). Use get_research with this ID to check results.` }
  },
}

// ─── get_research ─────────────────────────────────────────────
const getResearch: ToolDef = {
  name: 'get_research',
  description: 'Check the status and result of a queued research job',
  params: 'job_id: the research job ID returned by queue_research',
  async execute({ job_id }) {
    if (!job_id) return { ok: false, output: 'Missing job_id' }
    const job = queryOne<{ id: string; topic: string; status: string; result: string | null; updated_at: number }>(
      `SELECT id, topic, status, result, updated_at FROM research_jobs WHERE id=?`, [job_id]
    )
    if (!job) return { ok: false, output: `Research job not found: ${job_id}` }
    if (job.status !== 'done') {
      return { ok: true, output: `Research job "${job.topic}" is ${job.status}. Check back later.` }
    }
    return { ok: true, output: `Research complete for "${job.topic}":\n${job.result ?? '(no result)'}` }
  },
}

// ─── http_request ─────────────────────────────────────────────
const httpRequest: ToolDef = {
  name: 'http_request',
  description: 'Make an HTTP request (GET, POST, PUT, DELETE, PATCH)',
  params: 'method: GET | POST | PUT | DELETE | PATCH\nurl: full URL\nbody: JSON string (optional, for POST/PUT/PATCH)\nheaders: JSON string of extra headers (optional)',
  async execute({ method, url, body, headers }) {
    if (!method || !url) return { ok: false, output: 'Missing method or url' }
    const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
    const upperMethod = method.toUpperCase()
    if (!validMethods.includes(upperMethod)) {
      return { ok: false, output: `Invalid method "${method}". Use: ${validMethods.join(', ')}` }
    }

    let extraHeaders: Record<string, string> = {}
    if (headers) {
      try { extraHeaders = JSON.parse(headers) } catch { return { ok: false, output: 'Invalid headers JSON' } }
    }

    const reqInit: RequestInit = {
      method: upperMethod,
      headers: { 'User-Agent': 'MissionControl-Agent/1.0', 'Content-Type': 'application/json', ...extraHeaders },
      signal: AbortSignal.timeout(15000),
    }
    if (body && ['POST', 'PUT', 'PATCH'].includes(upperMethod)) {
      reqInit.body = body
    }

    try {
      const resp = await fetch(url, reqInit)
      const text = await resp.text()
      return {
        ok: resp.ok,
        output: `HTTP ${resp.status} ${resp.statusText}\n${text.slice(0, 3000)}`,
      }
    } catch (err) {
      return { ok: false, output: `Request failed: ${String(err)}` }
    }
  },
}

// ─── run_shell ────────────────────────────────────────────────
const SHELL_WHITELIST = [
  'git status', 'git log', 'git diff', 'git show',
  'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'find',
  'npm test', 'npm run', 'npm ls',
  'python3 -m pytest', 'node -e', 'node --version', 'npm --version',
]

const runShell: ToolDef = {
  name: 'run_shell',
  description: 'Run a whitelisted shell command to verify work (read-only and test commands only)',
  params: 'command: shell command to run (must start with a whitelisted prefix)',
  async execute({ command }, { taskId }) {
    if (!command) return { ok: false, output: 'Missing command' }
    const trimmed = command.trim()
    const allowed = SHELL_WHITELIST.some(prefix => trimmed.startsWith(prefix))
    if (!allowed) {
      return {
        ok: false,
        output: `Command not whitelisted. Allowed prefixes: ${SHELL_WHITELIST.join(', ')}`,
      }
    }

    const taskDir = path.join(WORKSPACE, taskId)
    const cwd = fs.existsSync(taskDir) ? taskDir : WORKSPACE

    try {
      const out = execSync(trimmed, {
        timeout: 20000,
        encoding: 'utf8',
        cwd,
        env: { ...process.env, HOME: '/tmp' },
      })
      return { ok: true, output: out.slice(0, 3000) || '(no output)' }
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string }
      const out = ((e.stdout ?? '') + '\n' + (e.stderr ?? '')).trim()
      return { ok: false, output: out.slice(0, 2000) || String(e.message) }
    }
  },
}

// ─── ask_user ─────────────────────────────────────────────────
const askUser: ToolDef = {
  name: 'ask_user',
  description: 'Pause the task and ask the user a question. Use when you genuinely cannot proceed without human input.',
  params: 'question: the question to ask the user',
  async execute({ question }, { taskId }) {
    if (!question) return { ok: false, output: 'Missing question' }
    // Record in DB so the dispatch loop can pick it up
    run(`UPDATE tasks SET blocked_reason=?, updated_at=unixepoch()*1000 WHERE id=?`, [question, taskId])
    // Return special sentinel — agent-loop detects this prefix and sets status='blocked'
    return { ok: true, output: `ASK_USER: ${question}` }
  },
}

// ─── read_vault ───────────────────────────────────────────────
const readVault: ToolDef = {
  name: 'read_vault',
  description: 'Read a file from the Obsidian knowledge vault',
  params: 'path: relative path within the vault (e.g. "Projects/MyProject.md")',
  async execute({ path: vaultPath }) {
    if (!vaultPath) return { ok: false, output: 'Missing path' }
    const vaultRoot = process.env.OBSIDIAN_PATH || '/obsidian'
    const safe = vaultPath.replace(/\.\./g, '').replace(/^\//, '')
    const full = path.join(vaultRoot, safe)
    if (!full.startsWith(vaultRoot)) return { ok: false, output: 'Path not allowed' }
    try {
      const content = fs.readFileSync(full, 'utf8')
      return { ok: true, output: content.slice(0, 4000) }
    } catch {
      return { ok: false, output: `Vault file not found: ${safe}` }
    }
  },
}


// ─── generate_image ───────────────────────────────────────────
const generateImage: ToolDef = {
  name: 'generate_image',
  description: 'Generate an image using the local ComfyUI GPU server (best quality) or Pollinations.AI as fallback. Saves PNG to task workspace.',
  params: 'prompt: detailed description of the image to generate; filename: filename without extension (default: "generated"); negative_prompt: things to avoid in the image (optional, improves quality); use_local: set to "true" to force local GPU, "false" to force Pollinations (default: tries local first)',
  async execute({ prompt, filename, negative_prompt, use_local }, { taskId, epicId }) {
    if (!prompt) return { ok: false, output: 'Missing prompt' }
    const fname = (filename || 'generated').replace(/[^a-z0-9_-]/gi, '_')
    const taskDir = workDir(taskId, epicId)
    fs.mkdirSync(taskDir, { recursive: true })
    const outPath = path.join(taskDir, fname + '.png')
    const negPrompt = negative_prompt || 'white background, plain background, shirt mockup, product photo on mannequin, watermark, blurry, low quality, amateur, text artifacts, distorted text, ugly, bad anatomy'
    const seed = Math.floor(Math.random() * 999999999)

    // Try local ComfyUI first (unless explicitly disabled)
    const tryLocal = use_local !== 'false'
    if (tryLocal) {
      try {
        const comfyUrl = process.env.COMFY_URL ?? 'http://localhost:8188'
        // Simple txt2img workflow for ComfyUI
        const workflow = {
          "1": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "juggernautXL.safetensors" } },
          "2": { "class_type": "CLIPTextEncode", "inputs": { "clip": ["1", 1], "text": prompt } },
          "3": { "class_type": "CLIPTextEncode", "inputs": { "clip": ["1", 1], "text": negPrompt } },
          "4": { "class_type": "EmptyLatentImage", "inputs": { "width": 768, "height": 768, "batch_size": 1 } },
          "5": { "class_type": "KSampler", "inputs": { "model": ["1", 0], "positive": ["2", 0], "negative": ["3", 0], "latent_image": ["4", 0], "seed": seed, "steps": 25, "cfg": 7.5, "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 1.0 } },
          "6": { "class_type": "VAEDecode", "inputs": { "samples": ["5", 0], "vae": ["1", 2] } },
          "7": { "class_type": "ImageScale", "inputs": { "image": ["6", 0], "upscale_method": "lanczos", "width": 1536, "height": 1536, "crop": "disabled" } },
          "8": { "class_type": "SaveImage", "inputs": { "images": ["7", 0], "filename_prefix": fname } }
        }
        const queueRes = await fetch(`${comfyUrl}/prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: workflow, client_id: 'mc-agent' }),
          signal: AbortSignal.timeout(5000),
        })
        if (queueRes.ok) {
          const { prompt_id } = await queueRes.json() as { prompt_id: string }
          // Poll for completion (up to 4 minutes)
          for (let i = 0; i < 120; i++) {
            await new Promise(r => setTimeout(r, 2000))
            const histRes = await fetch(`${comfyUrl}/history/${prompt_id}`, { signal: AbortSignal.timeout(3000) })
            if (!histRes.ok) continue
            const hist = await histRes.json() as Record<string, any>
            const job = hist[prompt_id]
            if (!job) continue
            const outputs = job.outputs
            for (const nodeId of ['8', '7', '6', ...Object.keys(outputs)]) {
              const images = outputs[nodeId]?.images
              if (images?.length > 0) {
                const img = images[0]
                const imgRes = await fetch(`${comfyUrl}/view?filename=${img.filename}&subfolder=${img.subfolder || ''}&type=${img.type || 'output'}`)
                const buf = Buffer.from(await imgRes.arrayBuffer())
                fs.writeFileSync(outPath, buf)
                return { ok: true, output: `Image saved (ComfyUI local GPU): ${fname}.png (${Math.round(buf.length/1024)}KB)`, source: 'comfyui' }
              }
            }
          }
          // ComfyUI timed out — fall through to Pollinations automatically
        }
      } catch (e: any) {
        // ComfyUI not available — fall through to Pollinations
        if (use_local === 'true') return { ok: false, output: `Local GPU unavailable: ${e.message}` }
      }
    }

    // Fallback: Pollinations.AI
    try {
      const params = new URLSearchParams({
        width: '1500', height: '1500', nologo: 'true', enhance: 'true',
        model: 'flux', seed: String(seed), negative_prompt: negPrompt,
      })
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`
      const res = await fetch(url, { signal: AbortSignal.timeout(120000) })
      if (!res.ok) return { ok: false, output: `Pollinations error: ${res.status}` }
      const buf = Buffer.from(await res.arrayBuffer())
      fs.writeFileSync(outPath, buf)
      return { ok: true, output: `Image saved (Pollinations): ${fname}.png (${Math.round(buf.length/1024)}KB)`, source: 'pollinations' }
    } catch (err) {
      return { ok: false, output: String(err) }
    }
  },
}


// ─── view_image ────────────────────────────────────────────────
const viewImage: ToolDef = {
  name: 'view_image',
  description: 'View a previously generated image from the task workspace and describe its quality/suitability for print-on-demand. Returns base64 image data for visual inspection.',
  params: 'filename: path relative to workspace (e.g. "<taskId>/tshirt_design_v1.png")',
  async execute({ filename }, { taskId, epicId }) {
    if (!filename) return { ok: false, output: 'Missing filename' }
    try {
      const baseDir = workDir(taskId, epicId)
      const imgPath = filename.includes('/') ? path.join(WORKSPACE, filename) : path.join(baseDir, filename)
      if (!fs.existsSync(imgPath)) return { ok: false, output: `File not found: ${filename}` }
      const buf = fs.readFileSync(imgPath)
      const base64 = buf.toString('base64')
      const sizeKB = Math.round(buf.length / 1024)
      return { ok: true, output: `Image loaded (${sizeKB}KB). Base64 data (first 100 chars): ${base64.slice(0, 100)}...`, image_base64: base64, mime_type: 'image/png' }
    } catch (err) {
      return { ok: false, output: String(err) }
    }
  },
}

// ─── remove_background ────────────────────────────────────────
const removeBackground: ToolDef = {
  name: 'remove_background',
  description: 'Remove the background from an image using remove.bg API. Returns a PNG with transparent background saved to workspace.',
  params: 'filename: filename in workspace (e.g. "tshirt_design.png"); output_filename: filename without extension for result (default: original name + "_nobg")',
  async execute({ filename, output_filename }, { taskId, epicId }) {
    if (!filename) return { ok: false, output: 'Missing filename' }
    const apiKey = process.env.REMOVE_BG_API_KEY
    if (!apiKey) return { ok: false, output: 'REMOVE_BG_API_KEY not configured' }
    try {
      const baseDir = workDir(taskId, epicId)
      const imgPath = filename.includes('/') ? path.join(WORKSPACE, filename) : path.join(baseDir, filename)
      if (!fs.existsSync(imgPath)) return { ok: false, output: `File not found: ${filename}` }
      const imgBuf = fs.readFileSync(imgPath)
      // Use native FormData (Node 18+)
      const form = new FormData()
      form.set('image_file', new Blob([imgBuf], { type: 'image/png' }), path.basename(imgPath))
      form.set('size', 'auto')
      const res = await fetch('https://api.remove.bg/v1.0/removebg', {
        method: 'POST',
        headers: { 'X-Api-Key': apiKey },
        body: form,
      })
      if (!res.ok) {
        const text = await res.text()
        return { ok: false, output: `remove.bg error (${res.status}): ${text.slice(0, 300)}` }
      }
      const buf = Buffer.from(await res.arrayBuffer())
      const baseName = output_filename || path.basename(imgPath, '.png') + '_nobg'
      fs.mkdirSync(baseDir, { recursive: true })
      const outPath = path.join(baseDir, baseName + '.png')
      fs.writeFileSync(outPath, buf)
      return { ok: true, output: `Background removed. Saved: ${baseName}.png (${Math.round(buf.length / 1024)}KB)` }
    } catch (err) {
      return { ok: false, output: String(err) }
    }
  },
}

// ─── printify helpers ─────────────────────────────────────────
function printifyHeaders() {
  const key = process.env.PRINTIFY_API_KEY
  if (!key) throw new Error('PRINTIFY_API_KEY not configured')
  return { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }
}
function printifyShopId() {
  const id = process.env.PRINTIFY_SHOP_ID
  if (!id) throw new Error('PRINTIFY_SHOP_ID not configured')
  return id
}

// ─── printify_get_shop ────────────────────────────────────────
const printifyGetShop: ToolDef = {
  name: 'printify_get_shop',
  description: 'Get Printify shop info. Call first to verify API key and retrieve shop details.',
  params: 'none',
  async execute() {
    try {
      const res = await fetch('https://api.printify.com/v1/shops.json', { headers: printifyHeaders() })
      const data = await res.json()
      if (!res.ok) return { ok: false, output: JSON.stringify(data) }
      return { ok: true, output: JSON.stringify(data) }
    } catch (err) {
      return { ok: false, output: String(err) }
    }
  },
}

// ─── printify_blueprints ──────────────────────────────────────
const printifyBlueprints: ToolDef = {
  name: 'printify_blueprints',
  description: 'List available Printify product types (t-shirts, mugs, hoodies, etc.) to find the right blueprint_id',
  params: 'none',
  async execute() {
    try {
      const res = await fetch('https://api.printify.com/v1/catalog/blueprints.json', { headers: printifyHeaders() })
      const data = await res.json() as Array<{ id: number; title: string; brand: string; model: string; description: string }>
      if (!res.ok) return { ok: false, output: JSON.stringify(data) }
      const slim = (Array.isArray(data) ? data : []).slice(0, 60).map(b => ({ id: b.id, title: b.title, brand: b.brand, model: b.model }))
      return { ok: true, output: JSON.stringify(slim) }
    } catch (err) {
      return { ok: false, output: String(err) }
    }
  },
}

// ─── printify_upload_image ────────────────────────────────────
const printifyUploadImage: ToolDef = {
  name: 'printify_upload_image',
  description: 'Upload a PNG image from the task workspace to Printify. Returns image_id needed for creating products.',
  params: 'filename: name of the PNG file in the task workspace (e.g. "design.png")',
  async execute({ filename }, { taskId, epicId }) {
    if (!filename) return { ok: false, output: 'Missing filename' }
    try {
      const baseDir = workDir(taskId, epicId)
      // Look in shared workspace first, then legacy cross-task path
      let filePath = path.join(baseDir, filename)
      if (!fs.existsSync(filePath) && filename.includes('/')) {
        filePath = path.join(WORKSPACE, filename)
      }
      if (!fs.existsSync(filePath)) return { ok: false, output: `File not found: ${filename}. Available files: ${fs.existsSync(baseDir) ? fs.readdirSync(baseDir).filter(f => f.endsWith('.png')).join(', ') : 'workspace empty'}` }
      const buf = fs.readFileSync(filePath)
      const b64 = buf.toString('base64')
      const body = JSON.stringify({ file_name: filename, contents: b64 })
      const res = await fetch('https://api.printify.com/v1/uploads/images.json', {
        method: 'POST', headers: printifyHeaders(), body,
      })
      const data = await res.json() as { id?: string; preview_url?: string }
      if (!res.ok) return { ok: false, output: JSON.stringify(data) }
      return { ok: true, output: JSON.stringify({ image_id: data.id, preview_url: data.preview_url }) }
    } catch (err) {
      return { ok: false, output: String(err) }
    }
  },
}

// ─── printify_create_product ──────────────────────────────────
const printifyCreateProduct: ToolDef = {
  name: 'printify_create_product',
  description: 'Create a product on Printify with an uploaded image. Use printify_blueprints to find blueprint_id first.',
  params: 'title: product title; description: product description; blueprint_id: product type ID; print_provider_id: provider ID (use 99 for default); image_id: ID from printify_upload_image; retail_price_cents: price in cents (e.g. 2999); tags: comma-separated tags (optional)',
  async execute({ title, description, blueprint_id, print_provider_id, image_id, retail_price_cents, tags }, { taskId: _taskId }) {
    if (!title || !blueprint_id || !print_provider_id || !image_id || !retail_price_cents)
      return { ok: false, output: 'Missing required params: title, blueprint_id, print_provider_id, image_id, retail_price_cents' }
    // Quick auth check
    try {
      const authCheck = await fetch('https://api.printify.com/v1/shops.json', { headers: printifyHeaders() })
      if (authCheck.status === 401 || authCheck.status === 403) {
        const body = await authCheck.json() as any
        return { ok: false, output: `Printify API authentication failed (${authCheck.status}): ${body.error || 'Invalid or expired API key. Please regenerate the key at printify.com → Account → Connections'}` }
      }
    } catch {}
    try {
      const shopId = printifyShopId()
      const hdrs = printifyHeaders()
      const bpId = Number(blueprint_id)
      const ppId = Number(print_provider_id)
      const price = Number(retail_price_cents)

      // Fetch variants
      const varRes = await fetch(
        `https://api.printify.com/v1/catalog/blueprints/${bpId}/print_providers/${ppId}/variants.json`,
        { headers: hdrs }
      )
      const varData = await varRes.json() as { variants?: Array<{ id: number; is_enabled?: boolean }> }
      // Keep all colors but only standard sizes to avoid Printify variant limits
      // Printify variant titles are like "Color / Size" e.g. "Black / M"
      const STANDARD_SIZES = ['/ XS', '/ S', '/ M', '/ L', '/ XL', '/ 2XL', '/ 3XL']
      const allVariants = (varData.variants ?? []).filter((v) => v.is_enabled !== false)
      const filtered = allVariants.filter((v: any) =>
        STANDARD_SIZES.some(sz => (v.title || '').includes(sz))
      )
      // Printify max is 100 variants — cap at 99 to stay safe
      const variants = (filtered.length > 0 ? filtered : allVariants)
        .slice(0, 99)
        .map((v) => ({ id: v.id, price, is_enabled: true }))

      if (variants.length === 0) return { ok: false, output: 'No variants found for this blueprint/provider combination' }

      const variantIds = variants.map((v) => v.id)
      const body = JSON.stringify({
        title,
        description,
        blueprint_id: bpId,
        print_provider_id: ppId,
        variants,
        print_areas: [{
          variant_ids: variantIds,
          placeholders: [{ position: 'front', images: [{ id: image_id, x: 0.5, y: 0.5, scale: 1, angle: 0 }] }],
        }],
        tags: tags ? tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [],
      })

      const res = await fetch(`https://api.printify.com/v1/shops/${shopId}/products.json`, {
        method: 'POST', headers: hdrs, body,
      })
      const data = await res.json() as { id?: string; title?: string }
      if (!res.ok) return { ok: false, output: JSON.stringify(data) }
      return { ok: true, output: JSON.stringify({ product_id: data.id, title: data.title }) }
    } catch (err) {
      return { ok: false, output: String(err) }
    }
  },
}

// ─── printify_publish_product ─────────────────────────────────
const printifyPublishProduct: ToolDef = {
  name: 'printify_publish_product',
  description: 'Publish a Printify product to the connected store (Pop-Up Store) to make it live and purchasable',
  params: 'product_id: the Printify product ID to publish',
  async execute({ product_id }) {
    if (!product_id) return { ok: false, output: 'Missing product_id' }
    try {
      const shopId = printifyShopId()
      const body = JSON.stringify({ title: true, description: true, images: true, variants: true, tags: true, keyFeatures: true, shipping_template: true })
      const res = await fetch(
        `https://api.printify.com/v1/shops/${shopId}/products/${product_id}/publish.json`,
        { method: 'POST', headers: printifyHeaders(), body }
      )
      if (!res.ok) {
        const text = await res.text()
        return { ok: false, output: `Publish failed (${res.status}): ${text.slice(0, 500)}` }
      }
      return { ok: true, output: `Product ${product_id} published successfully` }
    } catch (err) {
      return { ok: false, output: String(err) }
    }
  },
}

// ─── printify_get_orders ──────────────────────────────────────
const printifyGetOrders: ToolDef = {
  name: 'printify_get_orders',
  description: 'Get recent orders from the Printify shop to track sales and fulfillment',
  params: 'none',
  async execute() {
    try {
      const shopId = printifyShopId()
      const res = await fetch(`https://api.printify.com/v1/shops/${shopId}/orders.json?limit=20`, { headers: printifyHeaders() })
      const data = await res.json()
      if (!res.ok) return { ok: false, output: JSON.stringify(data) }
      return { ok: true, output: JSON.stringify(data) }
    } catch (err) {
      return { ok: false, output: String(err) }
    }
  },
}


// ─── etsy_create_listing ──────────────────────────────────────
const etsyCreateListing: ToolDef = {
  name: 'etsy_create_listing',
  description: 'Create a product listing directly on Etsy. Requires Etsy OAuth to be completed first (/api/etsy/connect).',
  params: 'title: listing title (max 140 chars); description: listing description; price_usd: price in dollars (e.g. "24.99"); tags: comma-separated tags (max 13); image_filename: PNG filename in task workspace to upload as primary image; quantity: stock quantity (default 999)',
  async execute({ title, description, price_usd, tags, image_filename, quantity }, { taskId }) {
    if (!title || !description || !price_usd) return { ok: false, output: 'Missing: title, description, price_usd' }
    const { getConfig } = require('./db')
    const apiKey = process.env.ETSY_API_KEY
    const accessToken = getConfig('etsy_access_token')
    const shopId = getConfig('etsy_shop_id')
    if (!apiKey || !accessToken) return { ok: false, output: `Etsy not connected. Visit ${process.env.MISSION_CONTROL_URL ?? 'http://localhost:4000'}/api/etsy/connect to authorise.` }
    if (!shopId) return { ok: false, output: 'Etsy shop ID not found. Complete OAuth flow first.' }

    const hdrs = { 'x-api-key': apiKey, 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
    try {
      // Create draft listing
      const listingBody = {
        quantity: parseInt(quantity || '999'),
        title,
        description,
        price: parseFloat(price_usd),
        who_made: 'i_did',
        when_made: 'made_to_order',
        taxonomy_id: 1979, // Clothing > Shirts
        tags: tags ? tags.split(',').map((t: string) => t.trim()).filter(Boolean).slice(0, 13) : [],
        type: 'physical',
        shipping_profile_id: null as null,
      }
      const listRes = await fetch(`https://openapi.etsy.com/v3/application/shops/${shopId}/listings`, {
        method: 'POST', headers: hdrs, body: JSON.stringify(listingBody),
      })
      const listing = await listRes.json() as { listing_id?: number; url?: string; error?: string }
      if (!listRes.ok) return { ok: false, output: JSON.stringify(listing) }

      const listingId = listing.listing_id

      // Upload image if provided
      if (image_filename && listingId) {
        try {
          const imgPath = path.join(WORKSPACE, taskId, image_filename)
          if (fs.existsSync(imgPath)) {
            const imgBuf = fs.readFileSync(imgPath)
            const boundary = '----FormBoundary' + Math.random().toString(36).slice(2)
            const parts = [
              `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${image_filename}"\r\nContent-Type: image/png\r\n\r\n`,
              imgBuf,
              `\r\n--${boundary}--\r\n`,
            ]
            const body = Buffer.concat(parts.map(p => typeof p === 'string' ? Buffer.from(p) : p))
            await fetch(`https://openapi.etsy.com/v3/application/shops/${shopId}/listings/${listingId}/images`, {
              method: 'POST',
              headers: { 'x-api-key': apiKey, 'Authorization': `Bearer ${accessToken}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
              body,
            })
          }
        } catch {}
      }

      const listingUrl = `https://www.etsy.com/listing/${listingId}`
      return { ok: true, output: JSON.stringify({ listing_id: listingId, url: listingUrl }) }
    } catch (err) {
      return { ok: false, output: String(err) }
    }
  },
}

// ─── Registry ─────────────────────────────────────────────────
export const TOOLS: ToolDef[] = [
  webSearch, fetchUrl, runPython, readFile, writeFile,
  remember, recall, listFiles, spawnTask, createEpic, listEpics, createAgent,
  writeKnowledge, searchKnowledge, queryDocs, queueResearch, getResearch,
  httpRequest, runShell, askUser, readVault,
  generateImage, viewImage, removeBackground,
  printifyGetShop, printifyBlueprints, printifyUploadImage, printifyCreateProduct, printifyPublishProduct, printifyGetOrders,
  etsyCreateListing,
]

export const TOOL_MAP = new Map(TOOLS.map(t => [t.name, t]))

export function toolSystemPrompt(): string {
  const toolList = TOOLS.map(t =>
    `- ${t.name}: ${t.description}\n  Params: ${t.params}`
  ).join('\n\n')

  return `You are an autonomous agent. You MUST use tools to complete tasks. You cannot describe work — you must do it.

## HOW TO CALL A TOOL

Output this EXACT format, with no other text on the TOOL: line:

TOOL: write_file
path: index.html
content: <!DOCTYPE html>
<html><body><h1>Hello</h1></body></html>

After the tool runs you receive:
TOOL_RESULT: Saved index.html (45 bytes)

Then call the next tool or output TASK_COMPLETE.

## CRITICAL RULES

1. You MUST call at least one tool before TASK_COMPLETE.
2. For ANY task involving creating files, code, or content — call write_file for EVERY file.
3. Never say "I have created..." or "I have written..." — actually CALL write_file.
4. One tool call per response. Wait for TOOL_RESULT before calling the next tool.
5. End with: TASK_COMPLETE: <one-line summary of what was done>

## WRITE_FILE EXAMPLE (correct)

TOOL: write_file
path: app.py
content: def hello():
    print("Hello, world!")

hello()

## WRONG (never do this)

I have created app.py with the following content:
\`\`\`python
def hello():
    print("Hello, world!")
\`\`\`
TASK_COMPLETE: Created app.py

## AVAILABLE TOOLS

${toolList}`
}

// ─── Parser ───────────────────────────────────────────────────
export interface ParsedToolCall {
  name: string
  args: Record<string, string>
}

export function parseToolCall(text: string): ParsedToolCall | null {
  const match = text.match(/TOOL:\s*(\w+)\s*\n([\s\S]*?)(?=\n\nTOOL:|\n\nTASK_COMPLETE|$)/i)
  if (!match) return null

  const name = match[1].trim()
  if (!TOOL_MAP.has(name)) return null

  const args: Record<string, string> = {}
  const paramSection = match[2]
  const lines = paramSection.split('\n')
  let currentKey = ''
  let currentVal: string[] = []

  for (const line of lines) {
    const kv = line.match(/^(\w+):\s*(.*)$/)
    if (kv) {
      if (currentKey) args[currentKey] = currentVal.join('\n').trim()
      currentKey = kv[1]
      currentVal = [kv[2]]
    } else if (currentKey) {
      currentVal.push(line)
    }
  }
  if (currentKey) args[currentKey] = currentVal.join('\n').trim()

  return { name, args }
}
