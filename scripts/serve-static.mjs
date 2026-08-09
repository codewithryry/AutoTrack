/**
 * Static server that mirrors Vercel's routing for the built app.
 *
 * Vercel checks the filesystem before applying `rewrites`, so a real asset
 * request wins and anything else falls through to index.html. Reproducing that
 * locally lets `npm run verify:browser` exercise the production bundle exactly
 * as it will behave once deployed.
 *
 *   node scripts/serve-static.mjs [port] [dir]
 */
import http from 'node:http'
import { createReadStream, existsSync, statSync, readFileSync } from 'node:fs'
import { extname, join, normalize, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.argv[2] ?? 4173)
const DIR = join(root, process.argv[3] ?? 'dist')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

// The header rules from vercel.json, applied here so the simulation matches.
const vercelConfig = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'))

function headersFor(pathname) {
  const out = {}
  for (const rule of vercelConfig.headers ?? []) {
    const pattern = new RegExp(`^${rule.source.replace(/\/\(\.\*\)/g, '/.*').replace(/\(\.\*\)/g, '.*')}$`)
    if (pattern.test(pathname)) {
      for (const { key, value } of rule.headers) out[key] = value
    }
  }
  return out
}

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '')
  let file = join(DIR, safe)

  // 1. Filesystem first — exactly as Vercel resolves static assets.
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')

  // 2. Otherwise fall through to the SPA entry point (the rewrite rule).
  if (!existsSync(file)) file = join(DIR, 'index.html')

  const type = TYPES[extname(file)] ?? 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': type, ...headersFor(pathname) })
  createReadStream(file).pipe(res)
})

server.listen(PORT, () => {
  console.log(`Serving ${DIR} on http://localhost:${PORT} (Vercel-style SPA routing)`)
})
