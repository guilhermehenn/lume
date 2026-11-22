import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createSeedData, saveInvestment, saveTransaction } from '../../src/data/model'
import { allEntries, balanceOverview, bankBalances, homeEntries, periodSummary } from '../../src/data/selectors'
import type { DataState, Transaction } from '../../src/data/types'
import { formatRelativeTime } from '../../src/lib/dates'
import { dayPart } from '../../src/lib/useToday'

function world() {
  let s = createSeedData('2026-01-01T00:00:00.000Z')
  const bank = (name: string) => s.banks.find((b) => b.name === name)!.id
  const cat = (key: string) => s.categories.find((c) => c.nameKey === key)!.id
  s = { ...s, banks: s.banks.map((b) => (b.name === 'Nubank' ? { ...b, initialBalance: 100000 } : b)) }
  const tx = (kind: 'expense' | 'income', amount: number, date: string, bankName: string, key: string) => {
    ;[s] = saveTransaction(s, { kind, amount, date, bankId: bank(bankName), categoryId: cat(key), counterparty: 'X' })
  }
  return { get s() { return s }, set s(v: DataState) { s = v }, bank, cat, tx }
}

describe('saldo de hoje e previsto', () => {
  test('lançamentos com data depois de hoje ficam no previsto, não no saldo', () => {
    const w = world()
    w.tx('income', 500000, '2026-11-05', 'Nubank', 'salary')
    w.tx('expense', 120000, '2026-11-21', 'Nubank', 'housing') // hoje: conta
    w.tx('expense', 30000, '2026-11-22', 'Nubank', 'groceries') // amanhã: previsto
    w.tx('expense', 20000, '2026-12-10', 'Itaú', 'groceries')
    ;[w.s] = saveInvestment(w.s, { operation: 'contribution', type: 'cdb', amount: 50000, date: '2026-11-30', bankId: w.bank('Nubank'), asset: '' })
    const o = balanceOverview(w.s, '2026-11-21')
    assert.equal(o.byBank.get(w.bank('Nubank')), 100000 + 500000 - 120000)
    assert.equal(o.byBank.get(w.bank('Itaú')), 0)
    assert.equal(o.total, 480000)
    assert.equal(o.futureCount, 3)
    assert.equal(o.projected, 480000 - 30000 - 20000 - 50000)
    // Bate com o cálculo antigo "até a data" e com o cálculo sem data.
    assert.deepEqual(o.byBank, bankBalances(w.s, '2026-11-21'))
    const all = [...bankBalances(w.s).values()].reduce((a, b) => a + b, 0)
    assert.equal(o.projected, all)
  })

  test('sem lançamentos futuros, previsto = saldo; cofre sem bancos dá zero', () => {
    const w = world()
    w.tx('expense', 1000, '2026-01-02', 'Nubank', 'groceries')
    const o = balanceOverview(w.s, '2026-11-21')
    assert.equal(o.futureCount, 0)
    assert.equal(o.projected, o.total)
    const empty = balanceOverview({ ...createSeedData(), banks: [] }, '2026-11-21')
    assert.equal(empty.total, 0)
    assert.equal(empty.byBank.size, 0)
  })
})

describe('últimos e próximos lançamentos', () => {
  function random(seed: number) {
    let x = seed
    return () => {
      x = (x * 1103515245 + 12345) % 2 ** 31
      return x / 2 ** 31
    }
  }

  test('mesmo resultado que ordenar tudo, com empates de data e de criação', () => {
    const rnd = random(7)
    const w = world()
    const bank = w.bank('Nubank')
    const category = w.cat('groceries')
    const transactions: Transaction[] = Array.from({ length: 2000 }, (_, i) => {
      const day = Math.floor(rnd() * 60)
      const d = new Date(Date.UTC(2026, 10, 1 + day))
      return {
        id: `t${i}`,
        kind: 'expense',
        amount: 1,
        date: d.toISOString().slice(0, 10),
        bankId: bank,
        categoryId: category,
        counterparty: `c${i}`,
        createdAt: `2026-01-01T00:00:0${Math.floor(rnd() * 3)}.000Z`,
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
    })
    const s: DataState = { ...w.s, transactions }
    for (const today of ['2026-10-01', '2026-11-21', '2026-12-15', '2027-02-01']) {
      const { recent, upcoming, upcomingCount } = homeEntries(s, today)
      const sorted = allEntries(s)
      const expected = sorted.filter((e) => e.date <= today).slice(0, 6)
      assert.deepEqual(recent.map((e) => [e.date, e.createdAt]), expected.map((e) => [e.date, e.createdAt]), today)
      const future = sorted.filter((e) => e.date > today)
      assert.equal(upcomingCount, future.length)
      const soonest = [...future].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)).slice(0, 3)
      assert.deepEqual(upcoming.map((e) => [e.date, e.createdAt]), soonest.map((e) => [e.date, e.createdAt]), today)
    }
  })

  test('mistura despesas, receitas e investimentos e respeita o limite', () => {
    const w = world()
    w.tx('expense', 1, '2026-11-20', 'Nubank', 'groceries')
    w.tx('income', 2, '2026-11-21', 'Nubank', 'salary')
    ;[w.s] = saveInvestment(w.s, { operation: 'contribution', type: 'cdb', amount: 3, date: '2026-11-21', bankId: w.bank('Nubank'), asset: '' }, '2026-12-01T00:00:00.000Z')
    const { recent, upcoming } = homeEntries(w.s, '2026-11-21', 2)
    assert.deepEqual(recent.map((e) => e.entryKind), ['investment', 'income'])
    assert.equal(upcoming.length, 0)
    assert.deepEqual(homeEntries(w.s, '2026-11-21', 0).recent, [])
  })

  test('100 mil lançamentos: bem mais rápido que ordenar tudo', () => {
    const w = world()
    const bank = w.bank('Nubank')
    const category = w.cat('groceries')
    const base = { kind: 'expense' as const, amount: 1, bankId: bank, categoryId: category, counterparty: 'x', updatedAt: '2026-01-01T00:00:00.000Z' }
    const s: DataState = {
      ...w.s,
      transactions: Array.from({ length: 100_000 }, (_, i) => ({
        ...base,
        id: `t${i}`,
        date: `20${10 + (i % 17)}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
        createdAt: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
      })),
    }
    const time = (fn: () => unknown) => {
      const started = performance.now()
      for (let i = 0; i < 3; i++) fn()
      return (performance.now() - started) / 3
    }
    const before = time(() => allEntries(s).slice(0, 6))
    const after = time(() => homeEntries(s, '2026-11-21'))
    assert.ok(after * 5 < before, `homeEntries ${after.toFixed(1)} ms × ordenar tudo ${before.toFixed(1)} ms`)
  })
})

describe('textos do Início', () => {
  test('período do dia nas viradas de hora', () => {
    assert.equal(dayPart(4), 'evening')
    assert.equal(dayPart(5), 'morning')
    assert.equal(dayPart(11), 'morning')
    assert.equal(dayPart(12), 'afternoon')
    assert.equal(dayPart(17), 'afternoon')
    assert.equal(dayPart(18), 'evening')
    assert.equal(dayPart(0), 'evening')
  })

  test('mês só com despesas: sem taxa de economia (o Início avisa que não houve receita)', () => {
    const w = world()
    w.tx('expense', 1000, '2026-11-02', 'Nubank', 'groceries')
    const summary = periodSummary(w.s, '2026-11-01', '2026-11-30')
    assert.equal(summary.count, 1)
    assert.equal(summary.savingsRate, null)
  })

  test('tempo relativo nunca fala do futuro (relógio ou fuso errado vira "agora")', () => {
    const now = new Date('2026-11-21T12:00:00Z')
    assert.equal(formatRelativeTime('2026-11-21T14:00:00Z', 'pt-BR', now), formatRelativeTime('2026-11-21T12:00:00Z', 'pt-BR', now))
    assert.match(formatRelativeTime('2026-11-21T11:00:00Z', 'pt-BR', now), /há 1 h|1 hora/)
    assert.equal(formatRelativeTime('não é data', 'pt-BR', now), '')
  })
})
