// Next.js instrumentation — runs once on server start (not in edge runtime)
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startSentinel } = await import('./src/lib/sentinel')
    startSentinel()
  }
}
