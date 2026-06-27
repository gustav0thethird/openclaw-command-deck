import { NextResponse } from 'next/server'
import { queryAll, run, logActivity } from '@/lib/db'
import { broadcast } from '@/lib/events'
import { v4 as uuid } from 'uuid'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')

  let sql = 'SELECT * FROM tasks'
  const params: unknown[] = []
  if (status) { sql += ' WHERE status = ?'; params.push(status) }
  sql += ' ORDER BY created_at DESC'

  return NextResponse.json(queryAll(sql, params))
}

export async function POST(req: Request) {
  const body = await req.json()
  const { title, description = '', mode = 'kanban', agent_id, priority = 'medium', due_date, tags } = body

  if (!title?.trim()) {
    return NextResponse.json({ error: 'title required' }, { status: 400 })
  }

  const id = uuid()
  run(
    `INSERT INTO tasks (id, title, description, status, mode, agent_id, priority, due_date, tags)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, title.trim(), description, 'backlog', mode, agent_id || 'agent-main', priority, due_date || null, JSON.stringify(tags || [])]
  )

  const task = queryAll(`SELECT * FROM tasks WHERE id = ?`, [id])[0]
  logActivity('task_created', `Task created: ${title}`, { taskId: id })
  broadcast('task_update', { ...(task as object), _action: 'created' })
  return NextResponse.json(task, { status: 201 })
}
