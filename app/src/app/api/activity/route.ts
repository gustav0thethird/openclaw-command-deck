import { NextResponse } from 'next/server'
import { queryAll } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const limit = parseInt(searchParams.get('limit') || '100')
  const taskId = searchParams.get('taskId')
  const agentId = searchParams.get('agentId')

  const conditions: string[] = []
  const params: unknown[] = []

  if (taskId) { conditions.push('task_id = ?'); params.push(taskId) }
  if (agentId) { conditions.push('agent_id = ?'); params.push(agentId) }

  let sql = 'SELECT * FROM activity_log'
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ')
  sql += ' ORDER BY created_at DESC LIMIT ?'
  params.push(limit)

  return NextResponse.json(queryAll(sql, params))
}
