import { NextResponse } from 'next/server'
import { queryOne, run, logActivity } from '@/lib/db'
import { broadcast } from '@/lib/events'

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const task = queryOne(`SELECT * FROM tasks WHERE id = ?`, [params.id])
  if (!task) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(task)
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json()
  const allowed = ['title', 'description', 'status', 'mode', 'agent_id', 'result', 'error', 'priority', 'due_date', 'tags']

  const updates: string[] = []
  const vals: unknown[] = []

  for (const key of allowed) {
    if (key in body) {
      updates.push(`${key} = ?`)
      vals.push(key === 'tags' && Array.isArray(body[key]) ? JSON.stringify(body[key]) : body[key])
    }
  }

  if (updates.length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })

  updates.push('updated_at = unixepoch()*1000')
  vals.push(params.id)

  run(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, vals)
  const task = queryOne<{ title: string; status: string; agent_id: string }>(`SELECT * FROM tasks WHERE id = ?`, [params.id])

  if (body.status && task) {
    logActivity('status_changed', `Task status → ${body.status}: ${task.title}`, {
      taskId: params.id,
      agentId: task.agent_id ?? undefined,
    })
  } else if ((body.title || body.description) && task) {
    logActivity('task_updated', `Task updated: ${task.title}`, {
      taskId: params.id,
      agentId: task.agent_id ?? undefined,
    })
  }

  broadcast('task_update', task)
  return NextResponse.json(task)
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const task = queryOne<{ title: string; agent_id: string }>(`SELECT title, agent_id FROM tasks WHERE id = ?`, [params.id])
  run(`DELETE FROM tasks WHERE id = ?`, [params.id])
  run(`DELETE FROM dispatch_log WHERE task_id = ?`, [params.id])
  if (task) logActivity('task_deleted', `Task deleted: ${task.title}`, {
    taskId: params.id,
    agentId: task.agent_id ?? undefined,
  })
  broadcast('task_delete', { id: params.id })
  return NextResponse.json({ ok: true })
}
