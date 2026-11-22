// Início: saldo de hoje e previsto, próximos lançamentos, resumo do mês, mercado e notícias
// em situações difíceis (sem internet, back-end fora, datas estranhas) e o relógio virando.

import type { Page } from '@playwright/test'
import { createSeedData, saveInvestment, saveTransaction } from '../../src/data/model'
import { addDays } from '../../src/lib/dates'
import { brl, createVault, expect, MARKET, mockApi, NEWS, test } from './fixtures'

/** "Hoje" no relógio e no fuso do navegador dos testes. */
async function browserToday(page: Page): Promise<string> {
  return page.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
}

const balancesCard = (page: Page) => page.locator('section', { has: page.getByRole('heading', { name: 'Saldo nos bancos' }) })
const entriesCard = (page: Page) => page.locator('section', { has: page.getByRole('heading', { name: 'Últimos lançamentos' }) })
const monthCard = (page: Page) => page.locator('section', { has: page.getByRole('heading', { name: /^Resumo de/ }) })

test.describe('com lançamentos de hoje e futuros', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page)
    const today = await browserToday(page)
    let s = createSeedData()
    const bank = (name: string) => s.banks.find((b) => b.name === name)!.id
    const cat = (key: string) => s.categories.find((c) => c.nameKey === key)!.id
    s = { ...s, banks: s.banks.map((b) => (b.name === 'Nubank' ? { ...b, initialBalance: 100000, isPrimary: true } : b)) }
    const add = (kind: 'expense' | 'income', amount: number, date: string, who: string, key: string) => {
      ;[s] = saveTransaction(s, { kind, amount, date, bankId: bank('Nubank'), categoryId: cat(key), counterparty: who })
    }
    add('income', 300000, today, 'Salário de hoje', 'salary')
    add('expense', 45000, today, 'Mercado de hoje', 'groceries')
    add('expense', 120000, addDays(today, 10), 'Aluguel agendado', 'housing')
    add('expense', 9900, addDays(today, 3), 'Academia agendada', 'other_expense')
    ;[s] = saveInvestment(s, { operation: 'contribution', type: 'cdb', amount: 50000, date: addDays(today, 40), bankId: bank('Nubank'), asset: '', issuer: 'Nu' })
    await createVault(page, { data: s })
  })

  test('saldo de hoje, previsto e próximos; Bancos mostra o mesmo', async ({ page }) => {
    await page.goto('/')
    const balances = balancesCard(page)
    // 1.000 + 3.000 − 450 = 3.550 hoje; com os futuros: − 1.200 − 99 − 500 = 1.751
    await expect(balances.getByText('Saldo hoje')).toBeVisible()
    await expect(balances.getByText('R$ 3.550,00').first()).toBeVisible()
    await expect(balances.getByText('Com os lançamentos futuros:')).toBeVisible()
    await expect(balances.getByText('R$ 1.751,00')).toBeVisible()

    const entries = entriesCard(page)
    await expect(entries.getByRole('button', { name: /Mercado de hoje/ })).toBeVisible()
    const upcoming = entries.locator('section', { has: page.getByRole('heading', { name: /Próximos/ }) })
    await expect(upcoming.getByRole('heading', { name: /Próximos/ })).toContainText('3')
    // Os mais próximos primeiro; os futuros não aparecem entre os últimos.
    await expect(upcoming.getByRole('button')).toHaveCount(3)
    await expect(upcoming.getByRole('button').first()).toContainText('Academia agendada')
    await expect(upcoming.getByRole('button').nth(1)).toContainText('Aluguel agendado')
    await expect(entries.getByRole('button', { name: /Aluguel agendado/ })).toHaveCount(1)

    // Ocultar valores esconde também o previsto.
    await page.keyboard.press('h')
    await expect(balances.getByText('R$ 1.751,00')).toHaveCount(0)
    await expect(balances.getByText('•••••').first()).toBeVisible()
    await page.keyboard.press('h')

    await balances.getByRole('link', { name: 'Ver tudo' }).click()
    await expect(page).toHaveURL(/#\/banks/)
    await expect(page.getByText('Saldo hoje')).toBeVisible()
    await expect(page.getByText('R$ 3.550,00').first()).toBeVisible()
    await expect(page.getByText('R$ 1.751,00')).toBeVisible()
  })

  test('Entrou e Saiu levam aos lançamentos do mês já filtrados', async ({ page }) => {
    await page.goto('/')
    const month = monthCard(page)
    await month.getByRole('link', { name: /Entrou/ }).click()
    await expect(page).toHaveURL(/#\/transactions\?kind=income/)
    await expect(page.getByRole('button', { name: /Salário de hoje/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Mercado de hoje/ })).toHaveCount(0)
    await page.goBack()
    await monthCard(page).getByRole('link', { name: /Saiu/ }).click()
    await expect(page).toHaveURL(/#\/transactions\?kind=expense/)
    await expect(page.getByRole('button', { name: /Mercado de hoje/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Salário de hoje/ })).toHaveCount(0)
  })
})

test('mês só com despesas: avisa que não houve receita', async ({ page }) => {
  await mockApi(page)
  const today = await browserToday(page)
  let s = createSeedData()
  const bankId = s.banks[0].id
  ;[s] = saveTransaction(s, { kind: 'expense', amount: 1000, date: today, bankId, categoryId: s.categories.find((c) => c.kind === 'expense')!.id, counterparty: 'Café' })
  await createVault(page, { data: s })
  await page.goto('/')
  await expect(monthCard(page).getByText('Nenhuma receita neste mês ainda.')).toBeVisible()
  await expect(monthCard(page).getByText('Nenhum lançamento neste mês.')).toHaveCount(0)
})

test('cofre sem bancos: explica e leva ao cadastro', async ({ page }) => {
  await mockApi(page)
  await createVault(page, { data: { ...createSeedData(), banks: [] } })
  await page.goto('/')
  const balances = balancesCard(page)
  await expect(balances.getByText('Cadastre seus bancos para ver os saldos aqui.')).toBeVisible()
  await balances.getByRole('link', { name: 'Cadastrar banco' }).click()
  await expect(page).toHaveURL(/#\/banks/)
})

test.describe('mercado e notícias', () => {
  test('primeira vez sem internet: aviso de sem conexão, não uma seção vazia', async ({ page }) => {
    await mockApi(page)
    await page.route('**/api/market**', (route) =>
      route.fulfill({ json: { updated_at: null, stale: true, quotes: [], indicators: [], sources: MARKET.sources, errors: ['cotações: sem internet'] } }),
    )
    await page.route('**/api/news**', (route) => route.fulfill({ json: { updated_at: null, stale: true, items: [], errors: ['InfoMoney: sem internet'] } }))
    await createVault(page)
    await page.goto('/')
    await expect(page.getByText('Sem conexão com as cotações agora.')).toBeVisible()
    await expect(page.getByText('Não deu para buscar as notícias agora.')).toBeVisible()
  })

  test('back-end cai depois: os valores ficam, com o aviso de desatualizado; fontes aparecem', async ({ page }) => {
    await mockApi(page)
    await createVault(page)
    let down = false
    await page.route('**/api/market**', (route) => (down ? route.fulfill({ status: 503, body: '{}' }) : route.fulfill({ json: MARKET })))
    await page.goto('/')
    const market = page.locator('section[aria-labelledby="market-title"]')
    await expect(market.getByText('R$ 5,43')).toBeVisible()
    await expect(market.getByText('Fontes: AwesomeAPI · Banco Central do Brasil (SGS)')).toBeVisible()
    await expect(market.getByRole('img', { name: 'Pode estar desatualizado' })).toHaveCount(0)
    down = true
    await market.getByRole('button', { name: 'Atualizar' }).click()
    await expect(market.getByRole('img', { name: 'Pode estar desatualizado' })).toBeVisible()
    await expect(market.getByText('R$ 5,43')).toBeVisible()
  })

  test('voltar ao Início não pisca nem busca de novo logo em seguida', async ({ page }) => {
    await mockApi(page)
    await createVault(page)
    let calls = 0
    page.on('request', (r) => {
      if (r.url().includes('/api/market')) calls++
    })
    await page.goto('/')
    const market = page.locator('section[aria-labelledby="market-title"]')
    await expect(market.getByText('R$ 5,43')).toBeVisible()
    expect(calls).toBe(1)
    await page.getByRole('link', { name: 'Lançamentos' }).first().click()
    await expect(page).toHaveURL(/#\/transactions/)
    await page.getByRole('link', { name: 'Início' }).first().click()
    // Já aparece com os valores (sem esqueleto) e sem nova busca.
    await expect(market.getByText('R$ 5,43')).toBeVisible()
    await expect(market).not.toHaveAttribute('aria-busy', 'true')
    expect(calls).toBe(1)
  })

  test('notícia com data no futuro aparece como "agora"', async ({ page }) => {
    await mockApi(page)
    // "Futuro" no relógio do navegador (que pode estar fixo em outra data nos testes).
    const browserNow = await page.evaluate(() => Date.now())
    await page.route('**/api/news**', (route) =>
      route.fulfill({
        json: { ...NEWS, items: [{ ...NEWS.items[0], published_at: new Date(browserNow + 3 * 3600_000).toISOString() }] },
      }),
    )
    await createVault(page)
    await page.goto('/')
    const link = page.getByRole('link', { name: /Ibovespa fecha em alta/ })
    await expect(link).toContainText('agora')
    await expect(link).not.toContainText('em 3')
    await expect(link).toHaveAccessibleName(/abre em outra aba/)
  })
})

test.describe('relógio', () => {
  test.skip(Boolean(process.env.LUME_E2E_NOW), 'usa o próprio relógio')

  test('a saudação, a data e o mês do resumo acompanham a hora com o app aberto', async ({ page }) => {
    await mockApi(page)
    await page.clock.install({ time: new Date('2026-11-30T17:59:00-03:00') })
    await createVault(page)
    await page.goto('/')
    const h1 = page.getByRole('heading', { level: 1 })
    await expect(h1).toContainText('Boa tarde')
    await expect(page.getByText('segunda-feira, 30 de novembro')).toBeVisible()
    await page.clock.fastForward('02:00')
    await expect(h1).toContainText('Boa noite')

    await page.clock.fastForward('06:00:00')
    await expect(page.getByText('terça-feira, 1 de dezembro')).toBeVisible()
    await expect(page.getByRole('heading', { name: /^Resumo de dezembro/ })).toBeVisible()
  })
})

test('boas-vindas: nada escolhido por palpite, Pular fecha e não volta', async ({ page }) => {
  await mockApi(page)
  await createVault(page, { settings: { onboardingDone: false } })
  await page.goto('/')
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByText('Boas-vindas ao Lume')).toBeVisible()
  await expect(sheet.locator('#onb-bank')).toContainText('Selecione')
  await expect(sheet.getByRole('button', { name: 'Começar' })).toBeDisabled()
  await sheet.getByRole('button', { name: 'Pular' }).click()
  await expect(sheet).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText('Boas-vindas ao Lume')).toHaveCount(0)
  // Nenhum banco virou principal sem a pessoa escolher.
  await expect(balancesCard(page).getByText(brl('R$ 0,00')).first()).toBeVisible()
})
