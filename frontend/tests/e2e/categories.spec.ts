// Categorias: total do mês e aba de receitas no endereço; cadastro (grade de ícones em várias
// colunas, teclado, nomes traduzidos, nome repetido, descartar); tipo travado também pelo
// teclado; exclusão com "Outras despesas" sugerida; "Ver lançamentos"; e restaurar um backup de
// versão anterior, que precisa voltar como era.

import type { Page } from '@playwright/test'
import { createSeedData, saveReport, saveTransaction } from '../../src/data/model'
import type { DataState } from '../../src/data/types'
import { createVault, expect, mockApi, test } from './fixtures'

async function browserToday(page: Page): Promise<string> {
  return page.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
}

const card = (page: Page, name: string) => page.locator('#main li').filter({ has: page.getByText(name, { exact: true }) })

async function openMenu(page: Page, name: string, item: string) {
  await card(page, name).getByRole('button', { name: 'Mais opções' }).click()
  await page.getByRole('menuitem', { name: item }).click()
}

async function data(page: Page): Promise<DataState> {
  const today = await browserToday(page)
  let s = createSeedData()
  const bank = s.banks.find((b) => b.name === 'Nubank')!.id
  const cat = (key: string) => s.categories.find((c) => c.nameKey === key)!.id
  const add = (key: string, amount: number, who: string, kind: 'expense' | 'income' = 'expense') => {
    ;[s] = saveTransaction(s, { kind, amount, date: today, bankId: bank, categoryId: cat(key), counterparty: who })
  }
  add('groceries', 12000, 'Zaffari')
  add('groceries', 4590, 'Padaria')
  add('salary', 500000, 'Salário', 'income')
  ;[s] = saveReport(s, { name: 'Só mercado', filters: { kinds: [], categoryIds: [cat('groceries')], bankIds: [] }, groupBy: 'month' })
  return s
}

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

test.describe('com lançamentos no mês', () => {
  test.beforeEach(async ({ page }) => {
    await createVault(page, { data: await data(page) })
    await page.goto('/#/categories')
  })

  test('total do mês em cada categoria; a aba de receitas fica no endereço', async ({ page }) => {
    await expect(card(page, 'Mercado')).toContainText('2 lançamentos')
    await expect(card(page, 'Mercado')).toContainText('R$ 165,90')
    await expect(card(page, 'Outras despesas')).toContainText('Sem lançamentos')
    // "Outras despesas" fica no fim da lista.
    await expect(page.locator('#main li').last()).toContainText('Outras despesas')

    await page.getByRole('radio', { name: 'Receitas' }).click()
    await expect(page).toHaveURL(/#\/categories\?kind=income/)
    await expect(card(page, 'Salário')).toContainText('R$ 5.000,00')
    await page.reload()
    await expect(page.getByRole('radio', { name: 'Receitas' })).toHaveAttribute('aria-checked', 'true')
    await expect(card(page, 'Salário')).toBeVisible()
  })

  test('cadastro: grade de ícones em várias colunas, teclado, nome repetido e descartar', async ({ page }) => {
    await page.getByRole('button', { name: 'Nova categoria' }).first().click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.locator('#cat-name')).toBeFocused()

    const icons = sheet.getByRole('radiogroup', { name: 'Ícone' })
    const first = await icons.getByRole('radio').nth(0).boundingBox()
    const second = await icons.getByRole('radio').nth(1).boundingBox()
    expect(second!.y).toBe(first!.y) // lado a lado, não uma coluna só
    expect(second!.x).toBeGreaterThan(first!.x)
    // Um só ponto de parada no Tab; as setas trocam o ícone.
    await expect(icons.locator('[tabindex="0"]')).toHaveCount(1)
    await icons.getByRole('radio', { name: 'Etiqueta' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(icons.getByRole('radio', { name: 'Chave', exact: true })).toHaveAttribute('aria-checked', 'true')
    await expect(icons.getByRole('radio', { name: 'Chave', exact: true })).toBeFocused()
    await expect(sheet.getByRole('radiogroup', { name: 'Cor' }).getByRole('radio', { name: 'Azul', exact: true })).toBeVisible()

    // "Groceries" é o nome em inglês de "Mercado": repetido.
    await sheet.locator('#cat-name').fill('Groceries')
    await sheet.getByRole('button', { name: 'Salvar', exact: true }).click()
    await expect(sheet.getByText('Já existe uma categoria desse tipo com esse nome.')).toBeVisible()
    await expect(sheet.locator('#cat-name')).toBeFocused()

    await sheet.locator('#cat-name').fill('Academia')
    await icons.getByRole('radio', { name: 'Haltere' }).click()
    await sheet.getByRole('button', { name: 'Salvar', exact: true }).click()
    await expect(page.getByText('Categoria salva')).toBeVisible()
    await expect(card(page, 'Academia')).toBeVisible()

    await page.getByRole('button', { name: 'Nova categoria' }).first().click()
    await sheet.locator('#cat-name').fill('Rascunho')
    await page.keyboard.press('Escape')
    const confirm = page.getByRole('alertdialog')
    await expect(confirm.getByRole('heading', { name: 'Descartar esta categoria?' })).toBeVisible()
    await confirm.getByRole('button', { name: 'Descartar' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(card(page, 'Rascunho')).toHaveCount(0)
  })

  test('tipo travado de verdade quando a categoria já tem lançamentos', async ({ page }) => {
    await card(page, 'Mercado').getByRole('button').first().click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByText('Já tem lançamentos: o tipo não pode mudar.')).toBeVisible()
    await expect(sheet.getByRole('radio', { name: 'Receita', exact: true })).toBeDisabled()
    await expect(sheet.getByRole('radio', { name: 'Despesa', exact: true })).toBeDisabled()
    // Nem pelo teclado.
    await sheet.getByRole('radiogroup', { name: 'Tipo' }).dispatchEvent('keydown', { key: 'ArrowRight' })
    await expect(sheet.getByRole('radio', { name: 'Despesa', exact: true })).toHaveAttribute('aria-checked', 'true')
  })

  test('excluir: "Outras despesas" sugerida, relatório salvo segue a escolhida, Desfazer', async ({ page }) => {
    await openMenu(page, 'Mercado', 'Excluir')
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('2 lançamentos usam esta categoria. Escolha outra para eles.')
    await expect(dialog.getByRole('button', { name: 'Mover lançamentos para' })).toContainText('Outras despesas')
    await dialog.getByRole('button', { name: 'Mover e excluir' }).click()
    await expect(page.getByText('Categoria excluída. 2 lançamentos foram para Outras despesas.')).toBeVisible()
    await expect(card(page, 'Mercado')).toHaveCount(0)
    await expect(card(page, 'Outras despesas')).toContainText('R$ 165,90')

    await expect(page.getByText('Salvo no cofre')).toBeVisible()
    const saved = (await (await page.request.get('/api/vault/data')).json()) as { data: DataState }
    const other = saved.data.categories.find((c) => c.nameKey === 'other_expense')!
    expect(saved.data.reports[0].filters.categoryIds).toEqual([other.id])
    expect(saved.data.transactions.filter((t) => t.kind === 'expense').every((t) => t.categoryId === other.id)).toBe(true)

    await page.getByRole('button', { name: 'Desfazer' }).click()
    await expect(card(page, 'Mercado')).toContainText('2 lançamentos')
  })

  test('celular: os cartões cabem na tela, com o menu à vista', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(card(page, 'Mercado')).toBeVisible()
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390)
    const menu = await card(page, 'Mercado').getByRole('button', { name: 'Mais opções' }).boundingBox()
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(390)
  })

  test('"Ver lançamentos" abre a lista filtrada pela categoria', async ({ page }) => {
    await openMenu(page, 'Mercado', 'Ver lançamentos')
    await expect(page).toHaveURL(/#\/transactions\?.*category=/)
    await expect(page.locator('#filter-category')).toContainText('Mercado')
    await expect(page.getByText('Zaffari')).toBeVisible()
    await expect(page.getByText('Salário')).toHaveCount(0)
  })
})

test('única categoria do tipo com lançamentos: explica que é preciso outra antes', async ({ page }) => {
  const s = await data(page)
  const salary = s.categories.find((c) => c.nameKey === 'salary')!
  await createVault(page, { data: { ...s, categories: s.categories.filter((c) => c.kind === 'expense' || c.id === salary.id) } })
  await page.goto('/#/categories?kind=income')
  await openMenu(page, 'Salário', 'Excluir')
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('não há outra do mesmo tipo para recebê-lo')
  await expect(dialog.getByRole('button', { name: 'Mover e excluir' })).toBeDisabled()
})

test('restaurar backup de versão anterior: volta como era, sem ser recusado ao gravar', async ({ page }) => {
  const s = await data(page)
  // O que versões anteriores gravavam e os formulários de hoje não aceitariam: código de banco
  // com 1 dígito, bancos e categorias com o mesmo nome.
  const nubank = s.banks.find((b) => b.name === 'Nubank')!
  const legacy: DataState = {
    ...s,
    banks: [...s.banks.map((b) => (b.id === nubank.id ? { ...b, code: '1' } : b)), { ...nubank, id: 'legado-banco', name: 'nubank', isPrimary: false }],
    categories: [
      ...s.categories,
      { id: 'legado-1', kind: 'expense', name: 'Academia', icon: 'dumbbell', color: '#FF453A', createdAt: s.banks[0].createdAt, updatedAt: s.banks[0].createdAt },
      { id: 'legado-2', kind: 'expense', name: 'academia', icon: 'dumbbell', color: '#FF453A', createdAt: s.banks[0].createdAt, updatedAt: s.banks[0].createdAt },
    ],
  }
  await createVault(page, {})
  await page.goto('/#/settings')
  const file = JSON.stringify({ app: 'lume', format: 1, exportedAt: '2026-06-01T10:00:00.000Z', data: legacy })
  await page.locator('input[type=file]').setInputFiles({ name: 'antigo.json', mimeType: 'application/json', buffer: Buffer.from(file) })
  await page.getByRole('alertdialog').getByRole('button', { name: 'Restaurar backup' }).click()
  await expect(page.getByText('Backup restaurado')).toBeVisible()
  await expect(page.getByText('Salvo no cofre')).toBeVisible()
  await expect(page.getByText('Não deu para salvar a última alteração.', { exact: false })).toHaveCount(0)
  const saved = (await (await page.request.get('/api/vault/data')).json()) as { data: DataState }
  expect(saved.data.banks.find((b) => b.id === nubank.id)!.code).toBe('1')
  expect(saved.data.banks.some((b) => b.id === 'legado-banco')).toBe(true)
  expect(saved.data.categories.filter((c) => c.id.startsWith('legado-'))).toHaveLength(2)
})
