// PATCH /api/schedules/[id] — update schedule
// DELETE /api/schedules/[id] — delete schedule
import { NextResponse } from 'next/server'
import { queryOne, run } from '@/lib/db'

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

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const existing = queryOne<Schedule>(`SELECT * FROM schedules WHERE id=?`, [params.id])
  if (!existing) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  let body: {
    name?: string
    task_title?: string
    task_description?: string
    interval_minutes?: number
    enabled?: boolean | number | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const { name, task_title, task_description, interval_minutes, enabled } = body
  const fields: string[] = []
  const vals: unknown[] = []

  if (name !== undefined && name !== null) {
    fields.push('name=?')
    vals.push(name)
  }
  if (task_title !== undefined && task_title !== null) {
    fields.push('task_title=?')
    vals.push(task_title)
  }
  if (task_description !== undefined) {
    fields.push('task_description=?')
    vals.push(task_description)
  }
  if (interval_minutes !== undefined && interval_minutes !== null) {
    if (typeof interval_minutes !== 'number' || interval_minutes < 1) {
      return NextResponse.json({ error: 'interval_minutes must be a positive number' }, { status: 400 })
    }
    fields.push('interval_minutes=?')
    vals.push(interval_minutes)
  }
  if (enabled !== undefined && enabled !== null) {
    fields.push('enabled=?')
    vals.push(enabled === true || enabled === 1 ? 1 : 0)
  }

  if (fields.length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  vals.push(params.id)
  run(`UPDATE schedules SET ${fields.join(',')} WHERE id=?`, vals)

  const updated = queryOne<Schedule>(`SELECT * FROM schedules WHERE id=?`, [params.id])
  return NextResponse.json(updated)
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const existing = queryOne<Schedule>(`SELECT * FROM schedules WHERE id=?`, [params.id])
  if (!existing) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  run(`DELETE FROM schedules WHERE id=?`, [params.id])
  return NextResponse.json({ ok: true })
}
