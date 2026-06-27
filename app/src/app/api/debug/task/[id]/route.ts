// GET /api/debug/task/[id] — full task drill-down
import { NextResponse } from 'next/server'
import { queryAll, queryOne } from '@/lib/db'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const WORKSPACE = process.env.WORKSPACE_PATH || '/app/workspace'
const TEXT_EXTS = new Set(['txt','md','json','js','ts','tsx','jsx','py','html','htm','css','sh','sql','yaml','yml','log','csv','xml','svg','env','toml','ini','cfg'])
const MAX_PREVIEW = 50_000 // chars

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { id } = params

  const task = queryOne<Record<string, unknown>>('SELECT * FROM tasks WHERE id=?', [id])
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const agent = task.agent_id
    ? queryOne('SELECT * FROM agents WHERE id=?', [task.agent_id as string])
    : null

  const steps = queryAll(
    'SELECT * FROM task_steps WHERE task_id=? ORDER BY step ASC, created_at ASC',
    [id]
  )

  const dispatchLog = queryAll(
    'SELECT * FROM dispatch_log WHERE task_id=? ORDER BY created_at ASC',
    [id]
  )

  const activityLog = queryAll(
    'SELECT * FROM activity_log WHERE task_id=? ORDER BY created_at ASC',
    [id]
  )

  // Workspace files with content
  const taskDir = path.join(WORKSPACE, id)
  const workspaceFiles: Array<{
    name: string; path: string; size: number; modified: number
    contentType: string; content?: string; contentBase64?: string; truncated: boolean
  }> = []

  if (fs.existsSync(taskDir)) {
    function walk(dir: string, rel = '') {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('_run_')) continue
        const abs = path.join(dir, e.name)
        const relPath = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) { walk(abs, relPath); continue }
        const stat = fs.statSync(abs)
        const ext = e.name.split('.').pop()?.toLowerCase() ?? ''
        const isText = TEXT_EXTS.has(ext)
        const entry: typeof workspaceFiles[0] = {
          name: e.name,
          path: relPath,
          size: stat.size,
          modified: stat.mtimeMs,
          contentType: isText ? 'text' : 'binary',
          truncated: false,
        }
        if (isText) {
          try {
            const raw = fs.readFileSync(abs, 'utf8')
            entry.content = raw.length > MAX_PREVIEW ? raw.slice(0, MAX_PREVIEW) : raw
            entry.truncated = raw.length > MAX_PREVIEW
          } catch { entry.content = '(read error)' }
        } else {
          try {
            const raw = fs.readFileSync(abs)
            const b64 = raw.toString('base64')
            entry.contentBase64 = b64.length > MAX_PREVIEW ? b64.slice(0, MAX_PREVIEW) : b64
            entry.truncated = b64.length > MAX_PREVIEW
          } catch { entry.contentBase64 = '(read error)' }
        }
        workspaceFiles.push(entry)
      }
    }
    walk(taskDir)
  }

  // Build a summary of message flow for easy reading
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stepSummary = (steps as any[]).map((s: any) => ({
    step: s.step,
    type: s.type,
    preview: String(s.content ?? '').slice(0, 300),
    full_length: String(s.content ?? '').length,
    created_at: s.created_at,
  }))

  return NextResponse.json({
    task,
    agent,
    steps,          // full content
    step_summary: stepSummary,
    dispatch_log: dispatchLog,
    activity_log: activityLog,
    workspace: {
      path: taskDir,
      exists: fs.existsSync(taskDir),
      files: workspaceFiles,
    },
  })
}
