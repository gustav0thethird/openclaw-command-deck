// GET /api/sentinel — active alerts
// POST /api/sentinel — investigate or dismiss alert
import { NextResponse } from 'next/server'
import { run } from '@/lib/db'
import { getActiveAlerts, investigateAlert } from '@/lib/sentinel'
import { broadcast } from '@/lib/events'
import { queryAll } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const alerts = getActiveAlerts()
  return NextResponse.json(alerts)
}

export async function POST(req: Request) {
  const { action, alertId, agentId } = await req.json()

  if (action === 'investigate') {
    if (!alertId) return NextResponse.json({ error: 'alertId required' }, { status: 400 })
    const agents = queryAll<{ id: string }>(`SELECT id FROM agents ORDER BY created_at ASC LIMIT 1`)
    const agent = agentId ?? agents[0]?.id
    if (!agent) return NextResponse.json({ error: 'no agents' }, { status: 503 })
    const taskId = await investigateAlert(alertId, agent)
    return NextResponse.json({ ok: true, taskId })
  }

  if (action === 'dismiss') {
    if (!alertId) return NextResponse.json({ error: 'alertId required' }, { status: 400 })
    run(`UPDATE sentinel_alerts SET resolved=1 WHERE id=?`, [alertId])
    broadcast('sentinel_alert_resolved', { id: alertId })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
