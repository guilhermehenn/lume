import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { parseData } from '../../src/data/backup'
import { BANK_CATALOG, CATEGORY_CATALOG } from '../../src/data/catalog'
import {
  bankUsage,
  createSeedData,
  DataError,
  deleteBank,
  deleteCategory,
  deleteInvestment,
  deleteReport,
  deleteTransaction,
  formatCnpj,
  isValidCnpj,
  primaryBank,
  saveBank,
  saveCategory,
  saveInvestment,
  saveReport,
  saveTransaction,
  setPrimaryBank,
} from '../../src/data/model'
import type { DataState } from '../../src/data/types'

function seed() {
  const s = createSeedData('2026-01-01T00:00:00.000Z')
  const bank = (name: string) => s.banks.find((b) => b.name === name)!.id
  const cat = (key: string) => s.categories.find((c) => c.nameKey === key)!.id
  return { s, bank, cat }
}

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    assert.ok(err instanceof DataError, `esperava DataError, veio ${err}`)
    return err.field ? `${err.code}:${err.field}` : err.code
  }
  assert.fail('não lançou erro')
}

describe('cadastros iniciais', () => {
  test('18 bancos com código COMPE e 24 categorias, nenhum principal', () => {
    const { s } = seed()
    assert.equal(s.banks.length, 18)
    assert.equal(BANK_CATALOG.length, 18)
    assert.ok(s.banks.every((b) => /^\d{3}$/.test(b.code!)))
    assert.equal(new Set(s.banks.map((b) => b.code)).size, 18)
    assert.equal(s.categories.filter((c) => c.kind === 'expense').length, 16)
    assert.equal(s.categories.filter((c) => c.kind === 'income').length, 8)
    assert.equal(CATEGORY_CATALOG.length, 24)
    assert.equal(primaryBank(s), undefined)
    assert.equal(new Set(s.banks.map((b) => b.id)).size, 18)
  })
})

describe('bancos', () => {
  test('banco principal é único', () => {
    const { s, bank } = seed()
    let state = setPrimaryBank(s, bank('Itaú'))
    assert.equal(primaryBank(state)!.name, 'Itaú')
    ;[state] = saveBank(state, { name: 'Carteira', kind: 'cash', color: '#30D158', initialBalance: 5000, isPrimary: true })
    assert.equal(state.banks.filter((b) => b.isPrimary).length, 1)
    assert.equal(primaryBank(state)!.name, 'Carteira')
    state = setPrimaryBank(state, null)
    assert.equal(primaryBank(state), undefined)
  })

  test('banco novo vindo da tela (id: undefined) ganha id e passa na validação do backup', () => {
    const { s } = seed()
    const [state, created] = saveBank(s, { id: undefined, name: 'Cofrinho', kind: 'savings', color: '#30D158', initialBalance: 0, isPrimary: false } as Parameters<typeof saveBank>[1])
    assert.match(created.id, /^[0-9a-f-]{36}$/)
    assert.equal(state.banks.at(-1)!.id, created.id)
    assert.doesNotThrow(() => parseData(JSON.parse(JSON.stringify(state))))
  })

  test('validação de nome, cor, código e saldo inicial', () => {
    const { s } = seed()
    assert.equal(code(() => saveBank(s, { name: '  ', kind: 'checking', color: '#000000', initialBalance: 0, isPrimary: false })), 'invalid:name')
    assert.equal(code(() => saveBank(s, { name: 'X', kind: 'checking', color: 'red', initialBalance: 0, isPrimary: false })), 'invalid:color')
    assert.equal(code(() => saveBank(s, { name: 'X', kind: 'checking', color: '#000000', initialBalance: 1.5, isPrimary: false })), 'invalid:initialBalance')
    const [, b] = saveBank(s, { name: '  Meu   Banco ', code: '0a77', kind: 'other', color: '#000000', initialBalance: -2500, isPrimary: false })
    assert.equal(b.name, 'Meu Banco')
    assert.equal(b.code, '077')
    assert.equal(b.initialBalance, -2500)
  })

  test('excluir banco em uso exige destino e move os lançamentos', () => {
    const { s, bank, cat } = seed()
    let [state] = saveTransaction(s, { kind: 'expense', amount: 1000, date: '2026-01-05', bankId: bank('Itaú'), categoryId: cat('groceries'), counterparty: 'Zaffari' })
    ;[state] = saveInvestment(state, { operation: 'contribution', type: 'savings', amount: 2000, date: '2026-01-06', bankId: bank('Itaú'), asset: '' })
    ;[state] = saveReport(state, { name: 'Itaú', filters: { kinds: [], categoryIds: [], bankIds: [bank('Itaú')] }, groupBy: 'month' })
    assert.equal(bankUsage(state, bank('Itaú')), 2)
    assert.equal(code(() => deleteBank(state, bank('Itaú'))), 'in-use')
    assert.equal(code(() => deleteBank(state, bank('Itaú'), bank('Itaú'))), 'reassign-invalid')
    assert.equal(code(() => deleteBank(state, bank('Itaú'), 'nao-existe')), 'reassign-invalid')
    const next = deleteBank(state, bank('Itaú'), bank('Nubank'))
    assert.equal(next.banks.length, 17)
    assert.ok(next.transactions.every((t) => t.bankId === bank('Nubank')))
    assert.ok(next.investments.every((i) => i.bankId === bank('Nubank')))
    // O relatório que filtrava o banco excluído passa a filtrar o destino, para onde foram os lançamentos.
    assert.deepEqual(next.reports[0].filters.bankIds, [bank('Nubank')])
    // sem uso: exclui direto
    assert.equal(deleteBank(s, bank('Safra')).banks.length, 17)
    assert.equal(code(() => deleteBank(s, 'x')), 'not-found')
  })
})

describe('categorias', () => {
  test('criar, renomear e manter tradução', () => {
    const { s, cat } = seed()
    const [state, created] = saveCategory(s, { kind: 'expense', name: 'Academia', icon: 'dumbbell', color: '#FF453A' })
    assert.equal(created.name, 'Academia')
    assert.equal(created.nameKey, undefined)
    const [kept] = saveCategory(state, { id: cat('housing'), kind: 'expense', name: 'Moradia', icon: 'sofa', color: '#FF9F0A', keepTranslation: true })
    const housing = kept.categories.find((c) => c.id === cat('housing'))!
    assert.equal(housing.name, undefined)
    assert.equal(housing.icon, 'sofa')
    const [renamed] = saveCategory(state, { id: cat('housing'), kind: 'expense', name: 'Casa', icon: 'house', color: '#FF9F0A' })
    assert.equal(renamed.categories.find((c) => c.id === cat('housing'))!.name, 'Casa')
  })

  test('tipo não muda com lançamentos; exclusão pede categoria do mesmo tipo', () => {
    const { s, bank, cat } = seed()
    const [state] = saveTransaction(s, { kind: 'expense', amount: 1000, date: '2026-01-05', bankId: bank('Nubank'), categoryId: cat('pets'), counterparty: 'Petz' })
    assert.equal(code(() => saveCategory(state, { id: cat('pets'), kind: 'income', name: 'Pets', icon: 'paw', color: '#AC8E68' })), 'in-use:kind')
    assert.equal(code(() => deleteCategory(state, cat('pets'))), 'in-use')
    assert.equal(code(() => deleteCategory(state, cat('pets'), cat('salary'))), 'reassign-invalid')
    const next = deleteCategory(state, cat('pets'), cat('other_expense'))
    assert.equal(next.transactions[0].categoryId, cat('other_expense'))
    assert.equal(next.categories.length, 23)
    // sem lançamentos o tipo pode mudar
    const [changed] = saveCategory(s, { id: cat('pets'), kind: 'income', name: 'Pets', icon: 'paw', color: '#AC8E68' })
    assert.equal(changed.categories.find((c) => c.id === cat('pets'))!.kind, 'income')
  })
})

describe('receitas e despesas', () => {
  test('validações', () => {
    const { s, bank, cat } = seed()
    const base = { kind: 'expense' as const, amount: 1990, date: '2026-03-10', bankId: bank('Nubank'), categoryId: cat('restaurants'), counterparty: 'iFood' }
    assert.equal(code(() => saveTransaction(s, { ...base, amount: 0 })), 'invalid:amount')
    assert.equal(code(() => saveTransaction(s, { ...base, amount: 10.5 })), 'invalid:amount')
    assert.equal(code(() => saveTransaction(s, { ...base, date: '2026-02-30' })), 'invalid:date')
    assert.equal(code(() => saveTransaction(s, { ...base, bankId: 'x' })), 'invalid:bankId')
    assert.equal(code(() => saveTransaction(s, { ...base, categoryId: cat('salary') })), 'invalid:categoryId')
    assert.equal(code(() => saveTransaction(s, { ...base, counterparty: '   ' })), 'invalid:counterparty')
    // Mesmos anos que o servidor aceita (1900–2199): o erro aparece no campo, não depois na gravação.
    assert.equal(code(() => saveTransaction(s, { ...base, date: '1899-12-31' })), 'invalid:date')
    assert.equal(code(() => saveTransaction(s, { ...base, date: '2200-01-01' })), 'invalid:date')
    assert.equal(code(() => saveTransaction(s, { ...base, date: '0026-03-10' })), 'invalid:date')
    assert.doesNotThrow(() => saveTransaction(s, { ...base, date: '1900-01-01' }))
    assert.doesNotThrow(() => saveTransaction(s, { ...base, date: '2199-12-31' }))
  })

  test('forma de pagamento só em despesas; observação vazia some; edição mantém id', () => {
    const { s, bank, cat } = seed()
    let [state, tx] = saveTransaction(s, {
      kind: 'income',
      amount: 820000,
      date: '2026-03-05',
      bankId: bank('Nubank'),
      categoryId: cat('salary'),
      counterparty: ' Empresa  XYZ ',
      paymentMethod: 'pix',
      note: '   ',
    })
    assert.equal(tx.paymentMethod, undefined)
    assert.equal(tx.note, undefined)
    assert.equal(tx.counterparty, 'Empresa XYZ')
    ;[state, tx] = saveTransaction(state, { id: tx.id, kind: 'expense', amount: 5000, date: '2026-03-06', bankId: bank('Nubank'), categoryId: cat('bills'), counterparty: 'Luz', paymentMethod: 'boleto' })
    assert.equal(state.transactions.length, 1)
    assert.equal(tx.paymentMethod, 'boleto')
    assert.equal(deleteTransaction(state, tx.id).transactions.length, 0)
    assert.equal(code(() => deleteTransaction(state, 'x')), 'not-found')
  })
})

describe('investimentos', () => {
  const ids = () => seed()

  test('CNPJ: máscara e dígitos verificadores', () => {
    assert.equal(formatCnpj('30680829000143'), '30.680.829/0001-43')
    assert.equal(isValidCnpj('30.680.829/0001-43'), true)
    assert.equal(isValidCnpj('11.222.333/0001-81'), true)
    assert.equal(isValidCnpj('11.222.333/0001-82'), false)
    assert.equal(isValidCnpj('00.000.000/0000-00'), false)
    assert.equal(isValidCnpj('123'), false)
    // CNPJ alfanumérico (desde 31/07/2026): exemplo da Receita Federal.
    assert.equal(formatCnpj('12abc34501de35'), '12.ABC.345/01DE-35')
    assert.equal(isValidCnpj('12.ABC.345/01DE-35'), true)
    assert.equal(isValidCnpj('12abc34501de35'), true)
    assert.equal(isValidCnpj('12.ABC.345/01DE-36'), false)
    assert.equal(isValidCnpj('12.ABC.345/01DE-3A'), false)
    assert.equal(isValidCnpj('12.AB#.345/01DE-35'), false)
  })

  test('Tesouro exige título e gera nome; ticker em maiúsculas; quantidade obrigatória', () => {
    const { s, bank } = ids()
    const xp = bank('XP Investimentos')
    assert.equal(code(() => saveInvestment(s, { operation: 'contribution', type: 'treasury', amount: 30000, date: '2026-01-09', bankId: xp, asset: '', quantity: 0.1 })), 'invalid:treasuryTitle')
    const [, t] = saveInvestment(s, { operation: 'contribution', type: 'treasury', amount: 30000, date: '2026-01-09', bankId: xp, asset: '', treasuryTitle: 'ipca', maturity: '2035-05-15', quantity: 0.0937, unitPrice: 320171 })
    assert.equal(t.asset, 'Tesouro IPCA+ 2035')
    const [, stock] = saveInvestment(s, { operation: 'contribution', type: 'stock', amount: 3000, date: '2026-01-09', bankId: xp, asset: ' petr4 ', quantity: 100, unitPrice: 30 })
    assert.equal(stock.asset, 'PETR4')
    assert.equal(code(() => saveInvestment(s, { operation: 'contribution', type: 'stock', amount: 3000, date: '2026-01-09', bankId: xp, asset: 'VALE3' })), 'invalid:quantity')
    assert.equal(code(() => saveInvestment(s, { operation: 'contribution', type: 'stock', amount: 3000, date: '2026-01-09', bankId: xp, asset: '', quantity: 1 })), 'invalid:asset')
  })

  test('campos fora do tipo são descartados; rendimento guarda tipo e IR', () => {
    const { s, bank } = ids()
    const nu = bank('Nubank')
    const [, cdb] = saveInvestment(s, {
      operation: 'contribution',
      type: 'cdb',
      amount: 100000,
      date: '2026-01-06',
      bankId: nu,
      asset: '',
      issuer: 'Nu Financeira',
      issuerCnpj: '30680829000143',
      indexer: 'cdi',
      rate: '100% CDI',
      dailyLiquidity: true,
      quantity: 5,
      fundClass: 'equity',
      cryptoClass: 'bitcoin',
      earningKind: 'dividend',
    })
    assert.equal(cdb.asset, 'CDB Nu Financeira')
    assert.equal(cdb.issuerCnpj, '30.680.829/0001-43')
    assert.equal(cdb.quantity, undefined)
    assert.equal(cdb.fundClass, undefined)
    assert.equal(cdb.cryptoClass, undefined)
    assert.equal(cdb.earningKind, undefined)
    assert.equal(cdb.dailyLiquidity, true)
    assert.equal(code(() => saveInvestment(s, { operation: 'contribution', type: 'cdb', amount: 1, date: '2026-01-06', bankId: nu, asset: '', issuerCnpj: '11.111.111/1111-11' })), 'invalid:issuerCnpj')

    const [, earning] = saveInvestment(s, { operation: 'earning', type: 'fii', amount: 990, date: '2026-01-15', bankId: nu, asset: 'hglg11', quantity: 3, unitPrice: 100, fees: 10, taxWithheld: 0 })
    assert.equal(earning.asset, 'HGLG11')
    assert.equal(earning.earningKind, 'other')
    assert.equal(earning.quantity, undefined)
    assert.equal(earning.fees, undefined)
    assert.equal('taxWithheld' in earning, false)

    const [, saving] = saveInvestment(s, { operation: 'contribution', type: 'savings', amount: 500, date: '2026-01-15', bankId: nu, asset: 'ignorado' })
    assert.equal(saving.asset, 'Poupança Nubank')
  })

  test('editar e excluir', () => {
    const { s, bank } = ids()
    let [state, inv] = saveInvestment(s, { operation: 'contribution', type: 'gold', amount: 50000, date: '2026-02-01', bankId: bank('XP Investimentos'), asset: '', quantity: 1, unitPrice: 50000 })
    const created = inv.createdAt
    ;[state, inv] = saveInvestment(state, { id: inv.id, operation: 'contribution', type: 'gold', amount: 60000, date: '2026-02-01', bankId: bank('XP Investimentos'), asset: '', quantity: 1, unitPrice: 60000 }, '2026-02-02T00:00:00.000Z')
    assert.equal(state.investments.length, 1)
    assert.equal(inv.createdAt, created)
    assert.equal(inv.amount, 60000)
    assert.equal(deleteInvestment(state, inv.id).investments.length, 0)
  })
})

describe('relatórios salvos', () => {
  test('nome obrigatório, editar e excluir', () => {
    const { s } = seed()
    assert.equal(code(() => saveReport(s, { name: ' ', filters: { kinds: [], categoryIds: [], bankIds: [] }, groupBy: 'category' })), 'invalid:name')
    let [state, report] = saveReport(s, { name: 'Carro', filters: { kinds: ['expense'], categoryIds: [], bankIds: [] }, groupBy: 'month' })
    ;[state, report] = saveReport(state, { id: report.id, name: 'Carro 2', filters: report.filters, groupBy: 'bank' })
    assert.equal(state.reports.length, 1)
    assert.equal(report.groupBy, 'bank')
    const empty: DataState = deleteReport(state, report.id)
    assert.equal(empty.reports.length, 0)
  })
})
