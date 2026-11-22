// Bancos: código COMPE, nome repetido, limite, exclusão como junção (saldo total igual), lista
// (busca sem acento, ordem, bancos sem uso) e as mesmas regras no backup.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { parseData } from '../../src/data/backup'
import { createSeedData, DataError, deleteBank, duplicateBank, LIMITS, primaryBank, saveBank, saveInvestment, saveReport, saveTransaction, type BankInput } from '../../src/data/model'
import { balanceOverview, bankUsageCounts } from '../../src/data/selectors'
import { diff, pendingCount } from '../../src/data/sync'
import type { DataState, Transaction } from '../../src/data/types'
import { normalize } from '../../src/lib/text'
import { isBankInUse, listBanks, splitByUse } from '../../src/screens/banks/list'

const NOW = '2026-11-21T12:00:00.000Z'
const TODAY = '2026-11-21'

function seed() {
  const s = createSeedData('2026-01-01T00:00:00.000Z')
  const bank = (name: string) => s.banks.find((b) => b.name === name)!.id
  const cat = (key: string) => s.categories.find((c) => c.nameKey === key)!.id
  return { s, bank, cat }
}

const input = (extra: Partial<BankInput> = {}): BankInput => ({ name: 'Cofrinho', kind: 'savings', color: '#30D158', initialBalance: 0, isPrimary: false, ...extra })

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    assert.ok(err instanceof DataError, `esperava DataError, veio ${err}`)
    return err.field ? `${err.code}:${err.field}` : err.code
  }
  assert.fail('não lançou erro')
}

describe('cadastro de banco', () => {
  test('código COMPE sempre com 3 dígitos; dinheiro em espécie não tem código', () => {
    const { s } = seed()
    assert.equal(saveBank(s, input({ code: '1' }))[1].code, '001')
    assert.equal(saveBank(s, input({ code: '' }))[1].code, undefined)
    assert.equal(saveBank(s, input({ name: 'Carteira', kind: 'cash', code: '260' }))[1].code, undefined)
  })

  test('nome repetido é recusado sem diferença de acento, maiúsculas ou espaços', () => {
    const { s, bank } = seed()
    for (const name of ['Itaú', 'itau', ' ITAU ', 'Itáu']) assert.equal(code(() => saveBank(s, input({ name }))), 'duplicate:name', name)
    // Editar o próprio banco sem trocar o nome, ou só mudar maiúsculas, vale.
    const itau = s.banks.find((b) => b.id === bank('Itaú'))!
    assert.doesNotThrow(() => saveBank(s, { ...input({ name: 'ITAÚ', kind: itau.kind, color: itau.color }), id: itau.id }))
    // Renomear para o nome de outro banco, não.
    assert.equal(code(() => saveBank(s, { ...input({ name: 'nubank' }), id: itau.id })), 'duplicate:name')
    assert.equal(duplicateBank(s, 'Banco  do brasil')?.name, 'Banco do Brasil')
    assert.equal(duplicateBank(s, '   '), undefined)
  })

  test('banco antigo já repetido continua editável enquanto o nome não muda', () => {
    const { s, bank } = seed()
    const nubank = s.banks.find((b) => b.id === bank('Nubank'))!
    const legacy: DataState = { ...s, banks: [...s.banks, { ...nubank, id: 'legado', name: 'nubank' }] }
    const edit = (name: string) => saveBank(legacy, { ...input({ name, kind: nubank.kind, color: '#000000' }), id: 'legado' })
    assert.equal(edit('nubank')[1].color, '#000000')
    assert.equal(edit('NUBANK')[1].name, 'NUBANK')
    assert.equal(code(() => edit('Itaú')), 'duplicate:name')
  })

  test('limite de bancos: o mesmo do backup, para o cofre sempre poder ser restaurado', () => {
    const { s } = seed()
    const banks = Array.from({ length: LIMITS.banks }, (_, i) => ({ ...s.banks[0], id: `b${i}`, name: `Banco ${i}`, isPrimary: false }))
    const full: DataState = { ...s, banks }
    assert.equal(code(() => saveBank(full, input())), 'limit')
    // Editar um banco existente continua valendo.
    assert.doesNotThrow(() => saveBank(full, { ...input({ name: 'Banco 0 renomeado' }), id: 'b0' }))
  })
})

describe('excluir banco', () => {
  function withEntries() {
    const { s, bank, cat } = seed()
    let state = s
    const nubank = bank('Nubank')
    const itau = bank('Itaú')
    state = { ...state, banks: state.banks.map((b) => (b.id === nubank ? { ...b, initialBalance: 450000, isPrimary: true } : b.id === itau ? { ...b, initialBalance: 10000 } : b)) }
    ;[state] = saveTransaction(state, { kind: 'expense', amount: 12000, date: '2026-11-10', bankId: nubank, categoryId: cat('groceries'), counterparty: 'Zaffari' })
    ;[state] = saveTransaction(state, { kind: 'income', amount: 500000, date: '2026-11-05', bankId: nubank, categoryId: cat('salary'), counterparty: 'Salário' })
    ;[state] = saveTransaction(state, { kind: 'expense', amount: 3000, date: '2026-11-11', bankId: itau, categoryId: cat('groceries'), counterparty: 'Padaria' })
    ;[state] = saveInvestment(state, { operation: 'contribution', type: 'cdb', amount: 100000, date: '2026-11-12', bankId: nubank, asset: 'CDB Nubank' })
    ;[state] = saveReport(state, { name: 'Só Nubank', filters: { kinds: [], categoryIds: [], bankIds: [nubank] }, groupBy: 'month' })
    ;[state] = saveReport(state, { name: 'Os dois', filters: { kinds: [], categoryIds: [], bankIds: [nubank, itau] }, groupBy: 'month' })
    ;[state] = saveReport(state, { name: 'Todos', filters: { kinds: [], categoryIds: [], bankIds: [] }, groupBy: 'month' })
    return { state, nubank, itau, bank }
  }

  test('com lançamentos é uma junção: o saldo total não muda e o destino herda saldo inicial e principal', () => {
    const { state, nubank, itau } = withEntries()
    const before = balanceOverview(state, TODAY)
    const next = deleteBank(state, nubank, itau, NOW)
    const after = balanceOverview(next, TODAY)
    assert.equal(after.total, before.total)
    assert.equal(after.byBank.get(itau), before.byBank.get(itau)! + before.byBank.get(nubank)!)
    const target = next.banks.find((b) => b.id === itau)!
    assert.equal(target.initialBalance, 460000)
    assert.equal(target.isPrimary, true)
    assert.equal(primaryBank(next)?.id, itau)
    assert.equal(target.updatedAt, NOW)
    // Lançamentos movidos registram a alteração; os outros ficam como estavam (mesmo objeto).
    const moved = next.transactions.filter((t) => t.counterparty !== 'Padaria')
    assert.ok(moved.every((t) => t.bankId === itau && t.updatedAt === NOW))
    const untouched = next.transactions.find((t) => t.counterparty === 'Padaria')!
    assert.equal(untouched, state.transactions.find((t) => t.counterparty === 'Padaria'))
    assert.ok(next.investments.every((i) => i.bankId === itau && i.updatedAt === NOW))
  })

  test('relatórios salvos: o filtro passa para o destino, sem repetir, e os outros nem mudam', () => {
    const { state, nubank, itau } = withEntries()
    const next = deleteBank(state, nubank, itau, NOW)
    const byName = (name: string) => next.reports.find((r) => r.name === name)!
    assert.deepEqual(byName('Só Nubank').filters.bankIds, [itau])
    assert.deepEqual(byName('Os dois').filters.bankIds, [itau])
    assert.equal(byName('Todos'), state.reports.find((r) => r.name === 'Todos'))
    // O que vai para o servidor: o banco excluído, o destino, 3 movidos e 2 relatórios.
    const changes = diff(state, next)
    assert.equal(pendingCount(changes), 1 + 1 + 3 + 2)
    assert.deepEqual([...changes.deletes.banks], [nubank])
  })

  test('sem lançamentos o banco só sai; o principal fica vago e o saldo inicial deixa de contar', () => {
    const { s, bank } = seed()
    const safra = bank('Safra')
    const state = { ...s, banks: s.banks.map((b) => (b.id === safra ? { ...b, initialBalance: 7000, isPrimary: true } : b)) }
    const next = deleteBank(state, safra, undefined, NOW)
    assert.equal(primaryBank(next), undefined)
    assert.equal(balanceOverview(next, TODAY).total, balanceOverview(state, TODAY).total - 7000)
    // Destino informado sem lançamentos para mover é ignorado.
    const ignored = deleteBank(state, safra, bank('Itaú'), NOW)
    assert.equal(ignored.banks.find((b) => b.id === bank('Itaú'))!.initialBalance, 0)
  })

  test('junção que estouraria o teto do saldo inicial é recusada', () => {
    const { state, nubank, itau } = withEntries()
    const huge = { ...state, banks: state.banks.map((b) => (b.id === nubank || b.id === itau ? { ...b, initialBalance: LIMITS.maxAmount } : b)) }
    assert.equal(code(() => deleteBank(huge, nubank, itau, NOW)), 'invalid:initialBalance')
  })

  test('20 mil lançamentos movidos: exclusão e diferenças para gravar em poucos milissegundos', () => {
    const { s, bank, cat } = seed()
    const nubank = bank('Nubank')
    const itau = bank('Itaú')
    const base: Transaction = { id: '', kind: 'expense', amount: 1000, date: '2026-01-01', bankId: nubank, categoryId: cat('groceries'), counterparty: 'Mercado', createdAt: NOW, updatedAt: NOW }
    const transactions = Array.from({ length: 100_000 }, (_, i) => ({ ...base, id: `t${i}`, bankId: i % 5 === 0 ? nubank : itau }))
    const state: DataState = { ...s, transactions }
    const started = performance.now()
    const next = deleteBank(state, nubank, itau, NOW)
    const changes = diff(state, next)
    const elapsed = performance.now() - started
    assert.equal(changes.upserts.transactions.size, 20_000)
    assert.ok(elapsed < 400, `${elapsed.toFixed(0)} ms`)
  })
})

describe('lista de bancos', () => {
  test('busca sem acento e pelo código; ordem: principal, mais usados, nome', () => {
    const { s, bank, cat } = seed()
    let state: DataState = { ...s, banks: s.banks.map((b) => (b.name === 'Safra' ? { ...b, isPrimary: true } : b)) }
    for (let i = 0; i < 3; i++) [state] = saveTransaction(state, { kind: 'expense', amount: 100, date: '2026-11-01', bankId: bank('Itaú'), categoryId: cat('groceries'), counterparty: 'x' })
    ;[state] = saveTransaction(state, { kind: 'expense', amount: 100, date: '2026-11-01', bankId: bank('Nubank'), categoryId: cat('groceries'), counterparty: 'x' })
    const usage = bankUsageCounts(state)
    const names = (q: string) => listBanks(state.banks, usage, normalize(q)).map((b) => b.name)
    assert.deepEqual(names('itau'), ['Itaú'])
    assert.deepEqual(names('341'), ['Itaú'])
    assert.deepEqual(names('BANCO'), ['Banco BV', 'Banco do Brasil'])
    assert.deepEqual(names('').slice(0, 4), ['Safra', 'Itaú', 'Nubank', 'Banco BV'])
    assert.deepEqual(names('nada'), [])
  })

  test('em uso: principal, com saldo inicial ou com lançamentos', () => {
    const { s, bank, cat } = seed()
    let state: DataState = { ...s, banks: s.banks.map((b) => (b.name === 'Inter' ? { ...b, initialBalance: -500 } : b)) }
    ;[state] = saveInvestment(state, { operation: 'contribution', type: 'savings', amount: 100, date: '2026-11-01', bankId: bank('Caixa'), asset: '' })
    ;[state] = saveTransaction(state, { kind: 'income', amount: 100, date: '2026-11-01', bankId: bank('Sicredi'), categoryId: cat('salary'), counterparty: 'x' })
    const usage = bankUsageCounts(state)
    const { used, unused } = splitByUse(listBanks(state.banks, usage, ''), usage)
    assert.deepEqual(used.map((b) => b.name).sort(), ['Caixa', 'Inter', 'Sicredi'])
    assert.equal(unused.length, 15)
    assert.equal(isBankInUse({ ...state.banks[0], isPrimary: true }, 0), true)
  })
})

describe('backup com as regras do servidor', () => {
  test('código com letras e nome só de espaços são recusados na leitura do arquivo', () => {
    const { s } = seed()
    const json = (banks: DataState['banks']) => JSON.parse(JSON.stringify({ ...s, banks }))
    assert.throws(() => parseData(json([{ ...s.banks[0], code: 'abc' }])))
    assert.throws(() => parseData(json([{ ...s.banks[0], name: '   ' }])))
    assert.doesNotThrow(() => parseData(json([{ ...s.banks[0], code: '1' }])))
  })
})
