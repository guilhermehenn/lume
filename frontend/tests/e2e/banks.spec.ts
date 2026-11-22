// Bancos: lista com os sem uso recolhidos, busca sem acento e pelo código, cadastro (nome
// repetido, código COMPE, dinheiro sem código, descartar), exclusão como junção (saldo total
// igual, saldo inicial e principal indo junto), "Ver lançamentos" e o selo no celular.

import type { Page } from '@playwright/test'
import { createSeedData, saveTransaction } from '../../src/data/model'
import type { DataState } from '../../src/data/types'
import { createVault, expect, mockApi, test } from './fixtures'

const row = (page: Page, name: string) => page.locator('#main li').filter({ has: page.getByText(name, { exact: true }) })
const total = (page: Page) => page.getByText('Saldo hoje', { exact: true }).locator('..')

async function openMenu(page: Page, name: string, item: string) {
  await row(page, name).getByRole('button', { name: 'Mais opções' }).click()
  await page.getByRole('menuitem', { name: item }).click()
}

function data(): DataState {
  let s = createSeedData()
  const id = (name: string) => s.banks.find((b) => b.name === name)!.id
  const cat = (key: string) => s.categories.find((c) => c.nameKey === key)!.id
  s = {
    ...s,
    banks: s.banks.map((b) =>
      b.name === 'Nubank' ? { ...b, initialBalance: 450000, isPrimary: true } : b.name === 'Safra' ? { ...b, initialBalance: 7000 } : b,
    ),
  }
  ;[s] = saveTransaction(s, { kind: 'income', amount: 500000, date: '2026-01-05', bankId: id('Nubank'), categoryId: cat('salary'), counterparty: 'Salário' })
  ;[s] = saveTransaction(s, { kind: 'expense', amount: 12000, date: '2026-01-10', bankId: id('Nubank'), categoryId: cat('groceries'), counterparty: 'Zaffari' })
  ;[s] = saveTransaction(s, { kind: 'expense', amount: 3000, date: '2026-01-11', bankId: id('Itaú'), categoryId: cat('groceries'), counterparty: 'Padaria' })
  return s
}

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

test.describe('com bancos em uso', () => {
  test.beforeEach(async ({ page }) => {
    await createVault(page, { data: data() })
    await page.goto('/#/banks')
  })

  test('em uso primeiro, sem uso recolhidos; busca sem acento e pelo código', async ({ page }) => {
    // Nubank 4.500 + 5.000 − 120; Itaú −30; Safra 70.
    await expect(total(page)).toContainText('R$ 9.420,00')
    await expect(page.getByRole('heading', { name: 'Em uso' })).toBeVisible()
    await expect(row(page, 'Nubank')).toContainText('Principal')
    await expect(row(page, 'Nubank')).toContainText('Banco digital · 2 lançamentos · Cód. 260')
    await expect(row(page, 'Safra')).toContainText('R$ 70,00')
    await expect(row(page, 'Banco BV')).toHaveCount(0)

    const toggle = page.getByRole('button', { name: 'Mostrar 15 bancos sem uso' })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    await expect(row(page, 'Banco BV')).toBeVisible()
    await page.getByRole('button', { name: 'Ocultar bancos sem uso' }).click()
    await expect(row(page, 'Banco BV')).toHaveCount(0)

    const search = page.getByPlaceholder('Buscar banco')
    await search.fill('itau')
    await expect(page.locator('#main li')).toHaveCount(1)
    await expect(row(page, 'Itaú')).toBeVisible()
    await search.fill('237')
    await expect(row(page, 'Bradesco')).toBeVisible()
    await search.fill('zzz')
    await expect(page.getByText('Nada encontrado')).toBeVisible()
    await page.getByRole('button', { name: 'Limpar busca' }).click()
    await expect(search).toHaveValue('')
    await expect(row(page, 'Nubank')).toBeVisible()
  })

  test('cadastro: nome repetido, código com 3 dígitos, dinheiro sem código e descartar', async ({ page }) => {
    await page.getByRole('button', { name: 'Novo banco' }).first().click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.locator('#bank-name')).toBeFocused()
    await sheet.locator('#bank-name').fill('itau')
    await sheet.getByRole('button', { name: 'Salvar', exact: true }).click()
    await expect(sheet.getByText('Já existe um banco com esse nome.')).toBeVisible()
    await expect(sheet.locator('#bank-name')).toBeFocused()

    await sheet.locator('#bank-name').fill('Itaú PJ')
    await expect(sheet.getByText('Já existe um banco com esse nome.')).toHaveCount(0)
    await sheet.locator('#bank-code').fill('1')
    await sheet.locator('#bank-code').blur()
    await expect(sheet.locator('#bank-code')).toHaveValue('001')
    await sheet.getByRole('button', { name: 'Salvar', exact: true }).click()
    await expect(page.getByText('Banco salvo')).toBeVisible()
    await page.getByPlaceholder('Buscar banco').fill('pj')
    await expect(row(page, 'Itaú PJ')).toContainText('Cód. 001')
    await page.getByPlaceholder('Buscar banco').fill('')

    // Dinheiro em espécie não tem código; fechar com algo preenchido pergunta antes.
    await page.getByRole('button', { name: 'Novo banco' }).first().click()
    await sheet.locator('#bank-name').fill('Carteira')
    await sheet.locator('#bank-kind').click()
    await page.getByRole('option', { name: 'Dinheiro em espécie' }).click()
    await expect(sheet.locator('#bank-code')).toHaveCount(0)
    await page.keyboard.press('Escape')
    const confirm = page.getByRole('alertdialog')
    await expect(confirm.getByRole('heading', { name: 'Descartar este banco?' })).toBeVisible()
    await confirm.getByRole('button', { name: 'Continuar editando' }).click()
    await expect(sheet.locator('#bank-name')).toHaveValue('Carteira')
    await sheet.getByRole('button', { name: 'Cancelar' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Descartar' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByPlaceholder('Buscar banco').fill('carteira')
    await expect(page.getByText('Nada encontrado')).toBeVisible()
  })

  test('excluir o principal com lançamentos: junção sem mudar o saldo total', async ({ page }) => {
    await expect(total(page)).toContainText('R$ 9.420,00')
    await openMenu(page, 'Nubank', 'Excluir')
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('2 lançamentos usam este banco. Escolha para onde eles vão.')
    await expect(dialog).toContainText('O saldo inicial (R$ 4.500,00) vai junto.')
    await expect(dialog).toContainText('O banco escolhido passa a ser o principal.')
    await expect(dialog.getByRole('button', { name: 'Mover e excluir' })).toBeDisabled()
    await dialog.getByRole('button', { name: 'Mover lançamentos para' }).click()
    await page.getByRole('option', { name: 'Itaú' }).click()
    await expect(dialog).toContainText('Itaú passa a ser o principal.')
    await dialog.getByRole('button', { name: 'Mover e excluir' }).click()
    await expect(page.getByText('Nubank excluído. 2 lançamentos foram para Itaú.')).toBeVisible()
    await expect(row(page, 'Nubank')).toHaveCount(0)
    await expect(total(page)).toContainText('R$ 9.420,00')
    await expect(row(page, 'Itaú')).toContainText('Principal')
    await expect(row(page, 'Itaú')).toContainText('R$ 9.350,00')

    // O que ficou gravado no cofre é o mesmo que a tela mostra.
    await expect(page.getByText('Salvo no cofre')).toBeVisible()
    const saved = (await (await page.request.get('/api/vault/data')).json()) as { data: DataState }
    const itau = saved.data.banks.find((b) => b.name === 'Itaú')!
    expect(itau.initialBalance).toBe(450000)
    expect(itau.isPrimary).toBe(true)
    expect(saved.data.transactions.every((t) => t.bankId === itau.id)).toBe(true)

    await page.getByRole('button', { name: 'Desfazer' }).click()
    await expect(row(page, 'Nubank')).toContainText('Principal')
    await expect(row(page, 'Itaú')).toContainText('−R$ 30,00')
  })

  test('sem lançamentos: o aviso diz que o saldo inicial deixa de contar', async ({ page }) => {
    await openMenu(page, 'Safra', 'Excluir')
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('O saldo inicial de R$ 70,00 deixa de contar no saldo total.')
    await dialog.getByRole('button', { name: 'Excluir', exact: true }).click()
    await expect(page.getByText('Banco excluído')).toBeVisible()
    await expect(total(page)).toContainText('R$ 9.350,00')
  })

  test('"Ver lançamentos" abre a lista filtrada pelo banco', async ({ page }) => {
    await openMenu(page, 'Itaú', 'Ver lançamentos')
    await expect(page).toHaveURL(/#\/transactions\?bank=/)
    await expect(page.locator('#filter-bank')).toContainText('Itaú')
    // Os lançamentos são de janeiro: a busca (que vale para todos os meses) acha só os do Itaú.
    await page.getByRole('searchbox').fill('a')
    await expect(page.getByText('Padaria')).toBeVisible()
    await expect(page.getByText('Zaffari')).toHaveCount(0)
  })

  test('celular: o selo de principal não esconde o nome do banco', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const name = row(page, 'Nubank').getByText('Nubank', { exact: true })
    await expect(name).toBeVisible()
    const cut = await name.evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(cut).toBe(false)
    // A segunda linha mostra o uso inteiro, sem reticências.
    const usage = row(page, 'Nubank').getByText('2 lançamentos')
    await expect(usage).toBeVisible()
    expect(await usage.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false)
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390)
  })
})

test('único banco com lançamentos: explica que é preciso outro banco antes', async ({ page }) => {
  const s = data()
  const nubank = s.banks.find((b) => b.name === 'Nubank')!
  await createVault(page, { data: { ...s, banks: [nubank], transactions: s.transactions.filter((t) => t.bankId === nubank.id) } })
  await page.goto('/#/banks')
  await openMenu(page, 'Nubank', 'Excluir')
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('2 lançamentos usam este banco e não há outro banco para recebê-los. Crie outro banco antes de excluir este.')
  await expect(dialog.getByRole('button', { name: 'Mover e excluir' })).toBeDisabled()
})
