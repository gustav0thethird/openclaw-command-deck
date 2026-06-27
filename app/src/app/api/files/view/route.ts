import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const WORKSPACE = process.env.WORKSPACE_PATH || '/app/workspace'

const MIME: Record<string, string> = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.txt': 'text/plain', '.md': 'text/plain',
  '.csv': 'text/plain', '.log': 'text/plain', '.yaml': 'text/plain', '.yml': 'text/plain',
  '.sh': 'text/plain', '.sql': 'text/plain',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
  '.py': 'text/plain', '.ts': 'text/plain', '.tsx': 'text/plain',
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const filePath = searchParams.get('path')
  if (!filePath) return NextResponse.json({ error: 'path required' }, { status: 400 })

  const resolved = path.resolve(WORKSPACE, filePath)
  if (!resolved.startsWith(path.resolve(WORKSPACE))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (!fs.existsSync(resolved)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const data = fs.readFileSync(resolved)
  const ext = path.extname(filePath).toLowerCase()
  const contentType = MIME[ext] ?? 'application/octet-stream'
  const filename = path.basename(filePath)

  return new NextResponse(data, {
    headers: {
      'Content-Type': contentType,
      // inline = browser renders it; no attachment header
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': String(data.length),
      'Cache-Control': 'no-store',
    },
  })
}
