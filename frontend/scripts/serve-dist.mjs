// Servidor estático mínimo para testar o build (frontend/dist) sem o back-end.
// Usa os mesmos cabeçalhos de segurança (CSP) do FastAPI, para os testes pegarem violações.
// Uso: node scripts/serve-dist.mjs [porta]   (padrão 4173)
// Chamadas a /api respondem 503; os testes E2E simulam a API com page.route().

import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../dist', import.meta.url)))
const port = Number(process.argv[2] ?? process.env.PORT ?? 4173)

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
  "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; " +
  "frame-ancestors 'none'; form-action 'self'"

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
}

if (!existsSync(join(root, 'index.html'))) {
  console.error('frontend/dist não encontrado. Rode "npm run build" antes.')
  process.exit(1)
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  res.setHeader('content-security-policy', CSP)
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('referrer-policy', 'no-referrer')
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(503, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ detail: 'API indisponível no servidor de teste' }))
    return
  }
  let path = normalize(join(root, decodeURIComponent(url.pathname)))
  if (!path.startsWith(root)) {
    res.writeHead(403).end()
    return
  }
  if (!existsSync(path) || statSync(path).isDirectory()) path = join(root, 'index.html')
  res.writeHead(200, {
    'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
    'cache-control': path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(path).pipe(res)
}).listen(port, '127.0.0.1', () => {
  console.log(`Lume (dist) em http://127.0.0.1:${port}`)
})
