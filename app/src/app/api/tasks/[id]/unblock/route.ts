// POST /api/tasks/[id]/unblock — unblock a blocked task with a user-provided answer
import { NextResponse } from 'next/server'
import { queryOne, run } from '@/lib/db'
import { broadcast } from '@/lib/events'
import { dispatchTask } from '@/lib/dispatch'

export const dynamic = 'force-dynamic'

interface Task {
  id: string
  title: string
  description: string
  status: string
  blocked_reason: string | null
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const task = queryOne<Task>(`SELECT * FROM tasks WHERE id=?`, [params.id])
  if (!task) {
    return NextResponse.json({ error: 'task not found' }, { status: 404 })
  }

  if (task.status !== 'blocked') {
    return NextResponse.json({ error: 'task is not blocked' }, { status: 400 })
  }

  let body: { answer?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const { answer } = body
  if (!answer || typeof answer !== 'string' || !answer.trim()) {
    return NextResponse.json({ error: 'answer required' }, { status: 400 })
  }

  // Prepend the user's answer to the task description so the agent sees it
  const blockedReason = task.blocked_reason ?? 'blocked'
  const prefix = `[USER RESPONSE TO: ${blockedReason}]\n${answer.trim()}\n---\n`
  const newDescription = prefix + (task.description ?? '')

  run(
    `UPDATE tasks SET status='backlog', blocked_reason=NULL, description=?, updated_at=unixepoch()*1000 WHERE id=?`,
    [newDescription, params.id]
  )

  const updated = queryOne<Task>(`SELECT * FROM tasks WHERE id=?`, [params.id])
  broadcast('task_update', updated)

  // Re-dispatch immediately
  dispatchTask(params.id).catch((e: unknown) => {
    console.error(`[Unblock] Failed to dispatch task ${params.id}:`, e)
  })

  return NextResponse.json({ ok: true })
}
