import { NextResponse } from 'next/server'
import { queryAll, run } from '@/lib/db'
import { broadcast } from '@/lib/events'
import { v4 as uuid } from 'uuid'

export async function GET() {
  const agents = queryAll(`SELECT * FROM agents ORDER BY created_at ASC`)
  return NextResponse.json(agents)
}

export async function POST(req: Request) {
  const body = await req.json()
  const { name, openclaw_id = 'main', room = 'engineering', model_primary, model_fallbacks, soul, github_url = '' } = body

  if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const id = `agent-${uuid().slice(0, 8)}`
  run(
    `INSERT INTO agents (id, name, openclaw_id, room, model_primary, model_fallbacks, soul, github_url) VALUES (?,?,?,?,?,?,?,?)`,
    [
      id,
      name.trim(),
      openclaw_id,
      room,
      model_primary || 'local-gpu/local-ai',
      JSON.stringify(Array.isArray(model_fallbacks) ? model_fallbacks : (model_fallbacks ? [model_fallbacks] : [])),
      soul || '',
      github_url || '',
    ]
  )

  const agent = queryAll(`SELECT * FROM agents WHERE id = ?`, [id])[0]
  broadcast('agent_update', { action: 'created', ...(agent as object) })
  return NextResponse.json(agent, { status: 201 })
}

export async function PATCH(req: Request) {
  const body = await req.json()
  const { id, ...fields } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const allowed = ['name', 'openclaw_id', 'room', 'model_primary', 'model_fallbacks', 'soul', 'status', 'github_url']
  const updates: string[] = []
  const vals: unknown[] = []

  for (const key of allowed) {
    if (key in fields) {
      updates.push(`${key} = ?`)
      vals.push(key === 'model_fallbacks'
        ? (Array.isArray(fields[key]) ? JSON.stringify(fields[key]) : fields[key])
        : fields[key])
    }
  }

  if (updates.length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  vals.push(id)
  run(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`, vals)
  const agent = queryAll(`SELECT * FROM agents WHERE id = ?`, [id])[0]
  broadcast('agent_update', { action: 'updated', ...(agent as object) })
  return NextResponse.json(agent)
}

export async function DELETE(req: Request) {
  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Prevent deleting the last agent
  const count = queryAll(`SELECT COUNT(*) as c FROM agents`)[0] as { c: number }
  if (count.c <= 1) return NextResponse.json({ error: 'cannot delete last agent' }, { status: 400 })

  run(`UPDATE tasks SET agent_id = NULL WHERE agent_id = ?`, [id])
  run(`DELETE FROM agents WHERE id = ?`, [id])
  broadcast('agent_update', { action: 'deleted', id })
  return NextResponse.json({ ok: true })
}
