// Back-end de verdade para os testes E2E: FastAPI servindo o build (frontend/dist) numa pasta de
// dados temporária, apagada ao sair. Os cofres criados nos testes nunca tocam nos seus dados.
// Uso: node scripts/e2e-server.mjs [porta]   (padrão 4173)
// Por padrão roda com "uv run" na pasta backend/. Para usar outro Python: LUME_E2E_PYTHON=python3

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const backend = resolve(root, '..', 'backend')
const port = String(process.argv[2] ?? process.env.PORT ?? 4173)

if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.error('frontend/dist não encontrado. Rode "npm run build" antes.')
  process.exit(1)
}

const dataDir = mkdtempSync(join(tmpdir(), 'lume-e2e-'))
const uvicorn = ['-m', 'uvicorn', 'app.main:create_app', '--factory', '--host', '127.0.0.1', '--port', port, '--log-level', 'warning']
const python = process.env.LUME_E2E_PYTHON
const [command, args] = python ? [python, uvicorn] : ['uv', ['run', '--frozen', 'python', ...uvicorn]]

const child = spawn(command, args, {
  cwd: backend,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, APP_DATA_DIR: dataDir, APP_OPEN_BROWSER: 'false', APP_LOG_LEVEL: 'WARNING', APP_BACKUP_EXTRA_DIR: '' },
})

let cleaned = false
function cleanup() {
  if (cleaned) return
  cleaned = true
  try {
    rmSync(dataDir, { recursive: true, force: true })
  } catch {
    /* o Windows pode segurar o arquivo por um instante */
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill()
    setTimeout(() => {
      cleanup()
      process.exit(0)
    }, 300)
  })
}
child.on('exit', (code) => {
  cleanup()
  process.exit(code ?? 0)
})
