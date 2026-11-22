// Relatórios: números do período com as datas à vista, médias só quando fazem sentido, detalhe
// de uma categoria no personalizado, busca sem acento, filtros mantidos entre abas, relatório
// salvo (período relativo, salvar alterações, salvar como novo, nome repetido), investimentos
// para o IR (PGBL, resultado do ano), celular e impressão.

import type { Page } from '@playwright/test'
import { createSeedData, saveInvestment, saveTransaction, type InvestmentInput } from '../../src/data/model'
import type { DataState } from '../../src/data/types'
import { createVault, expect, mockApi, test } from './fixtures'

async function browserToday(page: Page): Promise<string> {
  return page.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
}

const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

function monthBounds(today: string, delta = 0) {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7)) - 1 + delta
  const first = new Date(Date.UTC(y, m, 1))
  const last = new Date(Date.UTC(y, m + 1, 0))
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) }
}

async function data(page: Page, extra?: (s: DataState, today: string) => DataState): Promise<{ s: DataState; today: string }> {
  const today = await browserToday(page)
  let s = createSeedData()
  const bank = (name: string) => s.banks.find((b) => b.name === name)!.id
  const cat = (key: string) => s.categories.find((c) => c.nameKey === key)!.id
  const add = (kind: 'expense' | 'income', amount: number, date: string, who: string, key: string) => {
    ;[s] = saveTransaction(s, { kind, amount, date, bankId: bank('Nubank'), categoryId: cat(key), counterparty: who })
  }
  const thisMonth = monthBounds(today)
  const lastMonth = monthBounds(today, -1)
  add('income', 500000, thisMonth.from, 'Salário', 'salary')
  add('expense', 120000, thisMonth.from, 'Zaffari', 'groceries')
  add('expense', 45000, thisMonth.from, 'Café Colombo', 'restaurants')
  add('expense', 30000, lastMonth.from, 'Zaffari', 'groceries')
  if (extra) s = extra(s, today)
  return { s, today }
}

// Os cartões de número vêm antes da legenda do gráfico, que repete "Receitas" e "Despesas".
const kpi = (page: Page, label: string) => page.getByText(label, { exact: true }).first().locator('..')

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

test('visão geral: datas do período à vista; médias só com 2 meses ou mais', async ({ page }) => {
  const { s, today } = await data(page)
  await createVault(page, { data: s })
  await page.goto('/#/reports')
  const month = monthBounds(today)
  await expect(page.getByText(`${br(month.from)} a ${br(month.to)}`, { exact: true })).toBeVisible()
  await expect(kpi(page, 'Receitas')).toContainText('R$ 5.000,00')
  await expect(kpi(page, 'Despesas')).toContainText('R$ 1.650,00')
  // Um mês só: o gráfico mostra os 6 meses até ele, e não há "média" que repita o total.
  await expect(page.getByRole('heading', { name: 'Últimos 6 meses' })).toBeVisible()
  await expect(page.getByText('Média mensal de despesas')).toHaveCount(0)

  await page.getByRole('button', { name: 'Período' }).click()
  await page.getByRole('option', { name: 'Últimos 3 meses' }).click()
  await expect(page.getByRole('heading', { name: 'Mês a mês' })).toBeVisible()
  // (1.650 + 300) ÷ 3 meses
  await expect(page.getByText('Média mensal de despesas').locator('..')).toContainText('R$ 650,00')
})

test('por categoria: Enter numa categoria abre o personalizado filtrado, por quem recebeu', async ({ page }) => {
  const { s } = await data(page)
  await createVault(page, { data: s })
  await page.goto('/#/reports?tab=byCategory')
  await expect(page.getByRole('img', { name: /^Mercado / })).toBeVisible()
  await page.getByRole('button', { name: 'Ver o detalhe de Mercado' }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/tab=custom/)
  await expect(page.getByRole('button', { name: 'Categorias' })).toContainText('Mercado')
  await expect(page.getByRole('button', { name: 'Agrupar por' })).toContainText('Pago a / Recebido de')
  await expect(page.getByRole('rowheader', { name: 'Zaffari' })).toBeVisible()
  await expect(page.getByRole('rowheader', { name: 'Café Colombo' })).toHaveCount(0)
})

test('personalizado: busca sem acento, categorias seguem o tipo e os filtros ficam ao trocar de aba', async ({ page }) => {
  const { s } = await data(page)
  await createVault(page, { data: s })
  await page.goto('/#/reports?tab=custom')
  await page.getByPlaceholder('Contém o texto').fill('cafe')
  await expect(page.getByText('1 lançamento encontrado')).toBeVisible()
  await expect(page.getByRole('rowheader', { name: 'Restaurantes e delivery' })).toBeVisible()

  // Com os dois tipos, cada categoria diz de qual é; só Receitas, só as de receita.
  await page.getByRole('button', { name: 'Categorias' }).click()
  await expect(page.getByRole('option', { name: /Mercado.*Despesa/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Tipos' }).click()
  await page.getByRole('option', { name: 'Receitas' }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Categorias' }).click()
  await expect(page.getByRole('option', { name: /^Salário/ })).toBeVisible()
  await expect(page.getByRole('option', { name: /^Mercado/ })).toHaveCount(0)
  await page.keyboard.press('Escape')

  await page.getByRole('radio', { name: 'Visão geral' }).click()
  await page.getByRole('radio', { name: 'Personalizado' }).click()
  await expect(page.getByPlaceholder('Contém o texto')).toHaveValue('cafe')
  await expect(page.getByRole('button', { name: 'Tipos' })).toContainText('Receitas')
  await page.getByRole('button', { name: 'Limpar filtros' }).click()
  await expect(page.getByPlaceholder('Contém o texto')).toHaveValue('')
  await expect(page.getByText('3 lançamentos encontrados')).toBeVisible()
})

test('relatório salvo: "Este mês" acompanha a data; salvar alterações, salvar como novo e nome repetido', async ({ page }) => {
  const { s, today } = await data(page, (state) => ({
    ...state,
    // Salvo num janeiro passado com "Este mês": ao abrir, mostra o mês de hoje.
    reports: [{ id: 'antigo', name: 'Do mês', filters: { from: '2025-01-01', to: '2025-01-31', preset: 'thisMonth', kinds: [], categoryIds: [], bankIds: [] }, groupBy: 'category', createdAt: state.banks[0].createdAt }],
  }))
  await createVault(page, { data: s })
  await page.goto('/#/reports?tab=custom')
  const month = monthBounds(today)
  await page.getByRole('button', { name: 'Do mês', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Do mês', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText(`${br(month.from)} a ${br(month.to)}`, { exact: true })).toBeVisible()
  await expect(page.getByText('3 lançamentos encontrados')).toBeVisible()

  // Aberto: "Salvar alterações" atualiza este; "Salvar como novo" cria outro.
  await page.getByRole('button', { name: 'Agrupar por' }).click()
  await page.getByRole('option', { name: 'Banco' }).click()
  await page.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(page.getByText('Relatório atualizado')).toBeVisible()
  await page.getByRole('button', { name: 'Salvar como novo' }).click()
  await expect(page.getByText('Já existe um relatório com esse nome.')).toBeVisible()
  await page.getByLabel('Nome do relatório').fill('Por banco')
  await page.getByRole('button', { name: 'Salvar como novo' }).click()
  await expect(page.getByText('Relatório salvo')).toBeVisible()

  await expect(page.getByText('Salvo no cofre')).toBeVisible()
  const saved = (await (await page.request.get('/api/vault/data')).json()) as { data: DataState }
  expect(saved.data.reports.map((r) => [r.name, r.groupBy, r.filters.preset])).toEqual([
    ['Do mês', 'bank', 'thisMonth'],
    ['Por banco', 'bank', 'thisMonth'],
  ])
})

test('investimentos: PGBL sem código da ficha e o resultado de vendas no ano', async ({ page }) => {
  const { s, today } = await data(page, (state, now) => {
    let next = state
    const xp = next.banks.find((b) => b.name === 'XP Investimentos')!.id
    const year = Number(now.slice(0, 4))
    const op = (input: Partial<InvestmentInput> & Pick<InvestmentInput, 'operation' | 'type' | 'amount' | 'date'>, i: number) => {
      ;[next] = saveInvestment(next, { asset: '', bankId: xp, ...input } as InvestmentInput, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString())
    }
    op({ operation: 'contribution', type: 'stock', amount: 100000, date: `${year - 1}-06-01`, asset: 'PETR4', quantity: 100, unitPrice: 1000 }, 0)
    op({ operation: 'redemption', type: 'stock', amount: 60000, date: `${year}-01-15`, asset: 'PETR4', quantity: 50, unitPrice: 1200 }, 1)
    op({ operation: 'contribution', type: 'pension', plan: 'pgbl', amount: 200000, date: `${year}-01-20`, asset: 'PGBL XP' }, 2)
    return next
  })
  await createVault(page, { data: s })
  await page.goto('/#/reports?tab=investments')
  const year = today.slice(0, 4)
  // Até junho abre o ano anterior (época do IR); escolhe o ano atual para conferir.
  await page.getByRole('button', { name: 'Ano' }).click()
  await page.getByRole('option', { name: year }).click()
  const table = page.getByRole('table', { name: `Posição em 31/12/${year}` })
  const pgbl = table.getByRole('row').filter({ hasText: 'PGBL XP' })
  await expect(pgbl.getByLabel('PGBL não entra em Bens e Direitos')).toHaveText('—')
  // O que não vai em Bens e Direitos fica no fim da lista.
  await expect(table.locator('tbody tr').last()).toContainText('PGBL XP')
  await expect(table.getByRole('row').filter({ hasText: 'PETR4' })).toContainText('+R$ 100,00')
  await expect(table.getByRole('columnheader', { name: 'Resultado no ano' })).toBeVisible()
})

test('celular: aba numa lista de escolha e números inteiros nos cartões', async ({ page }) => {
  const { s } = await data(page)
  await createVault(page, { data: s })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/reports')
  await expect(page.getByRole('radio', { name: 'Visão geral' })).toBeHidden()
  const income = kpi(page, 'Receitas').getByText('R$ 5.000,00')
  await expect(income).toBeVisible()
  expect(await income.evaluate((el) => (el.parentElement?.scrollWidth ?? 0) <= (el.parentElement?.clientWidth ?? 0))).toBe(true)
  await page.locator('#reports-tab').click()
  await page.getByRole('option', { name: 'Evolução' }).click()
  await expect(page).toHaveURL(/tab=evolution/)
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390)
})

test('impressão: o topo diz a aba e o período', async ({ page }) => {
  const { s, today } = await data(page)
  await createVault(page, { data: s })
  await page.goto('/#/reports')
  await page.emulateMedia({ media: 'print' })
  const month = monthBounds(today)
  await expect(page.getByRole('heading', { name: `Lume · Visão geral · ${br(month.from)} a ${br(month.to)}` })).toBeVisible()
  await page.emulateMedia({ media: 'screen' })
})
