// Investimentos: carteira até hoje, resgate de renda fixa com ganho, posição encerrada, filtro por
// tipo, código do IR do ETF, resgate com a quantidade em carteira e CNPJ alfanumérico.

import type { Page } from '@playwright/test'
import { createSeedData, saveInvestment, type InvestmentInput } from '../../src/data/model'
import { addDays } from '../../src/lib/dates'
import type { DataState } from '../../src/data/types'
import { createVault, expect, mockApi, test } from './fixtures'

async function browserToday(page: Page): Promise<string> {
  return page.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
}

const card = (page: Page, label: string) => page.getByText(label, { exact: true }).locator('..')
// Só o botão que abre/fecha a posição (as operações dentro dela também começam pelo ativo).
const position = (page: Page, asset: string) =>
  page.locator('button[aria-expanded]').filter({ has: page.getByText(asset, { exact: true }) })

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  const today = await browserToday(page)
  let s: DataState = createSeedData()
  const xp = s.banks.find((b) => b.name === 'XP Investimentos')!.id
  let n = 0
  const op = (input: Partial<InvestmentInput> & Pick<InvestmentInput, 'operation' | 'type' | 'amount' | 'date'>) => {
    ;[s] = saveInvestment(s, { asset: '', bankId: xp, ...input } as InvestmentInput, new Date(Date.UTC(2026, 0, 1, 0, 0, n++)).toISOString())
  }
  const ago = (days: number) => addDays(today, -days)
  op({ operation: 'contribution', type: 'stock', amount: 100000, date: ago(60), asset: 'PETR4', quantity: 100, unitPrice: 1000 })
  op({ operation: 'contribution', type: 'etf', amount: 50000, date: ago(50), asset: 'BOVA11', quantity: 5, unitPrice: 10000 })
  op({ operation: 'contribution', type: 'cdb', amount: 100000, date: ago(40), asset: 'CDB Banco X' })
  op({ operation: 'redemption', type: 'cdb', amount: 110000, date: ago(10), asset: 'CDB Banco X' })
  // Aplicação agendada: ainda não entra na carteira.
  op({ operation: 'contribution', type: 'stock', amount: 30000, date: addDays(today, 5), asset: 'PETR4', quantity: 30, unitPrice: 1000 })
  await createVault(page, { data: s })
  await page.goto('/#/investments')
})

test('carteira até hoje, resgate acima do custo vira ganho e posição encerrada mostra o resultado', async ({ page }) => {
  // PETR4 1.000 + BOVA11 500 (o CDB foi resgatado; a aplicação agendada não conta).
  await expect(card(page, 'Total investido')).toContainText('R$ 1.500,00')
  await expect(card(page, 'Resultado em vendas e resgates')).toContainText('R$ 100,00')
  await expect(page.getByText('1 operação com data futura ainda não entra na carteira.')).toBeVisible()
  await expect(position(page, 'CDB Banco X')).toHaveCount(0)

  await page.getByRole('button', { name: 'Mostrar 1 encerrada' }).click()
  const cdb = position(page, 'CDB Banco X')
  await expect(cdb).toContainText('Encerrada')
  await expect(cdb).toContainText('+R$ 100,00')
  await expect(cdb).toContainText('Resultado')
})

test('tipo escolhido no gráfico filtra a carteira; ETF com o código do IR 2026', async ({ page }) => {
  const etf = position(page, 'BOVA11')
  await expect(etf.getByLabel('Imposto de Renda: Bens e Direitos, grupo 07, código 06')).toBeVisible()
  await expect(etf).toContainText('07 · 06')

  await page.getByRole('button', { name: /^Ações/ }).click()
  await expect(page.getByRole('button', { name: /^Ações/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(position(page, 'PETR4')).toBeVisible()
  await expect(position(page, 'BOVA11')).toHaveCount(0)
  await page.getByRole('button', { name: 'Mostrar todos os tipos (tirar o filtro Ações)' }).click()
  await expect(position(page, 'BOVA11')).toBeVisible()

  // Pelo teclado: o foco destaca o tipo no gráfico e Enter filtra.
  await page.getByRole('button', { name: /^ETF/ }).focus()
  await page.keyboard.press('Enter')
  await expect(position(page, 'PETR4')).toHaveCount(0)
})

test('resgate: o formulário mostra quanto há em carteira e avisa quando passa', async ({ page }) => {
  await position(page, 'PETR4').click()
  await page.getByRole('button', { name: 'Resgate' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('heading', { name: 'Novo investimento' })).toBeVisible()
  await expect(sheet.locator('#inv-asset')).toHaveValue('PETR4')
  await expect(sheet.getByText('Em carteira nessa data: 100')).toBeVisible()
  await sheet.locator('#inv-qty').fill('150')
  await expect(sheet.getByText('Mais do que havia em carteira nessa data (100). O resultado conta só o que existia.')).toBeVisible()
  await sheet.locator('#inv-qty').fill('40')
  await expect(sheet.getByText('Em carteira nessa data: 100')).toBeVisible()
  await sheet.locator('#inv-price').click()
  await page.keyboard.type('1200')
  await sheet.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(sheet).toHaveCount(0)
  await expect(position(page, 'PETR4')).toContainText('60 × R$ 10,00')
  // 40 × R$ 12 − 40 × R$ 10 (custo médio): R$ 80 de PETR4 + R$ 100 do CDB. O painel aberto da posição
  // repete o rótulo com o resultado só de PETR4.
  await expect(card(page, 'Resultado em vendas e resgates').first()).toContainText('R$ 180,00')
  await expect(page.getByRole('listitem').filter({ has: position(page, 'PETR4') })).toContainText('R$ 80,00')
})

test('CNPJ alfanumérico e taxas maiores que o valor', async ({ page }) => {
  await page.getByRole('button', { name: 'Nova operação' }).first().click()
  const sheet = page.getByRole('dialog')
  await sheet.locator('#inv-type').click()
  await page.getByRole('option', { name: /Fundos imobiliários/ }).click()
  await sheet.locator('#inv-asset').fill('NOVO11')
  await sheet.locator('#inv-cnpj').fill('12abc34501de35')
  await expect(sheet.locator('#inv-cnpj')).toHaveValue('12.ABC.345/01DE-35')
  await sheet.locator('#inv-qty').fill('10')
  await sheet.locator('#inv-price').click()
  await page.keyboard.type('1000')
  await sheet.locator('#inv-fees').click()
  await page.keyboard.type('20000')
  await sheet.locator('#entry-amount').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.type('5000')
  await sheet.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(sheet.getByText('As taxas não podem passar do valor da aplicação.')).toBeVisible()
  await sheet.locator('#inv-fees').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('0')
  await sheet.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(sheet).toHaveCount(0)
  await expect(position(page, 'NOVO11')).toBeVisible()
})
