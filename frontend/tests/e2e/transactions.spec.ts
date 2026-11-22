// Lançamentos: filtros por banco e categoria, totais que não somem com o filtro de tipo, busca
// sem acento e por valor em todos os meses, "Mostrar mais", rótulos dos dias e o endereço como
// fonte da verdade.

import type { Page } from '@playwright/test'
import { createSeedData, saveInvestment, saveTransaction } from '../../src/data/model'
import { addDays } from '../../src/lib/dates'
import type { DataState, Transaction } from '../../src/data/types'
import { createVault, expect, mockApi, test } from './fixtures'

async function browserToday(page: Page): Promise<string> {
  return page.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
}

function builder() {
  let s = createSeedData()
  const bank = (name: string) => s.banks.find((b) => b.name === name)!.id
  const cat = (key: string) => s.categories.find((c) => c.nameKey === key)!.id
  const add = (kind: 'expense' | 'income', amount: number, date: string, who: string, key: string, bankName = 'Nubank', extra: Partial<Transaction> = {}) => {
    ;[s] = saveTransaction(s, { kind, amount, date, bankId: bank(bankName), categoryId: cat(key), counterparty: who, ...extra })
  }
  return {
    get data(): DataState {
      return s
    },
    set data(v: DataState) {
      s = v
    },
    bank,
    add,
  }
}

const pill = (page: Page, label: string) => page.getByText(label, { exact: true }).locator('..')
const row = (page: Page, who: string | RegExp) => page.getByRole('button', { name: who })

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

test.describe('mês com despesas, receitas e investimentos', () => {
  let today = ''

  test.beforeEach(async ({ page }) => {
    today = await browserToday(page)
    const b = builder()
    b.add('income', 500000, today, 'Salário Empresa', 'salary', 'Itaú')
    b.add('expense', 4590, today, 'Café Bom Dia', 'groceries', 'Nubank', { note: 'pão de queijo' })
    b.add('expense', 12000, today, 'Posto Shell', 'transport', 'Itaú')
    b.add('expense', 30000, addDays(today, 1), 'Conta de Luz', 'housing', 'Nubank')
    ;[b.data] = saveInvestment(b.data, { operation: 'contribution', type: 'cdb', amount: 100000, date: today, bankId: b.bank('Nubank'), asset: 'CDB Liquidez', issuer: 'Banco Inter' })
    b.add('expense', 4590, `${String(Number(today.slice(0, 4)) - 1)}-03-10`, 'Café do Ano Passado', 'groceries')
    await createVault(page, { data: b.data })
    await page.goto('/#/transactions')
  })

  test('filtro de tipo não zera os outros totais; banco e categoria ficam no endereço', async ({ page }) => {
    await expect(pill(page, 'Entrou')).toContainText('R$ 5.000,00')
    await expect(pill(page, 'Saiu')).toContainText('R$ 465,90')
    await expect(pill(page, 'Investido')).toContainText('R$ 1.000,00')

    await page.getByRole('radio', { name: 'Despesas' }).click()
    await expect(pill(page, 'Entrou')).toContainText('R$ 5.000,00')
    await expect(row(page, /Salário Empresa/)).toHaveCount(0)
    await expect(row(page, /Café Bom Dia/)).toBeVisible()

    await page.locator('#filter-bank').click()
    await page.getByRole('option', { name: 'Itaú' }).click()
    await expect(page).toHaveURL(/bank=/)
    await expect(row(page, /Posto Shell/)).toBeVisible()
    await expect(row(page, /Café Bom Dia/)).toHaveCount(0)
    await expect(pill(page, 'Saiu')).toContainText('R$ 120,00')
    await expect(pill(page, 'Entrou')).toContainText('R$ 5.000,00')

    // Categoria de despesa some ao trocar para Receitas (não serve para receita).
    await page.locator('#filter-bank').click()
    await page.getByRole('option', { name: 'Todos os bancos' }).click()
    await page.locator('#filter-category').click()
    await page.getByRole('option', { name: 'Mercado', exact: true }).click()
    await expect(page).toHaveURL(/category=/)
    await expect(row(page, /Café Bom Dia/)).toBeVisible()
    await expect(row(page, /Posto Shell/)).toHaveCount(0)
    await page.getByRole('radio', { name: 'Receitas' }).click()
    await expect(page).not.toHaveURL(/category=/)
    await expect(row(page, /Salário Empresa/)).toBeVisible()

    // Recarregar mantém o que está no endereço.
    await page.reload()
    await expect(page.getByRole('radio', { name: 'Receitas' })).toBeChecked()
    await page.getByRole('button', { name: 'Limpar filtros' }).click()
    await expect(page).not.toHaveURL(/kind=|bank=|category=/)
    await expect(row(page, /Posto Shell/)).toBeVisible()
  })

  test('busca sem acento, por categoria, banco e valor, em todos os meses', async ({ page }) => {
    const search = page.getByRole('searchbox')
    await search.fill('cafe')
    await expect(row(page, /Café Bom Dia/)).toBeVisible()
    await expect(row(page, /Café do Ano Passado/)).toBeVisible()
    await expect(page.getByText('2 resultados em todos os meses')).toBeVisible()
    await expect(pill(page, 'Saiu (busca)')).toContainText('R$ 91,80')
    // Busca de outro ano mostra o ano no dia.
    const lastYear = String(Number((await browserToday(page)).slice(0, 4)) - 1)
    await expect(page.getByRole('heading', { name: new RegExp(`10 de março de ${lastYear}`) })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Próximo mês' })).toBeDisabled()

    await search.fill('45,90')
    await expect(page.getByText('2 resultados em todos os meses')).toBeVisible()
    await search.fill('PÃO DE QUEIJO')
    await expect(row(page, /Café Bom Dia/)).toBeVisible()
    await expect(page.getByText('1 resultado em todos os meses')).toBeVisible()
    await search.fill('inter')
    await expect(row(page, /CDB Liquidez/)).toBeVisible()
    await search.fill('itau')
    await expect(row(page, /Posto Shell/)).toBeVisible()
    await expect(row(page, /Salário Empresa/)).toBeVisible()

    await search.fill('nada parecido')
    await expect(page.getByText('Nada encontrado com esses filtros.')).toBeVisible()
    await page.getByRole('button', { name: 'Limpar filtros' }).last().click()
    await expect(search).toHaveValue('')
    await expect(pill(page, 'Entrou')).toBeVisible()
    await expect(row(page, /Café do Ano Passado/)).toHaveCount(0)
  })

  test('dias com Hoje e Amanhã, futuro marcado; endereço com outra busca atualiza a caixa', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Hoje' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Amanhã' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Amanhã' }).getByText('futuro')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Hoje' }).getByText('futuro')).toHaveCount(0)

    await page.getByRole('searchbox').fill('posto')
    await page.goto('/#/transactions?q=luz')
    await expect(page.getByRole('searchbox')).toHaveValue('luz')
    await expect(row(page, /Conta de Luz/)).toBeVisible()
    await expect(row(page, /Posto Shell/)).toHaveCount(0)
  })

  test('o que a tela soma é o que está gravado no cofre', async ({ page }) => {
    await row(page, /Posto Shell/).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Excluir' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir' }).click()
    await expect(row(page, /Posto Shell/)).toHaveCount(0)
    await expect(page.getByText('Salvo no cofre').first()).toBeVisible()

    const response = await page.request.get('/api/vault/data', { headers: { 'X-App-Request': '1' } })
    const { data } = (await response.json()) as { data: DataState }
    const month = today.slice(0, 7)
    const sum = (kind: string) => data.transactions.filter((t) => t.kind === kind && t.date.startsWith(month)).reduce((a, t) => a + t.amount, 0)
    expect(sum('expense')).toBe(4590 + 30000)
    expect(sum('income')).toBe(500000)
    await expect(pill(page, 'Saiu')).toContainText('R$ 345,90')
    await expect(pill(page, 'Entrou')).toContainText('R$ 5.000,00')
  })
})

test('mês com 700 lançamentos: 300 por vez, com "Mostrar mais"', async ({ page }) => {
  const today = await browserToday(page)
  const b = builder()
  const bankId = b.bank('Nubank')
  const categoryId = b.data.categories.find((c) => c.kind === 'expense')!.id
  b.data = {
    ...b.data,
    transactions: Array.from({ length: 700 }, (_, i) => ({
      id: `t${i}`,
      kind: 'expense' as const,
      amount: 100 + i,
      date: `${today.slice(0, 7)}-${String((i % 28) + 1).padStart(2, '0')}`,
      bankId,
      categoryId,
      counterparty: `Loja ${i}`,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })),
  }
  await createVault(page, { data: b.data })
  await page.goto('/#/transactions')
  const rows = page.locator('#main section[aria-label] button')
  await expect(rows).toHaveCount(300)
  await expect(page.getByText('700 lançamentos')).toBeVisible()
  await page.getByRole('button', { name: 'Mostrar mais (400 restantes)' }).click()
  await expect(rows).toHaveCount(600)
  await page.getByRole('button', { name: 'Mostrar mais (100 restantes)' }).click()
  await expect(rows).toHaveCount(700)
  await expect(page.getByRole('button', { name: /Mostrar mais/ })).toHaveCount(0)
  // Trocar o filtro volta ao primeiro bloco.
  await page.getByRole('radio', { name: 'Despesas' }).click()
  await expect(rows).toHaveCount(300)
})

test('endereço com valores inválidos não quebra a tela', async ({ page }) => {
  await createVault(page)
  await page.goto('/#/transactions?month=2026-13&kind=xyz&bank=nao-existe&category=nao-existe')
  await expect(page.getByRole('radio', { name: 'Tudo' })).toBeChecked()
  await expect(page.locator('#filter-bank')).toContainText('Todos os bancos')
  await expect(page.locator('#filter-category')).toContainText('Todas as categorias')
  await expect(page.getByRole('button', { name: 'Limpar filtros' })).toHaveCount(0)
})

test('"/" foca a busca, também vindo de outra tela', async ({ page }) => {
  await createVault(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.keyboard.press('/')
  await expect(page).toHaveURL(/#\/transactions/)
  await expect(page.getByRole('searchbox')).toBeFocused()
  await page.getByRole('searchbox').blur()
  await page.keyboard.press('/')
  await expect(page.getByRole('searchbox')).toBeFocused()
})
