// Folha "Novo": salvar e criar outro, envio único, descartar, desfazer, lembrar nome, datas e
// cadastros que faltam.

import type { Locator, Page } from '@playwright/test'
import { createSeedData } from '../../src/data/model'
import { brl, createVault, expect, mockApi, test } from './fixtures'

function toast(page: Page, message: string): Locator {
  return page.getByRole('status').locator(':scope > div', { hasText: message }).last()
}

/** Abre uma despesa nova na lista de lançamentos (atalho N). */
async function openExpense(page: Page) {
  await page.keyboard.press('n')
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('heading', { name: 'Nova despesa' })).toBeVisible()
  await expect(sheet.locator('#entry-amount')).toBeFocused()
  return sheet
}

async function fillExpense(page: Page, sheet: Locator, { cents, who, category }: { cents: string; who: string; category: string }) {
  await sheet.locator('#entry-amount').click()
  await page.keyboard.type(cents)
  await sheet.locator('#entry-counterparty').fill(who)
  await sheet.locator('#entry-category').click()
  await page.getByRole('option', { name: category, exact: true }).click()
}

const row = (page: Page, who: string) => page.getByRole('button', { name: new RegExp(who) })

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

test.describe('com cadastros prontos', () => {
  test.beforeEach(async ({ page }) => {
    await createVault(page)
    await page.goto('/#/transactions')
  })

  test('salvar e criar outro: mantém banco e data, limpa o resto e volta para o valor', async ({ page }) => {
    const sheet = await openExpense(page)
    await sheet.locator('#entry-bank').click()
    await page.getByRole('option', { name: 'Itaú' }).click()
    await sheet.getByRole('button', { name: 'Ontem' }).click()
    const yesterday = await sheet.locator('#entry-date').inputValue()
    await fillExpense(page, sheet, { cents: '1250', who: 'Feira do Bom Fim', category: 'Mercado' })
    await sheet.getByRole('radio', { name: 'Pix' }).click()
    await sheet.locator('#entry-note').fill('verduras')
    await sheet.getByRole('button', { name: 'Salvar e criar outro' }).click()

    await expect(toast(page, 'Despesa salva')).toBeVisible()
    await expect(sheet.getByRole('heading', { name: 'Nova despesa' })).toBeVisible()
    await expect(sheet.locator('#entry-amount')).toBeFocused()
    await expect(sheet.locator('#entry-amount')).toHaveValue(brl('R$ 0,00'))
    await expect(sheet.locator('#entry-counterparty')).toHaveValue('')
    await expect(sheet.locator('#entry-note')).toHaveValue('')
    await expect(sheet.locator('#entry-category')).toContainText('Selecione')
    await expect(sheet.getByRole('radio', { name: 'Pix' })).toHaveAttribute('aria-checked', 'false')
    await expect(sheet.locator('#entry-bank')).toContainText('Itaú')
    await expect(sheet.locator('#entry-date')).toHaveValue(yesterday)

    // O segundo pelo atalho (Ctrl + Shift + Enter); depois fecha com Salvar.
    await fillExpense(page, sheet, { cents: '890', who: 'Banca do Zé', category: 'Mercado' })
    await sheet.locator('#entry-counterparty').press('Control+Shift+Enter')
    await expect(sheet.locator('#entry-counterparty')).toHaveValue('')
    await fillExpense(page, sheet, { cents: '300', who: 'Pastel da Feira', category: 'Restaurantes e delivery' })
    await sheet.getByRole('button', { name: 'Salvar', exact: true }).click()
    await expect(sheet).toHaveCount(0)

    // Gravados no cofre: continuam lá depois de recarregar (no mês de ontem).
    await page.goto(`/#/transactions?month=${yesterday.slice(0, 7)}`)
    await page.reload()
    for (const who of ['Feira do Bom Fim', 'Banca do Zé', 'Pastel da Feira']) await expect(row(page, who)).toHaveCount(1)
    await expect(row(page, 'Feira do Bom Fim')).toContainText('verduras')
    await expect(row(page, 'Feira do Bom Fim')).toContainText('Itaú')
  })

  test('envio único: clique duplo, Enter repetido e clique duplo em "criar outro" geram um lançamento cada', async ({ page }) => {
    let sheet = await openExpense(page)
    await fillExpense(page, sheet, { cents: '1000', who: 'Clique Duplo', category: 'Mercado' })
    await sheet.getByRole('button', { name: 'Salvar', exact: true }).dblclick()
    await expect(sheet).toHaveCount(0)

    sheet = await openExpense(page)
    await fillExpense(page, sheet, { cents: '2000', who: 'Enter Repetido', category: 'Mercado' })
    await sheet.locator('#entry-note').click()
    await sheet.locator('#entry-counterparty').focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Control+Enter')
    await expect(sheet).toHaveCount(0)

    sheet = await openExpense(page)
    await fillExpense(page, sheet, { cents: '3000', who: 'Criar Outro Duplo', category: 'Mercado' })
    await sheet.getByRole('button', { name: 'Salvar e criar outro' }).dblclick()
    await expect(sheet.locator('#entry-counterparty')).toHaveValue('')
    // O segundo clique não vira uma tentativa com o formulário vazio.
    await expect(sheet.getByText('Digite um valor maior que zero.')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)

    for (const who of ['Clique Duplo', 'Enter Repetido', 'Criar Outro Duplo']) await expect(row(page, who)).toHaveCount(1)
    await page.reload()
    for (const who of ['Clique Duplo', 'Enter Repetido', 'Criar Outro Duplo']) await expect(row(page, who)).toHaveCount(1)
  })

  test('fechar com algo preenchido pede confirmação; vazio fecha direto', async ({ page }) => {
    let sheet = await openExpense(page)
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    await expect(page.getByRole('alertdialog')).toHaveCount(0)

    // Trocar só o tipo não conta como preenchido (nem para Investimento, que tem outros campos).
    sheet = await openExpense(page)
    await sheet.getByRole('radio', { name: 'Receita' }).click()
    await sheet.getByRole('radio', { name: 'Investimento' }).click()
    await sheet.getByRole('button', { name: 'Fechar' }).click()
    await expect(sheet).toHaveCount(0)
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await page.keyboard.press('n')
    await sheet.getByRole('radio', { name: 'Despesa' }).click()
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)

    sheet = await openExpense(page)
    await page.keyboard.type('4500')
    await page.keyboard.press('Escape')
    const confirm = page.getByRole('alertdialog')
    await expect(confirm.getByRole('heading', { name: 'Descartar este lançamento?' })).toBeVisible()
    await confirm.getByRole('button', { name: 'Continuar editando' }).click()
    await expect(confirm).toHaveCount(0)
    await expect(sheet.locator('#entry-amount')).toHaveValue(brl('R$ 45,00'))

    await sheet.getByRole('button', { name: 'Cancelar' }).click()
    await confirm.getByRole('button', { name: 'Descartar' }).click()
    await expect(sheet).toHaveCount(0)
    await expect(page.getByText('Nenhum lançamento neste mês.')).toBeVisible()

    // Edição: só pergunta se algo mudou.
    sheet = await openExpense(page)
    await fillExpense(page, sheet, { cents: '1000', who: 'Para Editar', category: 'Mercado' })
    await sheet.getByRole('button', { name: 'Salvar', exact: true }).click()
    await row(page, 'Para Editar').click()
    await expect(sheet.getByRole('heading', { name: 'Editar despesa' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    await row(page, 'Para Editar').click()
    await sheet.locator('#entry-note').fill('mudei')
    await page.keyboard.press('Escape')
    await expect(confirm.getByRole('heading', { name: 'Descartar as alterações?' })).toBeVisible()
    await confirm.getByRole('button', { name: 'Descartar' }).click()
    await expect(row(page, 'Para Editar')).not.toContainText('mudei')
  })

  test('desfazer: o novo some (também no cofre) e a edição volta ao que era', async ({ page }) => {
    let sheet = await openExpense(page)
    await fillExpense(page, sheet, { cents: '7700', who: 'Compra Errada', category: 'Mercado' })
    await sheet.getByRole('button', { name: 'Salvar', exact: true }).click()
    await expect(row(page, 'Compra Errada')).toHaveCount(1)
    await toast(page, 'Despesa salva').getByRole('button', { name: 'Desfazer' }).click()
    await expect(row(page, 'Compra Errada')).toHaveCount(0)
    await expect(toast(page, 'Lançamento desfeito')).toBeVisible()
    await page.reload()
    await expect(page.getByText('Nenhum lançamento neste mês.')).toBeVisible()

    sheet = await openExpense(page)
    await fillExpense(page, sheet, { cents: '1000', who: 'Aluguel da Vaga', category: 'Moradia' })
    await sheet.getByRole('button', { name: 'Salvar', exact: true }).click()
    await row(page, 'Aluguel da Vaga').click()
    await sheet.locator('#entry-amount').click()
    await page.keyboard.type('0')
    await sheet.locator('#entry-counterparty').fill('Aluguel da Garagem')
    await sheet.getByRole('button', { name: 'Salvar alterações' }).click()
    await expect(row(page, 'Aluguel da Garagem')).toContainText('R$ 100,00')
    await toast(page, 'Alterações salvas').getByRole('button', { name: 'Desfazer' }).click()
    await expect(row(page, 'Aluguel da Vaga')).toContainText('R$ 10,00')
    await expect(row(page, 'Aluguel da Garagem')).toHaveCount(0)

    // Com a folha ainda aberta ("Salvar e criar outro"): o aviso continua clicável e a folha não fecha.
    sheet = await openExpense(page)
    await fillExpense(page, sheet, { cents: '5500', who: 'Duplicado Sem Querer', category: 'Mercado' })
    await sheet.getByRole('button', { name: 'Salvar e criar outro' }).click()
    // Com a folha aberta, a lista atrás fica fora da árvore de acessibilidade: confere pelo texto.
    const behind = page.locator('#main').getByText('Duplicado Sem Querer')
    await expect(behind).toHaveCount(1)
    await toast(page, 'Despesa salva').getByRole('button', { name: 'Desfazer' }).click()
    await expect(toast(page, 'Lançamento desfeito')).toBeVisible()
    await expect(behind).toHaveCount(0)
    await expect(sheet.getByRole('heading', { name: 'Nova despesa' })).toBeVisible()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(sheet.locator('#entry-amount')).toBeFocused()
  })

  test('N logo depois de salvar: o que se digita cai no valor, mesmo com a folha anterior saindo', async ({ page }) => {
    const sheet = await openExpense(page)
    await fillExpense(page, sheet, { cents: '1000', who: 'Rápido', category: 'Mercado' })
    await sheet.locator('#entry-counterparty').press('Control+Enter')
    await page.keyboard.press('n')
    await page.keyboard.type('123')
    await expect(sheet.locator('#entry-amount')).toHaveValue(brl('R$ 1,23'))
    await expect(sheet.locator('#entry-amount')).toBeFocused()
  })

  test('lembra categoria e forma de pagamento pelo nome, sem passar por cima da escolha', async ({ page }) => {
    let sheet = await openExpense(page)
    await fillExpense(page, sheet, { cents: '15000', who: 'Zaffari', category: 'Mercado' })
    await sheet.getByRole('radio', { name: 'Débito' }).click()
    await sheet.getByRole('button', { name: 'Salvar', exact: true }).click()
    await expect(sheet).toHaveCount(0)

    sheet = await openExpense(page)
    await page.keyboard.type('2000')
    await sheet.locator('#entry-counterparty').fill('ZAFFARI')
    await expect(sheet.locator('#entry-category')).toContainText('Mercado')
    await expect(sheet.getByRole('radio', { name: 'Débito' })).toHaveAttribute('aria-checked', 'true')
    // Sem categoria escolhida à mão, o erro de categoria some junto.
    await sheet.getByRole('button', { name: 'Salvar', exact: true }).click()
    await expect(sheet).toHaveCount(0)

    sheet = await openExpense(page)
    await sheet.locator('#entry-category').click()
    await page.getByRole('option', { name: 'Restaurantes e delivery', exact: true }).click()
    await sheet.getByRole('radio', { name: 'Crédito' }).click()
    await sheet.locator('#entry-counterparty').fill('Zaffari')
    await expect(sheet.locator('#entry-category')).toContainText('Restaurantes e delivery')
    await expect(sheet.getByRole('radio', { name: 'Crédito' })).toHaveAttribute('aria-checked', 'true')

    // Receita não usa o que foi lembrado das despesas.
    await sheet.getByRole('radio', { name: 'Receita' }).click()
    await expect(sheet.locator('#entry-category')).toContainText('Selecione')
    await sheet.locator('#entry-counterparty').fill('Zaffari ')
    await expect(sheet.locator('#entry-category')).toContainText('Selecione')
  })

  test('validação leva o foco ao primeiro campo com problema', async ({ page }) => {
    const sheet = await openExpense(page)
    await sheet.getByRole('button', { name: 'Salvar', exact: true }).click()
    await expect(sheet.locator('#entry-amount')).toBeFocused()
    await page.keyboard.type('100')
    await sheet.getByRole('button', { name: 'Salvar', exact: true }).click()
    await expect(sheet.locator('#entry-counterparty')).toBeFocused()
    await page.keyboard.type('Alguém')
    await sheet.getByRole('button', { name: 'Salvar', exact: true }).click()
    await expect(sheet.locator('#entry-category')).toBeFocused()
    await expect(sheet.getByText('Preencha este campo.')).toHaveCount(0)
  })

  test('datas: Hoje e Ontem, aviso de futuro e limite de anos', async ({ page }) => {
    const sheet = await openExpense(page)
    const [today, yesterday, tomorrow] = await page.evaluate(() => {
      const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const at = (days: number) => {
        const d = new Date()
        d.setDate(d.getDate() + days)
        return iso(d)
      }
      return [at(0), at(-1), at(1)]
    })
    const date = sheet.locator('#entry-date')
    await expect(date).toHaveValue(today)
    await expect(sheet.getByRole('button', { name: 'Hoje' })).toHaveAttribute('aria-pressed', 'true')
    await sheet.getByRole('button', { name: 'Ontem' }).click()
    await expect(date).toHaveValue(yesterday)
    await expect(sheet.getByRole('button', { name: 'Ontem' })).toHaveAttribute('aria-pressed', 'true')
    await expect(sheet.getByRole('button', { name: 'Hoje' })).toHaveAttribute('aria-pressed', 'false')

    await date.fill(tomorrow)
    await expect(sheet.getByText('Data no futuro. Confira se é isso mesmo.')).toBeVisible()
    await sheet.getByRole('button', { name: 'Hoje' }).click()
    await expect(sheet.getByText('Data no futuro. Confira se é isso mesmo.')).toHaveCount(0)

    await fillExpense(page, sheet, { cents: '100', who: 'Ano Errado', category: 'Mercado' })
    await date.fill('2300-01-01')
    await sheet.getByRole('button', { name: 'Salvar', exact: true }).click()
    await expect(sheet.getByText('Escolha uma data válida, entre 1900 e 2199.')).toBeVisible()
    await expect(date).toBeFocused()
    await sheet.getByRole('button', { name: 'Hoje' }).click()
    await sheet.getByRole('button', { name: 'Salvar', exact: true }).click()
    await expect(row(page, 'Ano Errado')).toHaveCount(1)
  })

  test('N abre o último tipo usado; trocar o tipo tira a categoria que não serve', async ({ page }) => {
    await page.getByRole('button', { name: 'Novo' }).first().click()
    await page.getByRole('menuitem', { name: 'Receita' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: 'Nova receita' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    await page.keyboard.press('n')
    await expect(sheet.getByRole('heading', { name: 'Nova receita' })).toBeVisible()

    await sheet.getByRole('radio', { name: 'Despesa' }).click()
    await sheet.locator('#entry-category').click()
    await page.getByRole('option', { name: 'Mercado', exact: true }).click()
    // Investimento não usa categoria: ao voltar, ela continua lá.
    await sheet.getByRole('radio', { name: 'Investimento' }).click()
    // Valor vazio: o foco vai para ele na hora, para já digitar.
    await expect(sheet.locator('#entry-amount')).toBeFocused()
    await sheet.getByRole('radio', { name: 'Despesa' }).click()
    await expect(sheet.locator('#entry-category')).toContainText('Mercado')
    await sheet.getByRole('radio', { name: 'Receita' }).click()
    await expect(sheet.locator('#entry-category')).toContainText('Selecione')
  })
})

test('sem banco cadastrado: explica e leva para Bancos', async ({ page }) => {
  await createVault(page, { data: { ...createSeedData(), banks: [] } })
  await page.goto('/#/transactions')
  await page.keyboard.press('n')
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByText('Cadastre um banco primeiro')).toBeVisible()
  await expect(sheet.locator('#entry-amount')).toHaveCount(0)
  await expect(sheet.getByRole('button', { name: 'Salvar', exact: true })).toHaveCount(0)
  await sheet.getByRole('button', { name: 'Cadastrar banco' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(page).toHaveURL(/#\/banks/)
})

test('sem categoria do tipo: explica, e o outro tipo continua lançando', async ({ page }) => {
  const data = createSeedData()
  await createVault(page, { data: { ...data, categories: data.categories.filter((c) => c.kind === 'income') } })
  await page.goto('/#/transactions')
  await page.keyboard.press('n')
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByText('Não há categorias de despesa')).toBeVisible()
  await sheet.getByRole('radio', { name: 'Receita' }).click()
  await expect(sheet.locator('#entry-amount')).toBeVisible()
  await sheet.getByRole('radio', { name: 'Despesa' }).click()
  await sheet.getByRole('button', { name: 'Cadastrar categoria' }).click()
  await expect(page).toHaveURL(/#\/categories/)
})
