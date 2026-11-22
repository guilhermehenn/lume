// Configurações: o aviso de cada troca diz o que sai e o que entra; desfazer a restauração volta
// também idioma, tema e moeda; o servidor guarda uma cópia do cofre antes de trocar tudo (e, sem
// a cópia, nada muda); celular, atalhos e o Sobre.

import type { Page } from '@playwright/test'
import { createBackup } from '../../src/data/backup'
import { createSeedData, saveInvestment, saveTransaction, type InvestmentInput } from '../../src/data/model'
import { createSampleData } from '../../src/data/sample'
import type { DataState } from '../../src/data/types'
import { createVault, expect, mockApi, test, TODAY } from './fixtures'

/** Cofre com 2 lançamentos e 1 operação de investimento. */
function smallVault(): DataState {
  let s = createSeedData()
  const bank = (name: string) => s.banks.find((b) => b.name === name)!.id
  const cat = (key: string) => s.categories.find((c) => c.nameKey === key)!.id
  ;[s] = saveTransaction(s, { kind: 'income', amount: 500000, date: TODAY, bankId: bank('Nubank'), categoryId: cat('salary'), counterparty: 'Empresa' })
  ;[s] = saveTransaction(s, { kind: 'expense', amount: 12000, date: TODAY, bankId: bank('Nubank'), categoryId: cat('groceries'), counterparty: 'Zaffari' })
  ;[s] = saveInvestment(s, {
    operation: 'contribution',
    type: 'stock',
    asset: 'PETR4',
    amount: 100000,
    quantity: 100,
    unitPrice: 1000,
    date: TODAY,
    bankId: bank('XP Investimentos'),
  } as InvestmentInput)
  return s
}

async function copies(page: Page): Promise<{ count: number; latest: { reason: string } | null }> {
  return (await page.request.get('/api/vault/backups')).json()
}

const stats = (page: Page) => page.locator('main').getByText(/^\d+ bancos? · /)

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

test.describe('restaurar', () => {
  test.use({ timezoneId: 'America/Sao_Paulo' })

  test('o aviso diz o que sai e o que entra; desfazer volta os dados e o idioma', async ({ page }) => {
    await createVault(page, { data: smallVault() })
    await page.goto('/#/settings')
    await expect(stats(page)).toHaveText('18 bancos · 24 categorias · 2 lançamentos · 1 operação de investimento · nenhum relatório salvo')
    const before = (await copies(page)).count

    const sample = createSampleData(TODAY)
    // Feito às 23h30 de Brasília: em Greenwich já é dia 21.
    const file = createBackup(
      sample,
      { language: 'en', currency: 'USD', theme: 'light', hideValues: false, onboardingDone: true, emailCopies: false },
      new Date('2026-11-21T02:30:00.000Z'),
    )
    await page.locator('input[type=file]').setInputFiles({ name: 'lume.json', mimeType: 'application/json', buffer: Buffer.from(file) })
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('20 de nov. de 2026, 23:30')
    await expect(dialog).toContainText('(2 lançamentos e 1 operação de investimento)')
    await expect(dialog).toContainText(`(${sample.transactions.length} lançamentos e ${sample.investments.length} operações de investimento)`)
    await expect(dialog).toContainText('junto com idioma, tema e moeda')
    await dialog.getByRole('button', { name: 'Restaurar backup' }).click()

    // O backup trouxe o inglês e o dólar. O aviso com "Desfazer" é o do momento da confirmação.
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expect(page.locator('#set-currency')).toContainText('US dollar')
    await page.getByRole('button', { name: 'Desfazer' }).click()
    await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible()
    await expect(stats(page)).toHaveText('18 bancos · 24 categorias · 2 lançamentos · 1 operação de investimento · nenhum relatório salvo')
    await expect(page.locator('#set-currency')).toContainText('Real brasileiro')
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(page.getByText('Salvo no cofre')).toBeVisible()
    // Antes de trocar tudo, o servidor guardou uma cópia do cofre.
    await expect.poll(async () => (await copies(page)).count).toBe(before + 1)
    expect((await copies(page)).latest?.reason).toBe('before-restore')
    // Gravado no cofre: recarregando, continua como antes da restauração.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible()
    await expect(stats(page)).toContainText('2 lançamentos')
  })
})

test('apagar tudo: o aviso conta o que sai, o cofre ganha uma cópia e o vazio não pede backup', async ({ page }) => {
  await createVault(page, { data: smallVault() })
  await page.goto('/#/settings')
  const before = (await copies(page)).count

  await page.getByRole('button', { name: 'Apagar tudo' }).click()
  let dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Serão apagados 2 lançamentos, 1 operação de investimento e nenhum relatório salvo.')
  await expect(dialog.getByRole('button', { name: 'Fazer backup' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Apagar tudo' }).click()
  await expect(page.getByText('Dados apagados')).toBeVisible()
  await expect(dialog).toHaveCount(0)
  await expect(stats(page)).toHaveText('18 bancos · 24 categorias · nenhum lançamento · nenhuma operação de investimento · nenhum relatório salvo')
  await expect.poll(async () => (await copies(page)).latest?.reason).toBe('before-reset')
  expect((await copies(page)).count).toBe(before + 1)
  await expect(page.getByTestId('vault-copies')).toContainText(`${before + 1} cópia`)

  // Com o cofre vazio, o aviso diz isso e não oferece backup; o exemplo não é tratado como perigoso.
  await page.getByRole('button', { name: 'Apagar tudo' }).click()
  dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Não há lançamentos, investimentos nem relatórios salvos.')
  await expect(dialog.getByRole('button', { name: 'Fazer backup' })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Cancelar' }).click()
  await expect(dialog).toHaveCount(0)
  await page.getByRole('button', { name: 'Carregar dados de exemplo' }).click()
  await expect(page.getByRole('alertdialog')).toContainText('para você conhecer o Lume')
  await expect(page.getByRole('alertdialog')).not.toContainText('serão trocados')
})

test('sem a cópia do cofre, nada é apagado', async ({ page }) => {
  await createVault(page, { data: smallVault() })
  await page.goto('/#/settings')
  // O servidor não consegue guardar a cópia (disco cheio, por exemplo).
  await page.route('**/api/vault/changes', (route) =>
    route.fulfill({ status: 503, json: { detail: { code: 'storage', message: 'Não deu para guardar uma cópia do cofre antes de trocar os dados.' } } }),
  )
  await page.getByRole('button', { name: 'Apagar tudo' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Apagar tudo' }).click()
  await expect(page.getByText('Não deu para salvar a última alteração. Os dados voltaram ao que está no cofre.')).toBeVisible()
  await expect(stats(page)).toContainText('2 lançamentos · 1 operação de investimento')
  const saved = (await (await page.request.get('/api/vault/data')).json()) as { data: DataState }
  expect(saved.data.transactions).toHaveLength(2)
})

test('celular: tema na largura toda, nada passando da tela; atalho de salvar do sistema', async ({ page }) => {
  await createVault(page, { data: smallVault() })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/settings')
  await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible()
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390)
  const theme = await page.getByRole('radiogroup', { name: 'Tema' }).boundingBox()
  expect(theme!.width).toBeGreaterThan(300)
  // O texto de Minha conta não é cortado no celular.
  const hint = page.getByText('Minha conta · Nome, foto, e-mail e senha de acesso')
  expect(await hint.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  // Navegador de teste no Linux: Ctrl + Enter (no Mac aparece ⌘ Enter).
  await expect(page.getByText('Ctrl + Enter', { exact: true })).toBeVisible()
  await expect(page.getByText('Salvar o formulário aberto')).toBeVisible()
  // Arquivo que não é JSON.
  await page.locator('input[type=file]').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{nada') })
  await expect(page.getByText('Esse arquivo não é um JSON válido.')).toBeVisible()
})

test('sobre: versão 1.0 e link para o código aberto, numa aba nova e sem passar a origem', async ({ page }) => {
  await createVault(page, { data: smallVault() })
  await page.goto('/#/settings')
  await expect(page.locator('main').getByText('Versão 1.0.0')).toBeVisible()
  const link = page.getByRole('link', { name: /Código aberto, licença AGPL-3\.0/ })
  await expect(link).toHaveAttribute('href', 'https://github.com/guilhermehenn/lume')
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
})
