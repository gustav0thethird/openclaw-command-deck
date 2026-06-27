// GET /api/etsy/callback — exchange Etsy auth code for access token
import { NextResponse } from 'next/server'
import { getConfig, setConfig } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error) {
    return new NextResponse(`<html><body style="font-family:monospace;background:#0a1628;color:#ef4444;padding:40px">
      <h2>Etsy OAuth Error</h2><p>${error}: ${searchParams.get('error_description') ?? ''}</p>
    </body></html>`, { headers: { 'Content-Type': 'text/html' } })
  }

  const savedState = getConfig('etsy_oauth_state')
  if (!code || state !== savedState) {
    return new NextResponse(`<html><body style="font-family:monospace;background:#0a1628;color:#ef4444;padding:40px">
      <h2>Invalid state</h2><p>State mismatch. Try connecting again.</p>
    </body></html>`, { headers: { 'Content-Type': 'text/html' } })
  }

  const verifier = getConfig('etsy_pkce_verifier')
  const keystring = process.env.ETSY_API_KEY!
  const redirectUri = `${process.env.MISSION_CONTROL_URL ?? 'http://localhost:4000'}/api/etsy/callback`

  const res = await fetch('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: keystring,
      redirect_uri: redirectUri,
      code: code,
      code_verifier: verifier ?? '',
    }),
  })

  const data = await res.json() as {
    access_token?: string; refresh_token?: string; expires_in?: number; error?: string
  }

  if (!res.ok || !data.access_token) {
    return new NextResponse(`<html><body style="font-family:monospace;background:#0a1628;color:#ef4444;padding:40px">
      <h2>Token exchange failed</h2><pre>${JSON.stringify(data, null, 2)}</pre>
    </body></html>`, { headers: { 'Content-Type': 'text/html' } })
  }

  // Save tokens to DB config
  setConfig('etsy_access_token', data.access_token)
  if (data.refresh_token) setConfig('etsy_refresh_token', data.refresh_token)
  const expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000
  setConfig('etsy_token_expires_at', String(expiresAt))

  // Fetch shop ID
  let shopId = ''
  try {
    const meRes = await fetch('https://openapi.etsy.com/v3/application/users/me', {
      headers: { 'x-api-key': keystring, 'Authorization': `Bearer ${data.access_token}` },
    })
    const me = await meRes.json() as { user_id?: number }
    if (me.user_id) {
      const shopsRes = await fetch(`https://openapi.etsy.com/v3/application/users/${me.user_id}/shops`, {
        headers: { 'x-api-key': keystring, 'Authorization': `Bearer ${data.access_token}` },
      })
      const shops = await shopsRes.json() as { shop_id?: number; shop_name?: string }
      if (shops.shop_id) {
        shopId = String(shops.shop_id)
        setConfig('etsy_shop_id', shopId)
      }
    }
  } catch {}

  return new NextResponse(`<html><body style="font-family:monospace;background:#0a1628;color:#22c55e;padding:40px">
    <h2 style="color:#00cfff;font-family:Orbitron,sans-serif">✓ Etsy Connected</h2>
    <p>Access token saved. Shop ID: <strong>${shopId || 'fetched on first use'}</strong></p>
    <p style="color:#94a3b8">You can close this tab. Mission Control is now authorised to list products on Etsy.</p>
    <a href="${process.env.MISSION_CONTROL_URL ?? 'http://localhost:4000'}" style="color:#00cfff">← Return to Mission Control</a>
  </body></html>`, { headers: { 'Content-Type': 'text/html' } })
}
