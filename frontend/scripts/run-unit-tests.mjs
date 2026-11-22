// Testes unitários (regras, cálculos, exportação, traduções) com o executor nativo do Node.
// Os testes em TypeScript são empacotados com esbuild numa pasta temporária e rodados com `node --test`.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const testDir = join(root, 'tests', 'unit')
const only = process.argv.slice(2)
const files = readdirSync(testDir)
  .filter((f) => f.endsWith('.test.ts') && (only.length === 0 || only.some((o) => f.includes(o))))
  .map((f) => join(testDir, f))

if (files.length === 0) {
  console.error('Nenhum teste encontrado.')
  process.exit(1)
}

const outdir = mkdtempSync(join(tmpdir(), 'lume-unit-'))
try {
  await build({
    entryPoints: files,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    jsx: 'automatic',
    outdir,
    outExtension: { '.js': '.mjs' },
    loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"test"' },
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    logLevel: 'warning',
  })
  const outputs = files.map((f) => join(outdir, basename(f).replace(/\.ts$/, '.mjs')))
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...outputs], { stdio: 'inherit', env: { ...process.env, TZ: process.env.TZ ?? 'America/Sao_Paulo' } })
  process.exitCode = result.status ?? 1
} finally {
  rmSync(outdir, { recursive: true, force: true })
}
