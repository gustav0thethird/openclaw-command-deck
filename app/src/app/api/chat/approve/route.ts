// HITL approval endpoint
import { NextResponse } from 'next/server'
import { run, queryOne } from '@/lib/db'
import { executeHitlTool } from '../route'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const { id, approved } = await req.json() as { id: string; approved: boolean }

  const approval = queryOne<{ id: string; action_type: string; action_data: string; status: string }>(
    `SELECT * FROM pending_approvals WHERE id = ?`, [id]
  )
  if (!approval) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (approval.status !== 'pending') return NextResponse.json({ error: 'already processed' }, { status: 400 })

  const placeholder = `[AWAITING_APPROVAL:${id}]`

  if (!approved) {
    run(`UPDATE pending_approvals SET status='denied' WHERE id=?`, [id])
    run(`UPDATE chat_messages SET content='[Action denied by user]' WHERE content=?`, [placeholder])
    return NextResponse.json({ ok: true, result: 'denied' })
  }

  const { name, args } = JSON.parse(approval.action_data) as { name: string; args: Record<string, unknown>; toolCallId: string }

  let result: string
  try {
    result = await executeHitlTool(name, args)
  } catch (e) {
    result = `Error: ${String(e)}`
  }

  run(`UPDATE pending_approvals SET status='approved', result=? WHERE id=?`, [result, id])
  run(`UPDATE chat_messages SET content=? WHERE content=?`, [result, placeholder])

  return NextResponse.json({ ok: true, result })
}
