import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const WORKSPACE = process.env.WORKSPACE_PATH || '/app/workspace'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const filePath = searchParams.get('path')
  if (!filePath) return NextResponse.json({ error: 'path required' }, { status: 400 })

  // Prevent path traversal
  const resolved = path.resolve(WORKSPACE, filePath)
  if (!resolved.startsWith(path.resolve(WORKSPACE))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (!fs.existsSync(resolved)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const data = fs.readFileSync(resolved)
  const ext = path.extname(filePath).toLowerCase()
  const mime: Record<string, string> = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.json': 'application/json', '.txt': 'text/plain', '.md': 'text/markdown',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
    '.py': 'text/plain', '.ts': 'text/plain', '.tsx': 'text/plain',
  }
  const contentType = mime[ext] ?? 'application/octet-stream'
  const filename = path.basename(filePath)

  return new NextResponse(data, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(data.length),
    },
  })
}
