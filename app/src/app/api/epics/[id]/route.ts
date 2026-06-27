// /api/epics/[id] — GET, PATCH, DELETE, POST (decompose)
// Updated: agent routing via pickAgent(), success_criteria extracted, full agent list queried
import { NextResponse } from 'next/server'
import { queryAll, queryOne, run } from '@/lib/db'
import { broadcast } from '@/lib/events'
import { dispatchTask } from '@/lib/dispatch'
import { v4 as uuid } from 'uuid'

export const dynamic = 'force-dynamic'

interface Agent {
  id: string
  name: string
  type: string
  created_at: number
}

// Route tasks to the most appropriate agent based on keywords in title/description
function pickAgent(taskTitle: string, taskDesc: string, agents: Agent[]): Agent {
  const text = (taskTitle + ' ' + taskDesc).toLowerCase()

  // Commerce: product listing, publishing, shop tasks → SHOPKEEPER
  if (/publish|printify|upload.*image|create.*product|shopkeeper|fulfil/.test(text)) {
    const a = agents.find(a => a.name === 'SHOPKEEPER')
    if (a) return a
  }

  // Creative: image generation, t-shirt graphics → ARTIST (check before MERCHANT)
  if (/generate.*image|generate.*graphic|t.shirt.*graphic|tshirt.*graphic|create.*image|artwork|illustration/.test(text) || /\bartist\b/.test(text)) {
    const a = agents.find(a => a.name === 'ARTIST')
    if (a) return a
  }

  // Commerce research: niche research → MERCHANT
  if (/research.*niche|research.*meme|research.*trend|trending.*niche|\bmerchant\b/.test(text)) {
    const a = agents.find(a => a.name === 'MERCHANT')
    if (a) return a
  }

  // UI/design tasks → SERENA
  if (/design|style|css|ui|ux|component|layout|colour|color|button|form|modal|page|screen|interface/.test(text)) {
    const serena = agents.find(a => a.name === 'SERENA')
    if (serena) return serena
  }

  // Research/investigation tasks → RAVEN
  if (/research|investigate|analyse|analyze|gather|study|find|discover|review|survey|explore/.test(text)) {
    const raven = agents.find(a => a.name === 'RAVEN')
    if (raven) return raven
  }

  // Build/code tasks → FORGE
  if (/build|implement|create.*api|backend|server|function|class|module|test|deploy|install|setup|configure/.test(text)) {
    const forge = agents.find(a => a.name === 'FORGE')
    if (forge) return forge
  }

  // Default: ARIA
  const aria = agents.find(a => a.name === 'ARIA')
  if (aria) return aria
  return agents[0]
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const epic = queryOne(`SELECT * FROM epics WHERE id=?`, [params.id])
  if (!epic) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const tasks = queryAll(`SELECT * FROM tasks WHERE epic_id=? ORDER BY created_at ASC`, [params.id])
  return NextResponse.json({ epic, tasks })
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json()
  const { status, title, description, priority } = body
  const fields: string[] = []
  const vals: unknown[] = []
  if (status) { fields.push('status=?'); vals.push(status) }
  if (title) { fields.push('title=?'); vals.push(title) }
  if (description !== undefined) { fields.push('description=?'); vals.push(description) }
  if (priority) { fields.push('priority=?'); vals.push(priority) }
  if (!fields.length) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  fields.push('updated_at=unixepoch()*1000')
  vals.push(params.id)
  run(`UPDATE epics SET ${fields.join(',')} WHERE id=?`, vals)
  const epic = queryOne(`SELECT * FROM epics WHERE id=?`, [params.id])
  broadcast('epic_update', epic)
  return NextResponse.json(epic)
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  run(`DELETE FROM epics WHERE id=?`, [params.id])
  broadcast('epic_deleted', { id: params.id })
  return NextResponse.json({ ok: true })
}

// POST /api/epics/[id] — decompose epic into tasks via OpenAI, route each task to best agent
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const epic = queryOne<{ id: string; title: string; description: string }>(
    `SELECT * FROM epics WHERE id=?`, [params.id]
  )
  if (!epic) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Load ALL agents so we can route tasks intelligently
  const agents = queryAll<Agent>(`SELECT * FROM agents ORDER BY created_at ASC`)
  if (agents.length === 0) return NextResponse.json({ error: 'no agents available' }, { status: 503 })

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY not set' }, { status: 503 })

  // Direct OpenAI call — structured JSON task list, no agent loop
  const OpenAI = (await import('openai')).default
  const openai = new OpenAI({ apiKey })

  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: `Break this epic into 3-4 tasks for an Etsy print-on-demand pipeline. Tasks run ONE AT A TIME and ALL share a single workspace directory — files written by earlier tasks are directly readable by later tasks (no path prefixes needed).

Epic: ${epic.title}
Description: ${epic.description || 'No description provided'}

For a print-on-demand Etsy pipeline, ALWAYS use exactly these 3 tasks in this order:
1. Research: MERCHANT researches a trending niche and writes product_brief.txt with fields: PRODUCT, AUDIENCE, TITLE, DESCRIPTION, TAGS, DESIGN_BRIEF
2. Design: ARTIST reads product_brief.txt, calls generate_image once to create tshirt_design.png
3. Publish: SHOPKEEPER reads product_brief.txt and tshirt_design.png, uploads image to Printify, creates product, publishes it

Rules:
- Descriptions must say "Read product_brief.txt" or "Read tshirt_design.png" directly (no task IDs or paths needed — shared workspace)
- success_criteria must describe the OUTCOME (e.g. "product is live on Printify"), NOT a specific filename
- Do NOT create separate "write listing" or "write SEO" tasks — fold that into Research or Publish

Respond with ONLY a JSON array, no other text:
[{"title":"...","description":"...","success_criteria":"outcome-based definition of done"},...]`
    }],
    max_tokens: 800,
  })

  let tasks: Array<{ title: string; description: string; success_criteria?: string }> = []
  try {
    const content = res.choices[0].message.content ?? '[]'
    const jsonStr = content.match(/\[[\s\S]*\]/)?.[0] ?? '[]'
    tasks = JSON.parse(jsonStr)
  } catch {
    return NextResponse.json({ error: 'Failed to parse task list from AI' }, { status: 500 })
  }

  // Create tasks — each routed to the most appropriate agent
  const created: string[] = []
  for (const t of tasks.slice(0, 5)) {
    if (!t.title) continue

    const assignedAgent = pickAgent(t.title, t.description ?? '', agents)
    const taskId = uuid()

    run(
      `INSERT INTO tasks (id,title,description,status,priority,agent_id,epic_id,depth,success_criteria) VALUES (?,?,?,'backlog','medium',?,?,0,?)`,
      [taskId, t.title, t.description ?? '', assignedAgent.id, epic.id, t.success_criteria ?? null]
    )
    broadcast('task_update', {
      id: taskId,
      title: t.title,
      status: 'backlog',
      epic_id: epic.id,
      agent_id: assignedAgent.id,
      success_criteria: t.success_criteria ?? null,
    })
    created.push(taskId)
  }

  // Only dispatch the first task — dispatch.ts queues the rest sequentially as each completes
  if (created.length > 0) {
    dispatchTask(created[0]).catch(() => {})
  }

  run(`UPDATE epics SET status='active', updated_at=unixepoch()*1000 WHERE id=?`, [params.id])
  broadcast('epic_update', { id: epic.id, status: 'active' })

  return NextResponse.json({ ok: true, tasks: created.length, taskIds: created })
}
