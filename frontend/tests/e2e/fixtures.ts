// Base dos testes E2E: back-end de verdade (pasta de dados temporária), cotações e notícias
// simuladas, um cofre novo por teste e verificação de erros no console/CSP.

import { expect, test as base, type Page } from '@playwright/test'
import { createSeedData } from '../../src/data/model'
import type { DataState } from '../../src/data/types'

export const PASSWORD = 'uma senha de teste'
export const EMAIL = 'gui@example.com'

export const MARKET = {
  updated_at: new Date().toISOString(),
  stale: false,
  quotes: [
    { id: 'USD', value: 5.4321, change_pct: 0.42, currency: 'BRL', as_of: new Date().toISOString(), stale: false },
    { id: 'EUR', value: 6.2011, change_pct: -0.18, currency: 'BRL', as_of: new Date().toISOString(), stale: false },
    { id: 'BTC', value: 512345.67, change_pct: 2.5, currency: 'BRL', as_of: new Date().toISOString(), stale: false },
    { id: 'ETH', value: 18765.4, change_pct: -1.2, currency: 'BRL', as_of: new Date().toISOString(), stale: false },
  ],
  indicators: [
    { id: 'SELIC', value: 15, unit: '% a.a.', as_of: '2026-11-19', stale: false },
    { id: 'CDI', value: 14.9, unit: '% a.a.', as_of: '2026-11-18', stale: false },
    { id: 'IPCA12M', value: 4.68, unit: '%', as_of: '2026-10-01', stale: false },
  ],
  sources: ['AwesomeAPI', 'Banco Central do Brasil (SGS)'],
  errors: [],
}

export const NEWS = {
  updated_at: new Date().toISOString(),
  stale: false,
  errors: [],
  items: [
    { title: 'Ibovespa fecha em alta com bancos e Petrobras', link: 'https://www.infomoney.com.br/mercados/ibovespa-alta/', source: 'InfoMoney', published_at: new Date(Date.now() - 3600_000).toISOString() },
    { title: 'Tesouro Direto: taxas do IPCA+ recuam nesta quinta', link: 'https://www.moneytimes.com.br/tesouro-ipca/', source: 'Money Times', published_at: new Date(Date.now() - 7200_000).toISOString() },
    { title: 'FIIs de logística lideram rendimentos do mês', link: 'https://www.infomoney.com.br/onde-investir/fiis-logistica/', source: 'InfoMoney', published_at: null },
  ],
}

export async function mockApi(page: Page, options: { offline?: boolean } = {}) {
  await page.route('**/api/market**', (route) =>
    options.offline ? route.fulfill({ status: 503, body: '{}' }) : route.fulfill({ json: MARKET }),
  )
  await page.route('**/api/news**', (route) => (options.offline ? route.fulfill({ status: 503, body: '{}' }) : route.fulfill({ json: NEWS })))
}

let counter = 0

export interface CreatedVault {
  vault: { id: string; name: string }
  recoveryCode: string
}

/**
 * Cria um cofre novo pela API e já entra nele (o cookie da sessão fica no contexto do navegador).
 * Assim cada teste começa com dados limpos, sem passar pela tela de criação.
 */
export async function createVault(
  page: Page,
  options: { name?: string; settings?: Record<string, unknown>; data?: DataState; firstName?: string; email?: string; keepRecoveryReminder?: boolean } = {},
): Promise<CreatedVault> {
  const name = options.name ?? `Teste ${process.pid}-${++counter}-${Date.now() % 1_000_000}`
  const response = await page.request.post('/api/vaults', {
    headers: { 'X-App-Request': '1' },
    data: {
      name,
      firstName: options.firstName ?? 'Guilherme',
      lastName: 'Henn',
      email: options.email ?? EMAIL,
      password: PASSWORD,
      data: options.data ?? createSeedData(),
      settings: { language: 'pt', currency: 'BRL', theme: 'dark', onboardingDone: true, ...options.settings },
    },
  })
  expect(response.status(), await response.text()).toBe(201)
  const created = (await response.json()) as CreatedVault
  // Como se o dono já tivesse guardado o código (o lembrete no Início não atrapalha os testes).
  if (options.keepRecoveryReminder !== true) {
    await page.request.post('/api/account/recovery-code/confirm', { headers: { 'X-App-Request': '1' } })
  }
  return created
}

/** Cofre novo, já com as boas-vindas concluídas (para testes que não tratam disso). */
export async function skipOnboarding(page: Page, settings: Record<string, unknown> = {}) {
  return createVault(page, { settings })
}

/** Faz de conta que é o primeiro uso: a lista de cofres vem vazia. */
export async function pretendNoVaults(page: Page) {
  await page.route('**/api/vaults', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: [] }) : route.fallback()))
}

// LUME_E2E_NOW=2027-01-03T12:00:00 roda os testes como se fosse esse dia (relógio do navegador fixo).
const fixedNow = process.env.LUME_E2E_NOW ? new Date(process.env.LUME_E2E_NOW) : null
const now = fixedNow ?? new Date()
export const YEAR = now.getFullYear()
const pad = (n: number) => String(n).padStart(2, '0')
/** Hoje (AAAA-MM-DD) do ponto de vista dos testes: o dia fixado em LUME_E2E_NOW, se houver. */
export const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
/** Mês anterior no formato AAAA-MM. */
export const PREVIOUS_MONTH = (() => {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
})()
/** Ano com certeza coberto pelos dados de exemplo (o do mês anterior, sempre completo). */
export const DATA_YEAR = Number(PREVIOUS_MONTH.slice(0, 4))

/** Mês atual como aparece nas tabelas ("Novembro de 2026"). */
export const CURRENT_MONTH_LABEL = (() => {
  const text = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(now)
  return text.charAt(0).toUpperCase() + text.slice(1)
})()

/** Valor em dinheiro como o Intl formata (espaço não separável depois do símbolo). */
export function brl(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\$]/g, '\\$&').replace(/ /g, '\\s')}$`)
}

/** Carrega os dados de exemplo pela própria interface (Configurações). */
export async function loadSample(page: Page) {
  await page.goto('/#/settings')
  await page.getByRole('button', { name: 'Carregar dados de exemplo' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Carregar dados de exemplo' }).click()
  await expect(page.getByText('Dados de exemplo carregados')).toBeVisible()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
}

export const test = base.extend<{ problems: string[] }>({
  page: async ({ page }, use) => {
    if (fixedNow) await page.clock.setFixedTime(fixedNow)
    // Ao abrir, o app primeiro confere a sessão do cofre: espera a tela de verdade (o app aberto ou
    // a escolha de cofre) para os testes não digitarem atalhos durante a abertura.
    const ready = () => page.locator('#main, [data-gate-ready]').first().waitFor()
    const goto = page.goto.bind(page)
    const reload = page.reload.bind(page)
    page.goto = async (...args: Parameters<Page['goto']>) => {
      const response = await goto(...args)
      await ready()
      return response
    }
    page.reload = async (...args: Parameters<Page['reload']>) => {
      const response = await reload(...args)
      await ready()
      return response
    }
    await use(page)
  },
  problems: [
    async ({ page }, use) => {
      const problems: string[] = []
      page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`))
      page.on('console', (msg) => {
        const text = msg.text()
        // 503 da API simulada "fora do ar" é esperado nesses testes.
        if (msg.type() === 'error' && !/503|Failed to load resource/.test(text)) problems.push(`console: ${text}`)
        if (/Content Security Policy|Refused to/.test(text)) problems.push(`csp: ${text}`)
      })
      await use(problems)
      expect(problems, 'erros no console ou violações de CSP').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
