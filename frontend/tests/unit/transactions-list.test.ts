import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createBackup, readBackup } from '../../src/data/backup'
import { createSeedData, saveInvestment, saveTransaction } from '../../src/data/model'
import { allEntries, type Entry } from '../../src/data/selectors'
import type { DataState, Settings, Transaction } from '../../src/data/types'
import { normalize } from '../../src/lib/text'
import {
  buildSearchIndex,
  groupByDay,
  matchesScope,
  monthEntries,
  parseAmountQuery,
  searchEntries,
  totalsOf,
} from '../../src/screens/transactions/list'

function world() {
  let s = createSeedData('2026-01-01T00:00:00.000Z')
  const bank = (name: string) => s.banks.find((b) => b.name === name)!.id
  const cat = (key: string) => s.categories.find((c) => c.nameKey === key)!.id
  const add = (kind: 'expense' | 'income', amount: number, date: string, who: string, key: string, extra: Partial<Transaction> = {}, bankName = 'Nubank') => {
    ;[s] = saveTransaction(s, { kind, amount, date, bankId: bank(bankName), categoryId: cat(key), counterparty: who, ...extra })
  }
  return {
    get s() {
      return s
    },
    set s(v: DataState) {
      s = v
    },
    bank,
    cat,
    add,
  }
}

/** O mesmo texto que a tela usa (nome, categoria, banco, observação). */
const describeEntry = (s: DataState) => (e: Entry) => {
  if (e.entryKind === 'investment') return `${e.inv.asset} ${e.inv.issuer ?? ''} ${e.inv.note ?? ''}`
  const category = s.categories.find((c) => c.id === e.tx.categoryId)!
  const bank = s.banks.find((b) => b.id === e.tx.bankId)!
  return `${e.tx.counterparty} ${category.name ?? category.nameKey} ${bank.name} ${e.tx.note ?? ''}`
}

describe('busca por valor', () => {
  test('vírgula ou ponto, milhar, R$ e espaços', () => {
    const cases: [string, number | null][] = [
      ['45,90', 4590],
      ['45,9', 4590],
      ['45.90', 4590],
      ['R$ 45,90', 4590],
      ['r$45', 4500],
      ['120', 12000],
      ['1.234,56', 123456],
      ['1,234.56', 123456],
      ['1.234', 123400],
      ['1 234,56', 123456],
      ['0,05', 5],
      ['mercado', null],
      ['45,90 mercado', null],
      ['-45', null],
      ['', null],
      ['.5', null],
      ['99999999999999', null],
    ]
    for (const [query, cents] of cases) assert.equal(parseAmountQuery(query), cents, query)
  })

  test('texto sem acento, maiúsculas e espaços repetidos', () => {
    assert.equal(normalize('Café  da   MANHÃ'), 'cafe da manha')
    assert.equal(normalize('Ação Ç'), 'acao c')
  })
})

describe('lista do mês', () => {
  test('só o mês, inclusive primeiro e último dia, na mesma ordem da lista completa', () => {
    const w = world()
    w.add('expense', 100, '2026-01-31', 'Fim de janeiro', 'groceries')
    w.add('expense', 200, '2026-02-01', 'Primeiro de fevereiro', 'groceries')
    w.add('expense', 300, '2026-02-28', 'Último de fevereiro', 'groceries')
    w.add('income', 400, '2026-02-15', 'Salário', 'salary')
    w.add('expense', 500, '2026-03-01', 'Março', 'groceries')
    ;[w.s] = saveInvestment(w.s, { operation: 'contribution', type: 'cdb', amount: 600, date: '2026-02-10', bankId: w.bank('Nubank'), asset: '' })
    const feb = monthEntries(w.s, '2026-02')
    assert.deepEqual(feb.map((e) => e.date), ['2026-02-28', '2026-02-15', '2026-02-10', '2026-02-01'])
    assert.deepEqual(feb, allEntries(w.s).filter((e) => e.date.startsWith('2026-02-')))
    assert.equal(monthEntries(w.s, '2026-04').length, 0)
  })

  test('totais: aplicação soma, resgate desconta, rendimento não entra; dia com saldo', () => {
    const w = world()
    w.add('income', 100000, '2026-02-10', 'Salário', 'salary')
    w.add('expense', 30000, '2026-02-10', 'Aluguel', 'housing')
    for (const [operation, amount] of [['contribution', 5000], ['redemption', 2000], ['earning', 700]] as const) {
      ;[w.s] = saveInvestment(w.s, { operation, type: 'cdb', amount, date: '2026-02-10', bankId: w.bank('Nubank'), asset: '' })
    }
    const entries = monthEntries(w.s, '2026-02')
    assert.deepEqual(totalsOf(entries), { income: 100000, expense: 30000, invested: 3000 })
    const [day] = groupByDay(entries)
    assert.equal(day.entries.length, 5)
    assert.equal(day.net, 70000)
  })

  test('banco e categoria: categoria deixa os investimentos de fora', () => {
    const w = world()
    w.add('expense', 100, '2026-02-01', 'A', 'groceries', {}, 'Nubank')
    w.add('expense', 200, '2026-02-02', 'B', 'groceries', {}, 'Itaú')
    w.add('expense', 300, '2026-02-03', 'C', 'housing', {}, 'Itaú')
    ;[w.s] = saveInvestment(w.s, { operation: 'contribution', type: 'cdb', amount: 400, date: '2026-02-04', bankId: w.bank('Itaú'), asset: '' })
    const entries = monthEntries(w.s, '2026-02')
    const names = (list: Entry[]) => list.map((e) => (e.entryKind === 'investment' ? 'inv' : e.tx.counterparty)).sort()
    assert.deepEqual(names(entries.filter((e) => matchesScope(e, w.bank('Itaú')))), ['B', 'C', 'inv'])
    assert.deepEqual(names(entries.filter((e) => matchesScope(e, undefined, w.cat('groceries')))), ['A', 'B'])
    assert.deepEqual(names(entries.filter((e) => matchesScope(e, w.bank('Itaú'), w.cat('groceries')))), ['B'])
  })
})

describe('busca em todos os meses', () => {
  test('acha por nome sem acento, categoria, banco, observação, emissor e valor', () => {
    const w = world()
    w.add('expense', 4590, '2025-03-10', 'Café Brasil', 'groceries', { note: 'pão de queijo' })
    w.add('expense', 12000, '2026-02-01', 'Posto', 'transport', {}, 'Itaú')
    w.add('income', 4590, '2026-02-05', 'Reembolso', 'other_income')
    ;[w.s] = saveInvestment(w.s, { operation: 'contribution', type: 'cdb', amount: 100000, date: '2026-01-04', bankId: w.bank('Nubank'), asset: 'CDB Liquidez', issuer: 'Banco Inter' })
    const index = buildSearchIndex(w.s, describeEntry(w.s))
    const find = (q: string) => searchEntries(index, normalize(q.trim())).map((e) => (e.entryKind === 'investment' ? e.inv.asset : e.tx.counterparty))
    assert.deepEqual(find('cafe'), ['Café Brasil'])
    assert.deepEqual(find('PÃO'), ['Café Brasil'])
    assert.deepEqual(find('itau'), ['Posto'])
    assert.deepEqual(find('inter'), ['CDB Liquidez'])
    // Valor: as duas de R$ 45,90, a mais nova primeiro.
    assert.deepEqual(find('45,90'), ['Reembolso', 'Café Brasil'])
    assert.deepEqual(find('R$ 1.000'), ['CDB Liquidez'])
    assert.deepEqual(find('nada disso'), [])
  })

  test('100 mil lançamentos: o índice sai uma vez e cada tecla é rápida', () => {
    const w = world()
    const bank = w.bank('Nubank')
    const category = w.cat('groceries')
    const s: DataState = {
      ...w.s,
      transactions: Array.from({ length: 100_000 }, (_, i) => ({
        id: `t${i}`,
        kind: 'expense' as const,
        amount: 100 + (i % 5000),
        date: `20${10 + (i % 17)}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
        bankId: bank,
        categoryId: category,
        counterparty: `Loja Ação ${i % 800}`,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })),
    }
    const describe = describeEntry(s)
    let started = performance.now()
    const index = buildSearchIndex(s, describe)
    const build = performance.now() - started
    started = performance.now()
    for (const q of ['l', 'lo', 'loj', 'loja', 'loja a', 'loja acao 7']) searchEntries(index, q)
    const typing = (performance.now() - started) / 6
    // Antes: cada tecla normalizava o texto de tudo.
    started = performance.now()
    allEntries(s).filter((e) => normalize(describe(e)).includes('loja acao 7'))
    const before = performance.now() - started
    assert.ok(typing * 5 < before, `tecla ${typing.toFixed(1)} ms × antes ${before.toFixed(1)} ms (índice ${build.toFixed(0)} ms)`)
  })
})

describe('backup com as regras do servidor', () => {
  test('data e hora estragadas não impedem a restauração; ano fora de 1900–2199 é recusado', () => {
    const w = world()
    w.add('expense', 100, '2026-02-01', 'A', 'groceries')
    const settings: Settings = { language: 'pt', currency: 'BRL', theme: 'dark', hideValues: false, onboardingDone: true, emailCopies: false }
    const text = createBackup(w.s, settings)
    const broken = JSON.parse(text)
    broken.data.transactions[0].createdAt = 'ontem'
    broken.data.transactions[0].updatedAt = 12345
    const back = readBackup(JSON.stringify(broken))
    assert.equal(back.data.transactions[0].createdAt, '1970-01-01T00:00:00.000Z')
    assert.equal(back.data.transactions[0].updatedAt, '1970-01-01T00:00:00.000Z')
    // Válidas ficam como estavam.
    assert.equal(readBackup(text).data.transactions[0].createdAt, w.s.transactions[0].createdAt)

    const oldYear = JSON.parse(text)
    oldYear.data.transactions[0].date = '0026-02-01'
    assert.throws(() => readBackup(JSON.stringify(oldYear)))
  })
})
