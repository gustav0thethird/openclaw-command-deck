import { NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'
import { dispatchTask } from '@/lib/dispatch'

export async function POST(req: Request) {
  const { taskId } = await req.json()
  if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })

  const task = queryOne<{ id: string; status: string }>(`SELECT id, status FROM tasks WHERE id = ?`, [taskId])
  if (!task) return NextResponse.json({ error: 'task not found' }, { status: 404 })

  if (task.status === 'active') {
    return NextResponse.json({ error: 'already active' }, { status: 409 })
  }

  // Fire and forget — client tracks via SSE
  dispatchTask(taskId).catch(err => {
    console.error(`[Dispatch] Error for task ${taskId}:`, err)
  })

  return NextResponse.json({ ok: true, taskId })
}
