import { NextResponse } from 'next/server'
import { queryAll, run } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') ?? ''
  const scope = searchParams.get('scope') ?? ''
  const limit = parseInt(searchParams.get('limit') ?? '50')

  let sql = `SELECT * FROM knowledge`
  const params: unknown[] = []
  const where: string[] = []

  if (q) {
    where.push(`(key LIKE ? OR content LIKE ? OR tags LIKE ?)`)
    params.push(`%${q}%`, `%${q}%`, `%${q}%`)
  }
  if (scope) {
    where.push(`scope = ?`)
    params.push(scope)
  }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`
  sql += ` ORDER BY updated_at DESC LIMIT ?`
  params.push(limit)

  const rows = queryAll(sql, params)
  return NextResponse.json(rows)
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  run(`DELETE FROM knowledge WHERE id=?`, [id])
  return NextResponse.json({ ok: true })
}
