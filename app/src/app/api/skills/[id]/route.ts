// Skill CRUD + MCP tool call proxy
import { NextResponse } from 'next/server'
import { run, queryOne } from '@/lib/db'
import { broadcast } from '@/lib/events'

export const dynamic = 'force-dynamic'

interface Skill {
  id: string; name: string; description: string; type: string; config: string; enabled: number
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json() as { enabled?: boolean; name?: string; description?: string; config?: Record<string, unknown> }
  const sets: string[] = []
  const vals: unknown[] = []
  if (body.enabled !== undefined) { sets.push('enabled=?'); vals.push(body.enabled ? 1 : 0) }
  if (body.name !== undefined) { sets.push('name=?'); vals.push(body.name) }
  if (body.description !== undefined) { sets.push('description=?'); vals.push(body.description) }
  if (body.config !== undefined) { sets.push('config=?'); vals.push(JSON.stringify(body.config)) }
  if (sets.length) { vals.push(params.id); run(`UPDATE skills SET ${sets.join(',')} WHERE id=?`, vals) }
  const skill = queryOne<Skill>('SELECT * FROM skills WHERE id=?', [params.id])!
  broadcast('skill_update', { ...skill, config: JSON.parse(skill.config) })
  return NextResponse.json({ ...skill, config: JSON.parse(skill.config) })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  run('DELETE FROM skills WHERE id=?', [params.id])
  broadcast('skill_update', { id: params.id, deleted: true })
  return NextResponse.json({ ok: true })
}

// POST to /:id/call — invoke an MCP skill
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const skill = queryOne<Skill>('SELECT * FROM skills WHERE id=?', [params.id])
  if (!skill) return NextResponse.json({ error: 'skill not found' }, { status: 404 })

  const config = JSON.parse(skill.config) as Record<string, unknown>
  const { tool, args } = await req.json() as { tool: string; args: Record<string, unknown> }

  if (skill.type === 'mcp_http') {
    // MCP HTTP adapter — call the MCP server
    const baseUrl = config.url as string
    if (!baseUrl) return NextResponse.json({ error: 'No URL configured' }, { status: 400 })

    try {
      const resp = await fetch(`${baseUrl}/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
        body: JSON.stringify({ tool, arguments: args }),
        signal: AbortSignal.timeout(30000),
      })
      const result = await resp.json()
      return NextResponse.json({ ok: resp.ok, result })
    } catch (e) {
      return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
    }
  }

  if (skill.type === 'web_search') {
    // Enhanced web search skill
    const query = args.query as string
    if (!query) return NextResponse.json({ error: 'query required' }, { status: 400 })

    try {
      // DuckDuckGo instant answers
      const encoded = encodeURIComponent(query.slice(0, 200))
      const resp = await fetch(`https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`, {
        headers: { 'User-Agent': 'OpenClaw-MC/1.0' },
        signal: AbortSignal.timeout(8000),
      })
      const data = await resp.json() as Record<string, unknown>
      const lines: string[] = []
      if (data.AbstractText) lines.push(String(data.AbstractText))
      if (data.Answer) lines.push(`Answer: ${String(data.Answer)}`)
      if (Array.isArray(data.RelatedTopics)) {
        const topics = (data.RelatedTopics as Array<Record<string, unknown>>).slice(0, 5).map(t => t.Text ?? '').filter(Boolean)
        if (topics.length) lines.push('Related:\n' + topics.map(t => `- ${t}`).join('\n'))
      }
      return NextResponse.json({ ok: true, result: lines.join('\n\n') || 'No results found.' })
    } catch (e) {
      return NextResponse.json({ ok: false, error: String(e) })
    }
  }

  return NextResponse.json({ error: `Unsupported skill type: ${skill.type}` }, { status: 400 })
}
