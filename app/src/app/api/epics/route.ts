// GET /api/epics — list all epics with task progress
// POST /api/epics — create epic
// Fix B2: [Package] tasks are excluded from task_total, task_done, task_active counts
import { NextResponse } from 'next/server'
import { queryAll, queryOne, run } from '@/lib/db'
import { broadcast } from '@/lib/events'
import { v4 as uuid } from 'uuid'

export const dynamic = 'force-dynamic'

export async function GET() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const epics = queryAll(`SELECT * FROM epics ORDER BY created_at DESC`) as any[]
  const enriched = epics.map((e: Record<string, unknown>) => {
    // Exclude [Package] tasks from all counts — they are infrastructure tasks, not user-visible work
    const tasks = queryAll<{ status: string; n: number }>(
      `SELECT status, COUNT(*) as n FROM tasks
       WHERE epic_id=? AND title NOT LIKE '[Package]%'
       GROUP BY status`,
      [e.id as string]
    )
    const total = tasks.reduce((s, r) => s + r.n, 0)
    const done = tasks.find(r => r.status === 'done')?.n ?? 0
    const active = tasks.find(r => r.status === 'active')?.n ?? 0
    return { ...e, task_total: total, task_done: done, task_active: active }
  })
  return NextResponse.json(enriched)
}

export async function POST(req: Request) {
  const body = await req.json()
  const { title, description, agent_id, priority } = body
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 })
  const id = uuid()
  run(`INSERT INTO epics (id,title,description,status,priority,agent_id) VALUES (?,?,?,'planning',?,?)`,
    [id, title, description ?? '', priority ?? 'medium', agent_id ?? null])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const epic = queryOne(`SELECT * FROM epics WHERE id=?`, [id]) as any
  broadcast('epic_update', { ...(epic ?? {}), task_total: 0, task_done: 0, task_active: 0 })
  return NextResponse.json(epic)
}
