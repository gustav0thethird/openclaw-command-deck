// Task dispatch — agentic loop with tool use + failover
import { getGateway } from './gateway'
import { queryOne, queryAll, run, logActivity } from './db'
import { broadcast } from './events'
import { v4 as uuid } from 'uuid'
import { runAgentLoop, runVerification } from './agent-loop'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import OpenAI from 'openai'

const WORKSPACE = process.env.WORKSPACE_PATH || '/app/workspace'

interface Agent {
  id: string; name: string; openclaw_id: string
  model_primary: string; model_fallbacks: string; status: string; soul: string; type?: string
}
interface Task {
  id: string; title: string; description: string
  status: string; agent_id: string | null; session_id: string | null
  attempt: number; depth?: number; epic_id?: string | null
  success_criteria?: string | null; confidence?: number | null; critique?: string | null
}

const MAX_CONCURRENT = 5

export async function dispatchTask(taskId: string): Promise<void> {
  const activeCount = (queryOne<{ n: number }>(`SELECT COUNT(*) as n FROM tasks WHERE status='active'`)?.n ?? 0)
  if (activeCount >= MAX_CONCURRENT) {
    console.log(`[Dispatch] Concurrency cap hit (${activeCount}/${MAX_CONCURRENT}) — task ${taskId} will stay in backlog`)
    return
  }

  const task = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [taskId])
  if (!task) throw new Error(`Task not found: ${taskId}`)

  const agentId = task.agent_id || 'agent-main'
  const agent = queryOne<Agent>('SELECT * FROM agents WHERE id = ?', [agentId])
  if (!agent) throw new Error(`Agent not found: ${agentId}`)

  const fallbacks: string[] = (() => { try { return JSON.parse(agent.model_fallbacks) } catch { return [] } })()
  const modelChain = [agent.model_primary, ...fallbacks]

  const sessionId = `mc-${taskId.slice(0, 8)}-${Date.now()}`
  const sessionKey = `agent:${agent.openclaw_id}:${sessionId}`

  run(`UPDATE tasks SET status='active', session_id=?, attempt=attempt+1, error=NULL, step_count=0, current_tool=NULL, updated_at=unixepoch()*1000 WHERE id=?`, [sessionId, taskId])
  run(`UPDATE agents SET status='busy' WHERE id=?`, [agentId])
  logActivity('task_dispatched', `Task dispatched to ${agent.name}: ${task.title}`, { taskId, agentId })
  broadcast('task_update', { id: taskId, status: 'active', sessionKey })
  broadcast('agent_update', { id: agentId, status: 'busy' })

  let lastError: Error | null = null
  for (const model of modelChain) {
    try {
      run(`INSERT INTO dispatch_log (id,task_id,agent_id,model,attempt,status) VALUES (?,?,?,?,?,?)`,
        [uuid(), taskId, agentId, model, task.attempt + 1, 'sent'])
      if (model !== agent.model_primary) {
        console.log(`[Dispatch] Failover to: ${model}`)
        broadcast('task_update', { id: taskId, info: `Failover → ${model}` })
      }

      const result = await runAgentLoop(
        {
          id: task.id,
          title: task.title,
          description: task.description,
          attempt: task.attempt,
          depth: task.depth ?? 0,
          success_criteria: task.success_criteria ?? undefined,
          epic_id: task.epic_id ?? undefined,
        },
        { ...agent, type: agent.type ?? 'general' },
        sessionKey,
      )

      // ─── BLOCKED ──────────────────────────────────────────────
      if (result.status === 'blocked') {
        const question = result.summary
        run(`UPDATE tasks SET status='blocked', blocked_reason=?, current_tool=NULL, updated_at=unixepoch()*1000 WHERE id=?`,
          [question, taskId])
        run(`UPDATE agents SET status='idle' WHERE id=?`, [agentId])
        logActivity('task_blocked', `Task blocked: ${question}`, { taskId, agentId })
        broadcast('task_update', { id: taskId, status: 'blocked', blocked_reason: question })
        broadcast('agent_update', { id: agentId, status: 'idle' })
        return
      }

      // ─── FAILED ───────────────────────────────────────────────
      if (result.status === 'failed') {
        run(`UPDATE tasks SET status='failed', error=?, current_tool=NULL, updated_at=unixepoch()*1000 WHERE id=?`, [result.summary, taskId])
        run(`UPDATE agents SET status='idle' WHERE id=?`, [agentId])
        logActivity('task_failed', `Task failed: ${result.summary}`, { taskId, agentId })
        broadcast('task_update', { id: taskId, status: 'failed', error: result.summary })
        broadcast('agent_update', { id: agentId, status: 'idle' })
        onEpicTaskFinished(taskId, agentId).catch(() => {})
        return
      }

      // ─── DONE — run verification ───────────────────────────────
      if (result.status === 'done') {
        // Store confidence if provided
        if (result.confidence !== undefined) {
          run(`UPDATE tasks SET confidence=? WHERE id=?`, [result.confidence, taskId])
        }

        // Mark as reviewing
        run(`UPDATE tasks SET status='reviewing', updated_at=unixepoch()*1000 WHERE id=?`, [taskId])
        broadcast('task_update', { id: taskId, status: 'reviewing' })

        const verification = await runVerification(
          {
            id: task.id,
            title: task.title,
            description: task.description,
            attempt: task.attempt,
            success_criteria: task.success_criteria ?? undefined,
          },
          agent,
          sessionKey,
          result.summary,
        )

        if (verification.verdict === 'fail' && (task.attempt + 1) <= 1) {
          // First failure — inject critique and re-dispatch once
          const critiqueNote = `\n\n[RETRY — previous attempt failed review]\nCritique: ${verification.reason}\nOriginal task: ${task.description}`
          run(
            `UPDATE tasks SET status='backlog', attempt=attempt+1, critique=?, description=?, updated_at=unixepoch()*1000 WHERE id=?`,
            [verification.reason, task.description + critiqueNote, taskId]
          )
          run(`UPDATE agents SET status='idle' WHERE id=?`, [agentId])
          logActivity('task_retry', `Task failed review, retrying: ${verification.reason.slice(0, 100)}`, { taskId, agentId })
          broadcast('task_update', { id: taskId, status: 'backlog', info: 'Retrying after failed review' })
          broadcast('agent_update', { id: agentId, status: 'idle' })
          // Re-dispatch immediately
          dispatchTask(taskId).catch(() => {})
          return
        }

        // Passed review (or max retries hit) — mark done
        run(`UPDATE tasks SET status='done', result=?, critique=?, current_tool=NULL, updated_at=unixepoch()*1000 WHERE id=?`,
          [result.summary, verification.reason, taskId])
        run(`UPDATE dispatch_log SET status='complete', keyword='TASK_COMPLETE' WHERE task_id=? AND status='sent'`, [taskId])
        run(`UPDATE agents SET status='idle' WHERE id=?`, [agentId])
        logActivity('task_complete', `Task completed: ${result.summary}`, { taskId, agentId })
        broadcast('task_update', { id: taskId, status: 'done', result: result.summary })
        broadcast('agent_update', { id: agentId, status: 'idle' })

        // Async: store insights into knowledge base
        storeTaskInsights(taskId, agentId, result.summary).catch(() => {})

        onEpicTaskFinished(taskId, agentId).catch(() => {})
      }

      return
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      const isRateLimit = /rate|429|limit/i.test(lastError.message)
      console.warn(`[Dispatch] Model ${model} failed: ${lastError.message}`)
      broadcast('task_update', { id: taskId, info: `${model}: ${isRateLimit ? 'rate limit' : lastError.message}` })
      if (isRateLimit && model === modelChain[modelChain.length - 1]) {
        broadcast('task_update', { id: taskId, info: 'Rate limited — retrying in 60s' })
        await sleep(60000)
        return dispatchTask(taskId)
      }
    }
  }

  run(`UPDATE tasks SET status='failed', error=?, current_tool=NULL, updated_at=unixepoch()*1000 WHERE id=?`, [lastError?.message ?? 'Unknown', taskId])
  run(`UPDATE agents SET status='idle' WHERE id=?`, [agentId])
  logActivity('task_failed', `Task failed: ${lastError?.message}`, { taskId, agentId })
  broadcast('task_update', { id: taskId, status: 'failed', error: lastError?.message })
  broadcast('agent_update', { id: agentId, status: 'idle' })
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

// ─── List files in a task workspace recursively ───────────────
function listWorkspaceFiles(taskId: string): string[] {
  const dir = path.join(WORKSPACE, taskId)
  if (!fs.existsSync(dir)) return []
  function walk(d: string, prefix = ''): string[] {
    return fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
      if (e.name.startsWith('_')) return []
      return e.isDirectory()
        ? walk(path.join(d, e.name), `${prefix}${e.name}/`)
        : [`${prefix}${e.name}`]
    })
  }
  try { return walk(dir) } catch { return [] }
}

// ─── Called when any epic task finishes ───────────────────────
async function onEpicTaskFinished(completedTaskId: string, agentId: string) {
  const task = queryOne<{ epic_id: string; title: string; id: string }>(
    `SELECT epic_id, title, id FROM tasks WHERE id=?`, [completedTaskId]
  )
  if (!task?.epic_id || task.title.startsWith('[Package]')) return

  const epicId = task.epic_id

  // Find the next queued task in this epic (sequential execution)
  const nextTask = queryOne<{ id: string; title: string; description: string }>(
    `SELECT id, title, description FROM tasks WHERE epic_id=? AND status='backlog' AND title NOT LIKE '[Package]%' ORDER BY created_at ASC LIMIT 1`,
    [epicId]
  )

  if (nextTask) {
    // Sequential context injection: pass files + result summary to next task
    const files = listWorkspaceFiles(completedTaskId)
    const prevResult = queryOne<{ result: string | null }>(`SELECT result FROM tasks WHERE id=?`, [completedTaskId])
    const resultNote = prevResult?.result ? `\nSummary: ${prevResult.result.slice(0, 400)}` : ''
    const fileSection = files.length > 0
      ? `\nFiles available in /app/workspace/${completedTaskId}/: ${files.join(', ')}\nUse read_file with paths like "${completedTaskId}/filename.ext" to access them.`
      : ''
    const contextBlock = `[Context from previous task: ${task.title}]${resultNote}${fileSection}\n---\n`
    const updatedDescription = contextBlock + (nextTask.description ?? '')
    run(`UPDATE tasks SET description=?, updated_at=unixepoch()*1000 WHERE id=?`, [updatedDescription, nextTask.id])
    dispatchTask(nextTask.id).catch(() => {})
    return
  }

  // No more queued tasks — check for packaging
  checkEpicComplete(epicId, agentId).catch(() => {})
}

async function checkEpicComplete(epicId: string, agentId: string) {
  // Are all non-package tasks for this epic finished?
  const pending = queryOne<{ n: number }>(
    `SELECT COUNT(*) as n FROM tasks WHERE epic_id=? AND title NOT LIKE '[Package]%' AND status NOT IN ('done','failed','cancelled')`,
    [epicId]
  )
  if ((pending?.n ?? 0) > 0) return

  // Already have a package task?
  const existing = queryOne<{ id: string }>(
    `SELECT id FROM tasks WHERE epic_id=? AND title LIKE '[Package]%' LIMIT 1`, [epicId]
  )
  if (existing) return

  const epic = queryOne<{ id: string; title: string }>(`SELECT id, title FROM epics WHERE id=?`, [epicId])
  if (!epic) return

  const epicTasks = queryAll<{ id: string }>(
    `SELECT id FROM tasks WHERE epic_id=? AND title NOT LIKE '[Package]%'`, [epicId]
  )

  const safeName = epic.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const newTaskId = uuid()
  const taskDir = path.join(WORKSPACE, newTaskId)
  const zipPath = path.join(taskDir, `${safeName}-output.zip`)
  const taskDirs = epicTasks.map(t => path.join(WORKSPACE, t.id))

  fs.mkdirSync(taskDir, { recursive: true })
  const scriptPath = path.join(taskDir, '_package.py')
  const script = `import zipfile, os
task_dirs = ${JSON.stringify(taskDirs)}
zip_path = ${JSON.stringify(zipPath)}
added = []
seen = set()

def unique(name):
    if name not in seen:
        seen.add(name)
        return name
    base, ext = os.path.splitext(name)
    i = 2
    while f"{base}_{i}{ext}" in seen:
        i += 1
    out = f"{base}_{i}{ext}"
    seen.add(out)
    return out

with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
    for task_dir in task_dirs:
        if os.path.exists(task_dir):
            for root, dirs, files in os.walk(task_dir):
                dirs[:] = [d for d in dirs if not d.startswith('_') and d not in ('node_modules', '.next', '.git', '__pycache__', 'venv')]
                for fname in files:
                    if not fname.endswith('.zip') and not fname.startswith('_'):
                        full = os.path.join(root, fname)
                        arcname = unique(fname)
                        zf.write(full, arcname)
                        added.append(arcname)
print(len(added))
`

  let fileCount = 0
  let zipError: string | null = null
  try {
    fs.writeFileSync(scriptPath, script)
    const out = execSync(`python3 "${scriptPath}"`, { timeout: 30000, encoding: 'utf8' })
    fileCount = parseInt(out.trim()) || 0
  } catch (err) {
    zipError = String(err)
    console.error('[Package] Zip failed:', zipError)
  } finally {
    try { fs.unlinkSync(scriptPath) } catch {}
  }

  const result = zipError
    ? `Package failed: ${zipError.slice(0, 200)}`
    : `Packaged ${fileCount} files into ${safeName}-output.zip`
  const taskStatus = zipError ? 'failed' : 'done'

  run(
    `INSERT INTO tasks (id,title,description,status,priority,agent_id,epic_id,depth,result) VALUES (?,?,?,?,?,?,?,0,?)`,
    [newTaskId, `[Package] ${epic.title}`, 'Auto-generated package task', taskStatus, 'low', agentId, epicId, result]
  )

  run(`UPDATE epics SET status='done', updated_at=unixepoch()*1000 WHERE id=?`, [epicId])

  broadcast('task_update', { id: newTaskId, title: `[Package] ${epic.title}`, status: taskStatus, result, epic_id: epicId })
  broadcast('epic_update', { id: epicId, status: 'done' })
  logActivity('task_complete', result, { taskId: newTaskId, agentId })
  console.log(`[Package] ${result}`)
}

// ─── Store task insights into knowledge base ──────────────────
async function storeTaskInsights(taskId: string, agentId: string, summary: string): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return

  const task = queryOne<{ title: string; description: string; success_criteria?: string }>(
    `SELECT title, description, success_criteria FROM tasks WHERE id=?`, [taskId]
  )
  if (!task) return

  try {
    const openai = new OpenAI({ apiKey })
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `Task: ${task.title}\nDescription: ${task.description ?? ''}\nResult: ${summary}\n\nExtract 1-3 concise, reusable insights or facts from this completed task. Each insight should be useful for future similar tasks. Format as a JSON array of objects: [{"key": "short label", "insight": "the fact or lesson"}]`,
      }],
      max_tokens: 400,
    })

    const content = res.choices[0].message.content ?? ''
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return

    const insights = JSON.parse(jsonMatch[0]) as Array<{ key: string; insight: string }>
    for (const item of insights) {
      if (!item.key || !item.insight) continue
      const existingKnowledge = queryOne<{ id: string }>(
        `SELECT id FROM knowledge WHERE key=? AND scope='global'`, [item.key]
      )
      if (existingKnowledge) {
        run(`UPDATE knowledge SET content=?, source_agent_id=?, updated_at=unixepoch()*1000 WHERE id=?`,
          [item.insight, agentId, existingKnowledge.id])
      } else {
        run(`INSERT INTO knowledge (id, key, content, scope, source_agent_id, tags) VALUES (?,?,?,?,?,?)`,
          [uuid(), item.key, item.insight, 'global', agentId, JSON.stringify(['auto-insight'])])
      }
    }
    logActivity('knowledge_stored', `Stored ${insights.length} insight(s) from task: ${task.title}`, { taskId, agentId })
  } catch (err) {
    console.warn(`[storeTaskInsights] Failed for task ${taskId}:`, err)
  }
}
