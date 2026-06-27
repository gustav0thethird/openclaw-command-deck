import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const WORKSPACE = process.env.WORKSPACE_PATH || '/app/workspace'

function listFilesRecursive(dir: string, base = ''): { name: string; path: string; size: number; modified: number }[] {
  if (!fs.existsSync(dir)) return []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const results: { name: string; path: string; size: number; modified: number }[] = []
  for (const e of entries) {
    const rel = base ? `${base}/${e.name}` : e.name
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) {
      results.push(...listFilesRecursive(abs, rel))
    } else {
      const stat = fs.statSync(abs)
      results.push({ name: e.name, path: rel, size: stat.size, modified: stat.mtimeMs })
    }
  }
  return results
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const taskId = searchParams.get('taskId')

  const dir = taskId ? path.join(WORKSPACE, taskId) : WORKSPACE
  const files = listFilesRecursive(dir)
  return NextResponse.json(files.sort((a, b) => b.modified - a.modified))
}
