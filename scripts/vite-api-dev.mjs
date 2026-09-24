/**
 * `npm run dev` serves `api/*.js` the way Vercel does.
 *
 * Vite alone serves only the front end, so in development every `/api/...`
 * request — TOBI, push, the tooltip wording — answered 404 and the app said the
 * feature was not available. This dev-only plugin loads the same handler files
 * through Vite's SSR loader and calls them with the small `req.body`,
 * `res.status()` and `res.json()` surface Vercel's Node runtime provides.
 *
 * Server-only variables from `.env` (COHERE_API_KEY and friends) are put on
 * `process.env` for those handlers only. They never reach the browser bundle:
 * Vite still exposes nothing but `VITE_*` to client code. Production builds do
 * not include this plugin at all (`apply: 'serve'`).
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv } from 'vite'

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 1_000_000) req.destroy()
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        resolve({})
      }
    })
  })

export default function apiDev() {
  return {
    name: 'tooltrack-api-dev',
    apply: 'serve',
    configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.root, '')
      for (const [key, value] of Object.entries(env)) {
        if (process.env[key] === undefined) process.env[key] = value
      }

      server.middlewares.use(async (req, res, next) => {
        const match = /^\/api\/([\w-]+)\/?(?:\?.*)?$/.exec(req.url ?? '')
        if (!match) return next()
        const file = join(server.config.root, 'api', `${match[1]}.js`)
        if (!existsSync(file)) return next()

        try {
          const { default: handler } = await server.ssrLoadModule(`/api/${match[1]}.js`)
          req.body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : undefined
          res.status = (code) => {
            res.statusCode = code
            return res
          }
          res.json = (payload) => {
            if (!res.headersSent) res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify(payload))
            return res
          }
          await handler(req, res)
        } catch (err) {
          server.config.logger.error(`[api] /api/${match[1]} failed: ${err?.message}`)
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ error: 'The local API handler failed.' }))
          }
        }
      })
    },
  }
}
