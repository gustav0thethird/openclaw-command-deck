// GET /api/schedules — list all schedules
// POST /api/schedules — create schedule
import { NextResponse } from 'next/server'
import { queryAll, queryOne, run } from '@/lib/db'
import { v4 as uuid } from 'uuid'

export const dynamic = 'force-dynamic'

interface Schedule {
  id: string
  name: string
  task_title: string
  task_description: string
  agent_id: string | null
  interval_minutes: number
  enabled: number
  last_run: number | null
  created_at: number
}

export async function GET() {
  const schedules = queryAll<Schedule>(
    `SELECT * FROM schedules ORDER BY created_at ASC`
  )
  return NextResponse.json(schedules)
}

export async function POST(req: Request) {
  let body: {
    name?: string
    task_title?: string
    task_description?: string
    agent_id?: string | null
    interval_minutes?: number
    enabled?: boolean | number
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const { name, task_title, task_description, agent_id, interval_minutes, enabled } = body

  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'name required' }, { status: 400 })
  }
  if (!task_title || typeof task_title !== 'string') {
    return NextResponse.json({ error: 'task_title required' }, { status: 400 })
  }
  if (!interval_minutes || typeof interval_minutes !== 'number' || interval_minutes < 1) {
    return NextResponse.json({ error: 'interval_minutes must be a positive number' }, { status: 400 })
  }

  const id = uuid()
  const enabledVal = enabled === false || enabled === 0 ? 0 : 1

  run(
    `INSERT INTO schedules (id,name,task_title,task_description,agent_id,interval_minutes,enabled)
     VALUES (?,?,?,?,?,?,?)`,
    [id, name, task_title, task_description ?? '', agent_id ?? null, interval_minutes, enabledVal]
  )

  const schedule = queryOne<Schedule>(`SELECT * FROM schedules WHERE id=?`, [id])
  return NextResponse.json(schedule)
}
