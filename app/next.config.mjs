import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  // TypeScript is checked by 'tsc --noEmit' (incremental, fast) before next build.
  // Telling next build to skip its own separate (non-incremental) TS pass.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3', 'ws'],
  },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.join(__dirname, 'src'),
    }
    return config
  },
}

export default nextConfig
