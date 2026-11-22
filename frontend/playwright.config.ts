import { defineConfig, devices } from '@playwright/test'

// Testes de ponta a ponta no build (frontend/dist) servido pelo back-end de verdade, com uma pasta
// de dados temporária (scripts/e2e-server.mjs). Cotações e notícias são simuladas (page.route).
// Navegador: Edge no Windows, Chrome nos demais. Para outro: LUME_BROWSER=chrome|msedge
// ou LUME_CHROME_PATH=/caminho/do/navegador.

const executablePath = process.env.LUME_CHROME_PATH
const channel = executablePath ? undefined : (process.env.LUME_BROWSER ?? (process.platform === 'win32' ? 'msedge' : 'chrome'))

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  timeout: 60_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    colorScheme: 'dark',
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], channel, viewport: { width: 1440, height: 900 }, launchOptions: executablePath ? { executablePath } : {} },
    },
  ],
  webServer: {
    command: 'node scripts/e2e-server.mjs 4173',
    url: 'http://127.0.0.1:4173/api/health',
    reuseExistingServer: false,
    timeout: 90_000,
  },
})
