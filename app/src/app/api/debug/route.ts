// GET /api/debug — full system snapshot
import { NextResponse } from 'next/server'
import { queryAll, queryOne } from '@/lib/db'
import { getGateway } from '@/lib/gateway'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const WORKSPACE = process.env.WORKSPACE_PATH || '/app/workspace'

function workspaceStats() {
  if (!fs.existsSync(WORKSPACE)) return { taskDirs: 0, totalFiles: 0, totalBytes: 0, dirs: [] }
  const entries = fs.readdirSync(WORKSPACE, { withFileTypes: true })
  const dirs: Array<{ taskId: string; files: number; bytes: number; fileList: string[] }> = []
  let totalFiles = 0, totalBytes = 0
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const dp = path.join(WORKSPACE, e.name)
    const fileList: string[] = []
    let bytes = 0
    function walk(d: string, rel = '') {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        if (f.isDirectory()) { walk(path.join(d, f.name), rel ? `${rel}/${f.name}` : f.name); continue }
        if (f.name.startsWith('_run_')) continue
        const fp = path.join(d, f.name)
        const sz = fs.statSync(fp).size
        bytes += sz; totalBytes += sz; totalFiles++
        fileList.push(rel ? `${rel}/${f.name}` : f.name)
      }
    }
    walk(dp)
    dirs.push({ taskId: e.name, files: fileList.length, bytes, fileList })
  }
  return { taskDirs: dirs.length, totalFiles, totalBytes, dirs }
}

export async function GET() {
  const gw = getGateway()

  // DB counts
  const taskCounts = queryAll<{ status: string; n: number }>(
    `SELECT status, COUNT(*) as n FROM tasks GROUP BY status`
  )
  const byStatus: Record<string, number> = {}
  let totalTasks = 0
  for (const r of taskCounts) { byStatus[r.status] = r.n; totalTasks += r.n }

  const agentCounts = queryAll<{ status: string; n: number }>(
    `SELECT status, COUNT(*) as n FROM agents GROUP BY status`
  )
  const byAgentStatus: Record<string, number> = {}
  let totalAgents = 0
  for (const r of agentCounts) { byAgentStatus[r.status] = r.n; totalAgents += r.n }

  const counts = {
    tasks: { total: totalTasks, by_status: byStatus },
    agents: { total: totalAgents, by_status: byAgentStatus },
    steps: (queryOne<{ n: number }>('SELECT COUNT(*) as n FROM task_steps') ?? { n: 0 }).n,
    activity: (queryOne<{ n: number }>('SELECT COUNT(*) as n FROM activity_log') ?? { n: 0 }).n,
    memories: (queryOne<{ n: number }>('SELECT COUNT(*) as n FROM memories') ?? { n: 0 }).n,
    skills: (queryOne<{ n: number }>('SELECT COUNT(*) as n FROM skills') ?? { n: 0 }).n,
    chat_messages: (queryOne<{ n: number }>('SELECT COUNT(*) as n FROM chat_messages') ?? { n: 0 }).n,
    pending_approvals: (queryOne<{ n: number }>('SELECT COUNT(*) as n FROM pending_approvals') ?? { n: 0 }).n,
    dispatch_log: (queryOne<{ n: number }>('SELECT COUNT(*) as n FROM dispatch_log') ?? { n: 0 }).n,
  }

  // Tasks with step counts
  const tasks = queryAll(`
    SELECT t.*,
      (SELECT COUNT(*) FROM task_steps WHERE task_id=t.id) as total_steps,
      (SELECT content FROM task_steps WHERE task_id=t.id ORDER BY step DESC LIMIT 1) as last_step_content,
      (SELECT type FROM task_steps WHERE task_id=t.id ORDER BY step DESC LIMIT 1) as last_step_type,
      a.name as agent_name, a.model_primary as agent_model
    FROM tasks t
    LEFT JOIN agents a ON t.agent_id = a.id
    ORDER BY t.created_at DESC
  `)

  const agents = queryAll(`SELECT * FROM agents ORDER BY created_at ASC`)

  const recentActivity = queryAll(`
    SELECT al.*, a.name as agent_name
    FROM activity_log al
    LEFT JOIN agents a ON al.agent_id = a.id
    ORDER BY al.created_at DESC LIMIT 50
  `)

  const recentDispatch = queryAll(`
    SELECT dl.*, t.title as task_title, a.name as agent_name
    FROM dispatch_log dl
    LEFT JOIN tasks t ON dl.task_id = t.id
    LEFT JOIN agents a ON dl.agent_id = a.id
    ORDER BY dl.created_at DESC LIMIT 20
  `)

  const workspace = workspaceStats()

  return NextResponse.json({
    snapshot_at: new Date().toISOString(),
    gateway: { connected: gw.isReady() },
    counts,
    tasks,
    agents,
    recent_activity: recentActivity,
    recent_dispatch: recentDispatch,
    workspace,
  })
}
