// Ocultar valores, Minha conta, Trocar de cofre e Sair: sair grava antes (e, sem conexão,
// pergunta em vez de perder); sair em outra aba tranca esta com o aviso certo; e-mail novo na tela
// de entrada; nada de valor com "Ocultar valores"; remover o e-mail de envio pede confirmação.

import type { Page } from '@playwright/test'
import { saveTransaction } from '../../src/data/model'
import { createSampleData } from '../../src/data/sample'
import type { DataState } from '../../src/data/types'
import { createVault, expect, mockApi, PASSWORD, test, TODAY } from './fixtures'

const H = { 'X-App-Request': '1' }

async function openMenu(page: Page) {
  await page.getByRole('button', { name: 'Conta e cofre' }).click()
}

async function savedTransactions(page: Page): Promise<number> {
  const resp = await page.request.get('/api/vault/data')
  return ((await resp.json()) as { data: DataState }).data.transactions.length
}

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

test('sair sem conexão pergunta antes de perder; com a conexão de volta, grava e sai', async ({ page }) => {
  await createVault(page)
  await page.goto('/#/settings')
  // O Lume para de responder às gravações.
  await page.route('**/api/vault/changes', (route) => route.abort())
  await page.getByRole('button', { name: 'Carregar dados de exemplo' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Carregar dados de exemplo' }).click()
  await expect(page.getByText('Sem conexão com o Lume').first()).toBeVisible()

  await openMenu(page)
  await page.getByRole('menuitem', { name: 'Sair' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Há alterações não salvas')
  await dialog.getByRole('button', { name: 'Ficar e esperar' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible()

  // A conexão volta: as alterações são gravadas, e sair funciona sem perguntar.
  await page.unroute('**/api/vault/changes')
  await expect(page.getByText('Salvo no cofre', { exact: true })).toBeVisible({ timeout: 20_000 })
  expect(await savedTransactions(page)).toBeGreaterThan(50)
  await openMenu(page)
  await page.getByRole('menuitem', { name: 'Sair' }).click()
  await expect(page.getByText('Você saiu do cofre.')).toBeVisible()
  expect((await page.request.get('/api/vault/data')).status()).toBe(401)
})

test('sair logo depois de uma alteração grava antes de fechar', async ({ page }) => {
  const { vault } = await createVault(page)
  await page.goto('/#/settings')
  // Gravação lenta: o clique em "Sair" chega antes de o cofre responder.
  await page.route('**/api/vault/changes', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600))
    await route.continue()
  })
  await page.getByRole('button', { name: 'Carregar dados de exemplo' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Carregar dados de exemplo' }).click()
  await openMenu(page)
  await page.getByRole('menuitem', { name: 'Trocar de cofre' }).click()
  await expect(page.getByRole('heading', { name: 'Escolha um cofre' })).toBeVisible()
  // Trocar de cofre não repete o título num aviso.
  await expect(page.getByText('Escolha o cofre que quer abrir.')).toHaveCount(0)
  // Antes: o que estava sendo gravado se perdia. Agora está no cofre.
  const login = await page.request.post(`/api/vaults/${vault.id}/session`, { headers: H, data: { email: 'gui@example.com', password: PASSWORD } })
  expect(login.status()).toBe(200)
  expect(await savedTransactions(page)).toBeGreaterThan(50)
})

test('sair em outra aba: esta tranca com o aviso certo e volta ao mesmo cofre', async ({ page, context }) => {
  const { vault } = await createVault(page)
  await page.goto('/#/')
  const other = await context.newPage()
  await mockApi(other)
  await other.goto('/#/banks')
  await expect(other.getByRole('heading', { name: 'Bancos' })).toBeVisible()

  await openMenu(page)
  await page.getByRole('menuitem', { name: 'Sair' }).click()
  await expect(page.getByText('Você saiu do cofre.')).toBeVisible()
  // Antes: "Outra janela abriu um cofre diferente", o que não era verdade.
  await expect(other.getByText('Você saiu deste cofre em outra janela.', { exact: false })).toBeVisible()
  await expect(other.getByRole('heading', { name: vault.name })).toBeVisible()
  await other.getByLabel('E-mail').fill('gui@example.com')
  await other.getByLabel('Senha', { exact: true }).fill(PASSWORD)
  await other.keyboard.press('Enter')
  await expect(other.getByRole('heading', { name: 'Bancos' })).toBeVisible()
})

test('trocar o e-mail: a tela de entrada já sugere o e-mail novo', async ({ page }) => {
  const { vault } = await createVault(page)
  await page.goto('/#/account')
  const email = `novo-${Date.now()}@example.com`
  await page.locator('#acc-email').fill(email)
  await page.getByRole('button', { name: 'Salvar perfil' }).click()
  await page.locator('#acc-pass').fill(PASSWORD)
  await page.getByRole('button', { name: 'Salvar perfil' }).click()
  await expect(page.getByText('Perfil salvo')).toBeVisible()

  await openMenu(page)
  await expect(page.getByRole('menu')).toContainText(`Cofre: ${vault.name}`)
  await page.getByRole('menuitem', { name: 'Sair' }).click()
  await page.getByRole('button', { name: new RegExp(vault.name) }).click()
  // Antes: vinha o e-mail antigo, e entrar dava "E-mail ou senha incorretos".
  await expect(page.getByLabel('E-mail')).toHaveValue(email)
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Conta e cofre' })).toBeVisible()
})

test('ocultar valores: nenhum valor nem percentual na tela; o botão diz o que faz', async ({ page }) => {
  // Uma receita hoje garante o "Você guardou x% do que entrou" em qualquer dia do mês.
  let data = createSampleData(TODAY)
  const salary = data.categories.find((c) => c.nameKey === 'salary')!.id
  ;[data] = saveTransaction(data, { kind: 'income', amount: 300000, date: TODAY, bankId: data.banks[0].id, categoryId: salary, counterparty: 'Extra' })
  await createVault(page, { data })
  await page.goto('/#/')
  const toggle = page.getByRole('button', { name: 'Ocultar valores' })
  await expect(toggle).not.toHaveAttribute('aria-pressed', /.*/)
  await toggle.click()
  await expect(page.getByRole('button', { name: 'Mostrar valores' })).toBeVisible()
  await expect(page.getByText(/^Você guardou ••••• do que entrou$/)).toBeVisible()
  for (const path of ['/', '/transactions', '/investments', '/banks', '/categories', '/reports', '/reports?tab=evolution', '/reports?tab=investments']) {
    await page.goto(`/#${path}`)
    await expect(page.locator('#main h1')).toBeVisible()
    // Cotações e notícias são públicas: ficam de fora da conferência.
    const text = await page.locator('#main').evaluate((el) => {
      const copy = el.cloneNode(true) as HTMLElement
      copy.querySelectorAll('[aria-labelledby="market-title"], [aria-busy]').forEach((n) => n.remove())
      return copy.innerText
    })
    expect(text, path).not.toMatch(/R\$\s?-?\d|\d\s?%/)
  }
  await page.keyboard.press('h')
  await expect(page.getByRole('button', { name: 'Ocultar valores' })).toBeVisible()
  await expect(page.locator('#main').getByText(/R\$\s?\d/).first()).toBeVisible()
})

test('minha conta: contagem do cofre, nome repetido, Esc desiste e remover e-mail pede confirmação', async ({ page }) => {
  const stamp = Date.now() % 1_000_000
  const taken = `Casa ${stamp}`
  await createVault(page, { name: taken, email: 'casa@example.com' })
  const { vault } = await createVault(page)
  const mail = await page.request.put('/api/account/mail', {
    headers: H,
    data: { provider: 'custom', host: 'localhost', port: 1, security: 'none', username: 'gui@example.com', password: 'senha-de-app' },
  })
  expect(mail.status()).toBe(200)
  await page.goto('/#/account')

  // Antes: "18 · 24 · {transactions} · {investments} · {reports}".
  await expect(page.getByText('18 bancos · 24 categorias · nenhum lançamento · nenhuma operação de investimento · nenhum relatório salvo', { exact: false })).toBeVisible()

  const name = page.locator('#vault-name')
  await name.fill(taken.toUpperCase())
  await name.press('Enter')
  await expect(page.getByText('Já existe um cofre com esse nome.')).toBeVisible()
  await expect(name).toHaveValue(vault.name)
  await name.fill('Rascunho')
  await name.press('Escape')
  await expect(name).toHaveValue(vault.name)
  await expect(page.getByText('Cofre renomeado')).toHaveCount(0)

  await page.getByRole('button', { name: 'Remover', exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('esquece a senha de app guardada')
  await dialog.getByRole('button', { name: 'Cancelar' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText(/^Envia por /)).toBeVisible()
  await page.getByRole('button', { name: 'Remover', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remover' }).click()
  await expect(page.getByText('E-mail para envio removido')).toBeVisible()
  await expect(page.getByText('Não configurado')).toBeVisible()
})
