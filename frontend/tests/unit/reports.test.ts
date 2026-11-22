// Relatórios: relatório salvo (nome, período relativo, filtros limpos), filtros e agrupamento sem
// acento, meses de um período longo e a posição em 31/12 (PGBL, CNPJ, resultado, desempenho).

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { parseData } from '../../src/data/backup'
import { availableYears, yearPositions } from '../../src/data/exporters'
import { createSeedData, DataError, LIMITS, saveInvestment, saveReport, saveTransaction, type InvestmentInput } from '../../src/data/model'
import { counterpartyLabels, filterTransactions, groupTransactions } from '../../src/data/selectors'
import type { DataState, Investment, ReportFilters, SavedReport } from '../../src/data/types'
import { monthsBetween, reportPeriod } from '../../src/lib/period'
import { exportContext, createI18n } from '../../src/i18n'

const NOW = '2026-11-21T12:00:00.000Z'

function seed() {
  let s: DataState = createSeedData('2026-01-01T00:00:00.000Z')
  const bank = (name: string) => s.banks.find((b) => b.name === name)!.id
  const cat = (key: string) => s.categories.find((c) => c.nameKey === key)!.id
  const add = (kind: 'expense' | 'income', amount: number, date: string, who: string, key: string, extra: { note?: string; bankName?: string } = {}) => {
    ;[s] = saveTransaction(s, { kind, amount, date, bankId: bank(extra.bankName ?? 'Nubank'), categoryId: cat(key), counterparty: who, note: extra.note })
  }
  return {
    get s() {
      return s
    },
    set s(next: DataState) {
      s = next
    },
    bank,
    cat,
    add,
  }
}

const filters = (extra: Partial<ReportFilters> = {}): ReportFilters => ({ kinds: [], categoryIds: [], bankIds: [], ...extra })

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    assert.ok(err instanceof DataError, `esperava DataError, veio ${err}`)
    return err.field ? `${err.code}:${err.field}` : err.code
  }
  assert.fail('não lançou erro')
}

describe('relatório salvo', () => {
  test('nome sem repetir, período em ordem e filtros limpos (sem repetição e só o que existe)', () => {
    const w = seed()
    const [state, saved] = saveReport(w.s, {
      name: '  Gastos   com o carro ',
      filters: filters({ from: '2026-11-01', to: '2026-11-30', preset: 'thisMonth', kinds: ['expense', 'expense'], bankIds: [w.bank('Itaú'), w.bank('Itaú'), 'nao-existe'], categoryIds: [w.cat('transport')], text: '  posto   ipiranga ' }),
      groupBy: 'counterparty',
    }, NOW)
    assert.equal(saved.name, 'Gastos com o carro')
    assert.deepEqual(saved.filters, { from: '2026-11-01', to: '2026-11-30', preset: 'thisMonth', kinds: ['expense'], bankIds: [w.bank('Itaú')], categoryIds: [w.cat('transport')], text: 'posto ipiranga' })
    assert.equal(code(() => saveReport(state, { name: 'gastos com o CARRO', filters: filters(), groupBy: 'category' })), 'duplicate:name')
    // Atualizar o próprio relatório com o mesmo nome vale.
    assert.doesNotThrow(() => saveReport(state, { id: saved.id, name: 'Gastos com o carro', filters: filters(), groupBy: 'month' }))
    assert.equal(code(() => saveReport(state, { name: 'Outro', filters: filters({ from: '2026-12-01', to: '2026-11-01' }), groupBy: 'category' })), 'invalid:period')
    assert.equal(code(() => saveReport(state, { name: 'Outro', filters: filters({ from: '2026-02-30' }), groupBy: 'category' })), 'invalid:period')
    assert.doesNotThrow(() => parseData(JSON.parse(JSON.stringify(state))))
  })

  test('limite de relatórios: o mesmo do backup', () => {
    const w = seed()
    const reports: SavedReport[] = Array.from({ length: LIMITS.reports }, (_, i) => ({ id: `r${i}`, name: `R ${i}`, filters: filters(), groupBy: 'category', createdAt: NOW }))
    const full = { ...w.s, reports }
    assert.equal(code(() => saveReport(full, { name: 'Mais um', filters: filters(), groupBy: 'category' })), 'limit')
    assert.doesNotThrow(() => saveReport(full, { id: 'r0', name: 'R 0 novo', filters: filters(), groupBy: 'category' }))
  })

  test('"Este mês" salvo abre no mês de hoje; datas escolhidas abrem como foram salvas', () => {
    const december = new Date(2026, 11, 10, 12)
    assert.deepEqual(reportPeriod({ preset: 'thisMonth', from: '2026-11-01', to: '2026-11-30' }, december), { preset: 'thisMonth', from: '2026-12-01', to: '2026-12-31' })
    assert.deepEqual(reportPeriod({ preset: 'lastYear' }, december), { preset: 'lastYear', from: '2025-01-01', to: '2025-12-31' })
    // Relatório de antes da v0.3.8 (sem preset): datas fixas.
    assert.deepEqual(reportPeriod({ from: '2026-03-01', to: '2026-03-31' }, december), { preset: 'custom', from: '2026-03-01', to: '2026-03-31' })
    assert.equal(reportPeriod({}, december), null)
  })

  test('o backup aceita o período relativo e recusa um desconhecido', () => {
    const w = seed()
    const [state] = saveReport(w.s, { name: 'Mês', filters: filters({ preset: 'last3' }), groupBy: 'category' }, NOW)
    assert.doesNotThrow(() => parseData(JSON.parse(JSON.stringify(state))))
    const bad = JSON.parse(JSON.stringify(state))
    bad.reports[0].filters.preset = 'nextYear'
    assert.throws(() => parseData(bad))
  })
})

describe('personalizado', () => {
  test('texto sem acento e sem maiúsculas, em quem pagou/recebeu e na observação', () => {
    const w = seed()
    w.add('expense', 1000, '2026-11-02', 'Café Colombo', 'restaurants')
    w.add('expense', 2000, '2026-11-03', 'Mercado', 'groceries', { note: 'Pão de açúcar' })
    w.add('income', 5000, '2026-11-04', 'Salário', 'salary', { bankName: 'Itaú' })
    const find = (f: Partial<ReportFilters>) => filterTransactions(w.s, filters(f)).map((t) => t.counterparty).sort()
    assert.deepEqual(find({ text: 'cafe' }), ['Café Colombo'])
    assert.deepEqual(find({ text: 'ACUCAR' }), ['Mercado'])
    assert.deepEqual(find({ kinds: ['income'] }), ['Salário'])
    assert.deepEqual(find({ bankIds: [w.bank('Itaú')] }), ['Salário'])
    assert.deepEqual(find({ categoryIds: [w.cat('groceries')], from: '2026-11-03', to: '2026-11-03' }), ['Mercado'])
    assert.deepEqual(find({ from: '2026-11-05' }), [])
  })

  test('agrupar por quem pagou/recebeu junta grafias diferentes do mesmo nome', () => {
    const w = seed()
    w.add('expense', 1000, '2026-11-02', 'Padaria do Zé', 'groceries')
    w.add('expense', 500, '2026-11-03', 'padaria do ze ', 'groceries')
    w.add('expense', 700, '2026-11-04', 'Posto', 'transport')
    const list = filterTransactions(w.s, filters())
    const rows = groupTransactions(list, 'counterparty')
    assert.equal(rows.length, 2)
    assert.equal(rows[0].count, 2)
    assert.equal(rows[0].expense, 1500)
    assert.equal(counterpartyLabels(list).get(rows[0].key), 'Padaria do Zé')
  })

  test('meses de um período longo: todos, sem o teto de 36 que cortava os mais recentes', () => {
    const months = monthsBetween('2020-01-01', '2025-12-31')
    assert.equal(months.length, 72)
    assert.equal(months.at(-1), '2025-12')
    assert.deepEqual(monthsBetween('2026-11-10', '2026-11-20'), ['2026-11'])
  })
})

describe('investimentos para o IR', () => {
  const ctx = exportContext(createI18n('pt', 'BRL'), 'Guilherme Henn')

  test('PGBL fica no fim, sem grupo; CNPJ mais recente; resultado só do ano', () => {
    const w = seed()
    const xp = w.bank('XP Investimentos')
    let s = w.s
    const op = (input: Partial<InvestmentInput> & Pick<InvestmentInput, 'operation' | 'type' | 'amount' | 'date'>, i: number) => {
      ;[s] = saveInvestment(s, { asset: '', bankId: xp, ...input } as InvestmentInput, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString())
    }
    op({ operation: 'contribution', type: 'pension', plan: 'pgbl', amount: 100000, date: '2026-03-01', asset: 'PGBL XP' }, 0)
    op({ operation: 'contribution', type: 'stock', amount: 100000, date: '2025-06-01', asset: 'PETR4', quantity: 100, unitPrice: 1000 }, 1)
    op({ operation: 'redemption', type: 'stock', amount: 60000, date: '2026-05-01', asset: 'PETR4', quantity: 50, unitPrice: 1200 }, 2)
    op({ operation: 'contribution', type: 'fii', amount: 10000, date: '2026-01-10', asset: 'HGLG11', quantity: 1, unitPrice: 10000, issuerCnpj: '11.728.688/0001-47' }, 3)
    const rows = yearPositions(s, 2026, ctx)
    assert.deepEqual(rows.map((r) => r.asset), ['PETR4', 'HGLG11', 'PGBL XP'])
    assert.equal(rows.at(-1)!.group, '')
    assert.equal(rows.find((r) => r.asset === 'HGLG11')!.cnpj, '11.728.688/0001-47')
    const petr = rows.find((r) => r.asset === 'PETR4')!
    assert.equal(petr.costPrevious, 100000)
    assert.equal(petr.costCurrent, 50000)
    assert.equal(petr.realized, 10000)
  })

  test('20 mil operações em 500 ativos: posição do ano em poucos milissegundos', () => {
    const w = seed()
    const xp = w.bank('XP Investimentos')
    const investments: Investment[] = Array.from({ length: 20_000 }, (_, i) => ({
      id: `i${i}`,
      operation: 'contribution',
      type: 'fii',
      asset: `FII${i % 500}`,
      bankId: xp,
      amount: 10000,
      quantity: 1,
      unitPrice: 10000,
      issuerCnpj: i % 7 === 0 ? '11.728.688/0001-47' : undefined,
      date: `${2020 + (i % 6)}-0${1 + (i % 9)}-10`,
      createdAt: NOW,
      updatedAt: NOW,
    }))
    const state = { ...w.s, investments }
    const started = performance.now()
    const rows = yearPositions(state, 2025, ctx)
    const elapsed = performance.now() - started
    assert.equal(rows.length, 500)
    assert.ok(elapsed < 300, `${elapsed.toFixed(0)} ms`)
    assert.ok(availableYears(state, new Date(2026, 10, 21)).includes(2026))
  })
})
