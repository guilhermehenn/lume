// Exportar: o ano que abre e o que há nele, nada de arquivo vazio, quantidade sem notação
// científica, nome do backup com a data deste computador, e-mail grande demais barrado antes de
// sair, relatório anual sem dados e no celular (com PGBL e o resultado do ano).

import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { availableYears, defaultTaxYear } from '../../src/data/exporters'
import { createSeedData, saveInvestment, saveTransaction, type InvestmentInput } from '../../src/data/model'
import type { DataState, Transaction } from '../../src/data/types'
import { createVault, DATA_YEAR, expect, mockApi, test } from './fixtures'

const H = { 'X-App-Request': '1' }

async function browserToday(page: Page): Promise<string> {
  return page.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
}

/** Cofre com 3 lançamentos e 2 operações em DATA_YEAR, só uma operação em 2020 e só um lançamento em 2019. */
function exportData(): DataState {
  let s = createSeedData()
  const bank = (name: string) => s.banks.find((b) => b.name === name)!.id
  const cat = (key: string) => s.categories.find((c) => c.nameKey === key)!.id
  const add = (kind: 'expense' | 'income', amount: number, date: string, who: string, key: string) => {
    ;[s] = saveTransaction(s, { kind, amount, date, bankId: bank('Nubank'), categoryId: cat(key), counterparty: who })
  }
  const op = (input: Partial<InvestmentInput> & Pick<InvestmentInput, 'operation' | 'type' | 'amount' | 'date' | 'asset'>, i: number) => {
    ;[s] = saveInvestment(s, { bankId: bank('XP Investimentos'), ...input } as InvestmentInput, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString())
  }
  add('income', 500000, `${DATA_YEAR}-01-05`, 'Salário', 'salary')
  add('expense', 120000, `${DATA_YEAR}-01-10`, 'Zaffari', 'groceries')
  add('expense', 45000, `${DATA_YEAR}-02-10`, 'Café Colombo', 'restaurants')
  add('expense', 9900, '2019-05-10', 'Livraria', 'education')
  op({ operation: 'contribution', type: 'crypto', amount: 5, date: `${DATA_YEAR}-01-12`, asset: 'BTC', quantity: 0.00000001, unitPrice: 500_000_000 }, 0)
  op({ operation: 'contribution', type: 'pension', plan: 'pgbl', amount: 200000, date: `${DATA_YEAR}-01-20`, asset: 'PGBL XP' }, 1)
  op({ operation: 'contribution', type: 'stock', amount: 100000, date: '2020-06-01', asset: 'PETR4', quantity: 100, unitPrice: 1000 }, 2)
  return s
}

async function pickYear(page: Page, year: number) {
  await page.getByRole('button', { name: 'Ano-calendário' }).click()
  await page.getByRole('option', { name: String(year), exact: true }).click()
}

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

test('ano que abre, o que há em cada ano e nada de CSV vazio', async ({ page }) => {
  const s = exportData()
  await createVault(page, { data: s })
  await page.goto('/#/export')
  // Até junho abre o ano anterior (época da declaração); depois, o ano atual.
  const today = await browserToday(page)
  const expected = defaultTaxYear(availableYears(s, new Date(`${today}T12:00:00`)), today)
  await expect(page.getByRole('button', { name: 'Ano-calendário' })).toContainText(String(expected))

  await pickYear(page, DATA_YEAR)
  await expect(page.getByText(`${DATA_YEAR}: 3 lançamentos e 2 operações de investimento.`)).toBeVisible()

  // Quantidade de cripto sai como 0,00000001 (não 1e-8).
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Investimentos', exact: true }).click()
  const csv = readFileSync(await (await download).path(), 'utf8')
  expect(csv).toContain(';0,00000001;')
  expect(csv).not.toMatch(/\de-\d/)

  // 2020 só tem uma operação: o CSV de lançamentos avisa em vez de baixar só o cabeçalho.
  let downloads = 0
  page.on('download', () => downloads++)
  await pickYear(page, 2020)
  await expect(page.getByText('2020: nenhum lançamento e 1 operação de investimento.')).toBeVisible()
  await page.getByRole('button', { name: 'Receitas e despesas' }).click()
  await expect(page.getByText('Não há receitas nem despesas em 2020.')).toBeVisible()
  await pickYear(page, 2019)
  await expect(page.getByText('2019: 1 lançamento e nenhuma operação de investimento.')).toBeVisible()
  await page.getByRole('button', { name: 'Investimentos', exact: true }).click()
  await expect(page.getByText('Não há operações de investimento em 2019.')).toBeVisible()
  expect(downloads).toBe(0)

  // O aviso de privacidade não promete o que o e-mail desmente.
  await expect(page.getByText('Só saem dele se você mandar por e-mail.')).toBeVisible()
})

test.describe('backup à noite', () => {
  test.use({ timezoneId: 'America/Sao_Paulo' })

  test('nome com a data deste computador e JSON compacto que volta igual', async ({ page }) => {
    // 23h30 em Brasília: em Greenwich já é o dia seguinte.
    await page.clock.setFixedTime(new Date('2026-11-21T23:30:00-03:00'))
    const s = exportData()
    await createVault(page, { data: s })
    await page.goto('/#/export')
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Baixar backup (.json)' }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe('lume-backup-2026-11-21.json')
    const text = readFileSync(await file.path(), 'utf8')
    expect(text).not.toContain('\n')
    const backup = JSON.parse(text) as { data: DataState }
    expect(backup.data.transactions.map((t) => t.id).sort()).toEqual(s.transactions.map((t) => t.id).sort())
    expect(backup.data.investments.find((i) => i.asset === 'BTC')?.quantity).toBe(0.00000001)
  })
})

test('e-mail com arquivo grande demais nem sai do computador', async ({ page }) => {
  test.slow()
  const seed = createSeedData()
  const bankId = seed.banks[0].id
  const categoryId = seed.categories.find((c) => c.kind === 'expense')!.id
  const stamp = '2026-01-01T00:00:00.000Z'
  // Uns 18 MB de backup: acima do limite de 15 MB para anexos.
  const transactions: Transaction[] = Array.from({ length: 48_000 }, (_, i) => ({
    id: `t${String(i).padStart(6, '0')}-0000-4000-8000-000000000000`,
    kind: 'expense',
    amount: 1000 + i,
    date: `${DATA_YEAR}-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
    bankId,
    categoryId,
    counterparty: `Mercado do bairro ${i % 300}`,
    paymentMethod: 'pix',
    note: 'compra do mês com observação',
    createdAt: stamp,
    updatedAt: stamp,
  }))
  await createVault(page, { data: { ...seed, transactions } })
  const mail = await page.request.put('/api/account/mail', {
    headers: H,
    data: { provider: 'custom', host: 'localhost', port: 1, security: 'none', username: 'gui@example.com', password: 'senha-de-app' },
  })
  expect(mail.status(), await mail.text()).toBe(200)
  const sends: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/api/mail/send')) sends.push(r.url())
  })
  await page.goto('/#/export')
  await page.getByRole('button', { name: /Enviar por e-mail: Backup do cofre/ }).click()
  await expect(page.getByText(/O arquivo tem 1\d,\d MB e o limite para e-mail é 15 MB\./)).toBeVisible({ timeout: 20_000 })
  expect(sends).toEqual([])
})

test('relatório anual: ano sem dados avisa; no celular nada passa da tela', async ({ page }) => {
  await createVault(page, { data: exportData() })
  await page.goto('/#/print?year=2015')
  await expect(page.getByRole('heading', { name: 'Relatório anual 2015' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Não há lançamentos em 2015.' })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/#/print?year=${DATA_YEAR}`)
  await expect(page.getByRole('heading', { name: `Relatório anual ${DATA_YEAR}` })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Não há lançamentos' })).toHaveCount(0)
  // A página não rola de lado; as tabelas largas rolam dentro do próprio quadro.
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390)
  // Os quatro números do topo cabem nas suas caixas (antes se sobrepunham).
  const kpis = page.locator('article section').first().locator('> div')
  await expect(kpis).toHaveCount(4)
  const boxes = await kpis.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect))
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      const overlap = a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1
      expect(overlap, `caixas ${i} e ${j} se sobrepõem`).toBe(false)
    }
  }
  // PGBL não vai em Bens e Direitos: grupo e código com traço.
  const pgbl = page.getByRole('row').filter({ hasText: 'PGBL XP' })
  await expect(pgbl.getByRole('cell').nth(0)).toHaveText('—')
  await expect(pgbl.getByRole('cell').nth(1)).toHaveText('—')
})
