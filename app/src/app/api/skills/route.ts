// Skills API — CRUD for registered skills/MCP adapters
import { NextResponse } from 'next/server'
import { run, queryAll, queryOne } from '@/lib/db'
import { v4 as uuid } from 'uuid'
import { broadcast } from '@/lib/events'

export const dynamic = 'force-dynamic'

export async function GET() {
  const skills = queryAll<{
    id: string; name: string; description: string; type: string; config: string; enabled: number; created_at: number
  }>('SELECT * FROM skills ORDER BY created_at ASC')
  return NextResponse.json(skills.map(s => ({ ...s, config: (() => { try { return JSON.parse(s.config) } catch { return {} } })() })))
}

export async function POST(req: Request) {
  const body = await req.json() as { name: string; description?: string; type?: string; config?: Record<string, unknown> }
  const id = uuid()
  run(
    `INSERT INTO skills (id, name, description, type, config) VALUES (?, ?, ?, ?, ?)`,
    [id, body.name, body.description ?? '', body.type ?? 'builtin', JSON.stringify(body.config ?? {})]
  )
  const skill = queryOne<{ id: string; name: string; description: string; type: string; config: string; enabled: number }>(`SELECT * FROM skills WHERE id=?`, [id])!
  broadcast('skill_update', { ...skill, config: JSON.parse(skill.config) })
  return NextResponse.json({ ...skill, config: JSON.parse(skill.config) })
}
