// GET /api/etsy/connect — generate Etsy OAuth URL and redirect
import { NextResponse } from 'next/server'
import { setConfig } from '@/lib/db'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export async function GET() {
  const keystring = process.env.ETSY_API_KEY
  if (!keystring) return NextResponse.json({ error: 'ETSY_API_KEY not set' }, { status: 500 })

  // PKCE
  const verifier = base64url(crypto.randomBytes(32))
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest())
  const state = base64url(crypto.randomBytes(16))

  // Save verifier to DB so callback can retrieve it
  setConfig('etsy_pkce_verifier', verifier)
  setConfig('etsy_oauth_state', state)

  const redirectUri = `${process.env.MISSION_CONTROL_URL ?? 'http://localhost:4000'}/api/etsy/callback`
  const scopes = [
    'shops_r', 'shops_w',
    'listings_r', 'listings_w', 'listings_d',
    'transactions_r', 'transactions_w',
    'profile_r',
  ].join('%20')

  const url = `https://www.etsy.com/oauth/connect` +
    `?response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${scopes}` +
    `&client_id=${keystring}` +
    `&state=${state}` +
    `&code_challenge=${challenge}` +
    `&code_challenge_method=S256`

  // Redirect the browser straight to Etsy
  return NextResponse.redirect(url)
}
