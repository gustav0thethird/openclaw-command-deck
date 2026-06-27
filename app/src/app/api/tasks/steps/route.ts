import { NextResponse } from 'next/server'
import { queryAll } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const taskId = searchParams.get('taskId')
  if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })
  const steps = queryAll(
    'SELECT step, type, content, created_at FROM task_steps WHERE task_id=? ORDER BY step ASC',
    [taskId]
  )
  return NextResponse.json(steps)
}
