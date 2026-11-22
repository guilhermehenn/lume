import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { BackupError, createBackup, parseData, readBackup } from '../../src/data/backup'
import { INVESTMENT_TYPES, irpfCode, formatIrpf } from '../../src/data/investments'
import { createSeedData, saveInvestment, saveTransaction, setPrimaryBank } from '../../src/data/model'
import { createSampleData } from '../../src/data/sample'
import {
  allEntries,
  balanceOverview,
  bankBalances,
  categoryTotals,
  counterpartyMemory,
  earningsByKind,
  filterTransactions,
  groupTransactions,
  investedByType,
  investmentPositions,
  monthlySeries,
  periodSummary,
} from '../../src/data/selectors'
import type { Settings } from '../../src/data/types'

function world() {
  let s = createSeedData('2026-01-01T00:00:00.000Z')
  const bank = (name: string) => s.banks.find((b) => b.name === name)!.id
  const cat = (key: string) => s.categories.find((c) => c.nameKey === key)!.id
  s = { ...s, banks: s.banks.map((b) => (b.name === 'Nubank' ? { ...b, initialBalance: 100000 } : b)) }
  const tx = (kind: 'expense' | 'income', amount: number, date: string, bankName: string, key: string, who: string) => {
    ;[s] = saveTransaction(s, { kind, amount, date, bankId: bank(bankName), categoryId: cat(key), counterparty: who })
  }
  tx('income', 500000, '2026-01-05', 'Nubank', 'salary', 'Empresa')
  tx('expense', 120000, '2026-01-10', 'Nubank', 'housing', 'Imobiliária')
  tx('expense', 30000, '2026-01-12', 'Itaú', 'groceries', 'Zaffari')
  tx('expense', 20000, '2026-02-03', 'Nubank', 'groceries', 'zaffari ')
  tx('income', 50000, '2026-02-20', 'Itaú', 'freelance', 'Cliente')
  const xp = bank('XP Investimentos')
  const inv = (input: Parameters<typeof saveInvestment>[1]) => {
    ;[s] = saveInvestment(s, input)
  }
  inv({ operation: 'contribution', type: 'stock', amount: 10000, date: '2026-01-15', bankId: xp, asset: 'PETR4', quantity: 100, unitPrice: 100 })
  inv({ operation: 'contribution', type: 'stock', amount: 30000, date: '2026-02-15', bankId: xp, asset: 'PETR4', quantity: 100, unitPrice: 300 })
  inv({ operation: 'redemption', type: 'stock', amount: 25000, date: '2026-03-15', bankId: xp, asset: 'petr4', quantity: 50, unitPrice: 500 })
  inv({ operation: 'earning', type: 'stock', amount: 1500, date: '2026-03-20', bankId: xp, asset: 'PETR4', earningKind: 'jcp', taxWithheld: 225 })
  inv({ operation: 'contribution', type: 'cdb', amount: 100000, date: '2026-01-20', bankId: bank('Nubank'), asset: '', issuer: 'Nu' })
  inv({ operation: 'redemption', type: 'cdb', amount: 40000, date: '2026-02-20', bankId: bank('Nubank'), asset: 'CDB Nu' })
  return { s, bank, cat }
}

describe('saldos e resumos', () => {
  test('saldo por banco considera inicial, lançamentos e investimentos', () => {
    const { s, bank } = world()
    const b = bankBalances(s)
    // Nubank: 1000 + 5000 − 1200 − 200 − 1000 (CDB) + 400 (resgate)
    assert.equal(b.get(bank('Nubank')), 100000 + 500000 - 120000 - 20000 - 100000 + 40000)
    assert.equal(b.get(bank('Itaú')), -30000 + 50000)
    // XP: −100 − 300 + 250 + 15
    assert.equal(b.get(bank('XP Investimentos')), -10000 - 30000 + 25000 + 1500)
    assert.equal(bankBalances(s, '2026-01-31').get(bank('Nubank')), 100000 + 500000 - 120000 - 100000)
    assert.equal(balanceOverview(s, '2099-12-31').total, [...b.values()].reduce((x, y) => x + y, 0))
  })

  test('resumo do período e taxa de poupança', () => {
    const { s } = world()
    const jan = periodSummary(s, '2026-01-01', '2026-01-31')
    assert.equal(jan.income, 500000)
    assert.equal(jan.expense, 150000)
    assert.equal(jan.balance, 350000)
    assert.equal(jan.savingsRate, 70)
    assert.equal(jan.contributions, 110000)
    assert.equal(periodSummary(s, '2026-04-01', '2026-04-30').savingsRate, null)
  })

  test('totais por categoria e série mensal', () => {
    const { s, cat } = world()
    const totals = categoryTotals(s, 'expense', '2026-01-01', '2026-02-28')
    assert.equal(totals[0].key, cat('housing'))
    assert.equal(totals[1].total, 50000)
    assert.equal(totals[1].count, 2)
    const series = monthlySeries(s, ['2026-01', '2026-02', '2026-03'])
    assert.deepEqual(
      series.map((p) => [p.income, p.expense, p.invested]),
      [
        [500000, 150000, 110000],
        [50000, 20000, 30000 - 40000],
        [0, 0, -25000],
      ],
    )
  })
})

describe('relatório personalizado e sugestões', () => {
  test('filtros e agrupamentos', () => {
    const { s, bank, cat } = world()
    const all = filterTransactions(s, { kinds: [], categoryIds: [], bankIds: [] })
    assert.equal(all.length, 5)
    assert.equal(filterTransactions(s, { kinds: ['income'], categoryIds: [], bankIds: [] }).length, 2)
    assert.equal(filterTransactions(s, { kinds: [], categoryIds: [cat('groceries')], bankIds: [bank('Nubank')] }).length, 1)
    assert.equal(filterTransactions(s, { kinds: [], categoryIds: [], bankIds: [], text: 'ZAFF' }).length, 2)
    assert.equal(filterTransactions(s, { from: '2026-02-01', kinds: [], categoryIds: [], bankIds: [] }).length, 2)
    const byMonth = groupTransactions(all, 'month')
    assert.deepEqual(byMonth.map((r) => r.key), ['2026-01', '2026-02'])
    assert.equal(byMonth[0].net, 350000)
    const byWho = groupTransactions(all, 'counterparty')
    assert.equal(byWho.find((r) => r.key === 'zaffari')!.count, 2)
  })

  test('sugestões de "Pago a" e categoria automática', () => {
    const { s, cat } = world()
    const memory = counterpartyMemory(s, 'expense')
    assert.equal(memory.suggestions[0].toLowerCase().trim(), 'zaffari')
    assert.equal(memory.suggestions.length, 2)
    assert.equal(memory.recall('  ZAFFARI')?.categoryId, cat('groceries'))
    assert.equal(memory.recall('ninguém'), undefined)
    assert.equal(memory.recall(''), undefined)
    assert.deepEqual(counterpartyMemory(s, 'income').suggestions.sort(), ['Cliente', 'Empresa'])
    const entries = allEntries(s)
    assert.equal(entries.length, 11)
    assert.ok(entries.every((e, i) => i === 0 || entries[i - 1].date >= e.date))
  })
})

describe('carteira (custo médio)', () => {
  test('preço médio, venda parcial e resultado realizado', () => {
    const { s } = world()
    const positions = investmentPositions(s)
    const petr = positions.find((p) => p.asset === 'PETR4')!
    // compra 100 a 1,00 + 100 a 3,00 → médio 2,00; vende 50 por 250,00 → custo saído 100,00
    assert.equal(petr.quantity, 150)
    assert.equal(petr.cost, 30000)
    assert.equal(petr.averagePrice, 200)
    assert.equal(petr.realized, 25000 - 10000)
    assert.equal(petr.earnings, 1500)
    assert.equal(petr.taxWithheld, 225)
    const cdb = positions.find((p) => p.type === 'cdb')!
    assert.equal(cdb.cost, 60000)
    assert.equal(cdb.averagePrice, null)
    const before = investmentPositions(s, '2026-01-31').find((p) => p.asset === 'PETR4')!
    assert.equal(before.cost, 10000)
    const types = investedByType(positions)
    assert.deepEqual(types.map((g) => g.key), ['cdb', 'stock'])
    assert.equal(earningsByKind(s, '2026-01-01', '2026-12-31').get('jcp'), 1500)
  })

  test('venda total zera a posição', () => {
    let { s, bank } = world()
    ;[s] = saveInvestment(s, { operation: 'redemption', type: 'stock', amount: 90000, date: '2026-04-01', bankId: bank('XP Investimentos'), asset: 'PETR4', quantity: 150, unitPrice: 600 })
    const petr = investmentPositions(s).find((p) => p.asset === 'PETR4')!
    assert.equal(petr.quantity, 0)
    assert.equal(petr.cost, 0)
    assert.equal(petr.averagePrice, null)
    assert.equal(petr.realized, 15000 + 90000 - 30000)
  })
})

describe('Bens e Direitos (IRPF)', () => {
  test('códigos sugeridos', () => {
    const c = (inv: Parameters<typeof irpfCode>[0]) => formatIrpf(irpfCode(inv))
    assert.equal(c({ type: 'savings' }), '04 · 01')
    assert.equal(c({ type: 'cdb' }), '04 · 02')
    assert.equal(c({ type: 'treasury' }), '04 · 02')
    assert.equal(c({ type: 'lci_lca' }), '04 · 03')
    assert.equal(c({ type: 'debenture', incentivized: true }), '04 · 03')
    assert.equal(c({ type: 'stock' }), '03 · 01')
    assert.equal(c({ type: 'fii' }), '07 · 03')
    assert.equal(c({ type: 'fiagro' }), '07 · 02')
    // ETF de ações ou cripto: 07.06 desde o IRPF 2025 (antes 07.09; o app mostrava "07 · ?").
    assert.equal(c({ type: 'etf' }), '07 · 06')
    assert.equal(c({ type: 'etf', fixedIncomeEtf: true }), '07 · 08')
    assert.equal(c({ type: 'bdr' }), '04 · 04')
    assert.equal(c({ type: 'fund', fundClass: 'equity' }), '07 · 04')
    assert.equal(c({ type: 'fund', fundClass: 'multi' }), '07 · 01')
    assert.equal(c({ type: 'pension', plan: 'vgbl' }), '99 · 06')
    assert.equal(c({ type: 'pension', plan: 'pgbl' }), '—')
    assert.equal(c({ type: 'crypto', cryptoClass: 'bitcoin' }), '08 · 01')
    assert.equal(c({ type: 'crypto', cryptoClass: 'altcoin' }), '08 · 02')
    assert.equal(c({ type: 'crypto', cryptoClass: 'stablecoin' }), '08 · 03')
    assert.equal(c({ type: 'gold' }), '04 · 05')
    assert.equal(c({ type: 'other' }), '04 · 99')
    assert.equal(INVESTMENT_TYPES.length, 16)
  })
})

describe('backup e dados de exemplo', () => {
  const settings: Settings = { language: 'pt', currency: 'BRL', theme: 'dark', hideValues: false, onboardingDone: true, emailCopies: false }

  test('ida e volta do backup', () => {
    const { s } = world()
    const text = createBackup(s, settings, new Date('2026-11-20T12:00:00Z'))
    const back = readBackup(text)
    assert.deepEqual(back.data, JSON.parse(JSON.stringify(s)))
    assert.deepEqual(back.settings, settings)
    assert.equal(back.exportedAt, '2026-11-20T12:00:00.000Z')
  })

  test('backup da v0.2 (com nome nas configurações) continua abrindo', () => {
    const { s } = world()
    const old = { app: 'lume', format: 1, exportedAt: '2026-10-01T10:00:00Z', data: s, settings: { language: 'en', currency: 'USD', theme: 'light', name: 'Gui', hideValues: true, onboardingDone: true } }
    const back = readBackup(JSON.stringify(old))
    assert.deepEqual(back.settings, { language: 'en', currency: 'USD', theme: 'light', hideValues: true, onboardingDone: true })
  })

  test('arquivos inválidos não passam', () => {
    const { s } = world()
    const err = (text: string) => {
      try {
        readBackup(text)
      } catch (e) {
        assert.ok(e instanceof BackupError)
        return e.message
      }
      return 'ok'
    }
    assert.equal(err('{nope'), 'json')
    assert.equal(err(JSON.stringify({ app: 'outro', data: s })), 'not-lume')
    const broken = { ...s, transactions: [{ ...s.transactions[0], bankId: 'sumiu' }] }
    assert.equal(err(JSON.stringify({ app: 'lume', format: 1, data: broken })), 'invalid')
    const wrongKind = { ...s, transactions: [{ ...s.transactions[0], amount: -5 }] }
    assert.equal(err(JSON.stringify({ app: 'lume', format: 1, data: wrongKind })), 'invalid')
    const twoPrimary = setPrimaryBank(s, s.banks[0].id)
    twoPrimary.banks[1] = { ...twoPrimary.banks[1], isPrimary: true }
    assert.equal(err(JSON.stringify({ app: 'lume', format: 1, data: twoPrimary })), 'invalid')
  })

  test('dados de exemplo: válidos, 6 meses, determinísticos', () => {
    const a = createSampleData('2026-11-20')
    const b = createSampleData('2026-11-20')
    assert.doesNotThrow(() => parseData(JSON.parse(JSON.stringify(a))))
    assert.equal(a.transactions.length, b.transactions.length)
    assert.deepEqual(
      a.transactions.map((t) => [t.date, t.amount, t.counterparty]),
      b.transactions.map((t) => [t.date, t.amount, t.counterparty]),
    )
    const months = new Set(a.transactions.map((t) => t.date.slice(0, 7)))
    assert.equal(months.size, 6)
    assert.ok(a.transactions.every((t) => t.date <= '2026-11-20'))
    assert.ok(a.investments.length > 10)
    assert.equal(a.banks.filter((x) => x.isPrimary).length, 1)
  })
})

describe('lembrar quem pagou ou recebeu', () => {
  test('traz a categoria e a forma de pagamento do lançamento mais recente com o nome', () => {
    let s = createSeedData('2026-01-01T00:00:00.000Z')
    const bank = s.banks[0].id
    const cat = (key: string) => s.categories.find((c) => c.nameKey === key)!.id
    ;[s] = saveTransaction(s, { kind: 'expense', amount: 100, date: '2026-01-10', bankId: bank, categoryId: cat('groceries'), counterparty: 'Zaffari', paymentMethod: 'debit' }, '2026-01-10T10:00:00.000Z')
    ;[s] = saveTransaction(s, { kind: 'expense', amount: 100, date: '2026-03-01', bankId: bank, categoryId: cat('housing'), counterparty: 'ZAFFARI', paymentMethod: 'credit' }, '2026-03-01T10:00:00.000Z')
    // Mais antigo, mas lançado depois: a data do lançamento é o que conta.
    ;[s] = saveTransaction(s, { kind: 'expense', amount: 100, date: '2026-02-01', bankId: bank, categoryId: cat('groceries'), counterparty: 'zaffari', paymentMethod: 'pix' }, '2026-04-01T10:00:00.000Z')
    // Mesmo dia: vale o criado por último.
    ;[s] = saveTransaction(s, { kind: 'expense', amount: 100, date: '2026-03-01', bankId: bank, categoryId: cat('groceries'), counterparty: 'Zaffari ', paymentMethod: 'pix' }, '2026-03-01T12:00:00.000Z')
    const memory = counterpartyMemory(s, 'expense')
    assert.deepEqual(memory.recall('zaffari'), { categoryId: cat('groceries'), paymentMethod: 'pix' })
    assert.deepEqual(memory.suggestions, ['Zaffari'])
    // Receita não enxerga as despesas.
    assert.equal(counterpartyMemory(s, 'income').recall('Zaffari'), undefined)
  })

  test('limite de sugestões e desempate pela data', () => {
    let s = createSeedData('2026-01-01T00:00:00.000Z')
    const bank = s.banks[0].id
    const category = s.categories.find((c) => c.kind === 'expense')!.id
    for (let i = 0; i < 60; i++) {
      ;[s] = saveTransaction(s, { kind: 'expense', amount: 1, date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, bankId: bank, categoryId: category, counterparty: `Loja ${i}` })
    }
    const memory = counterpartyMemory(s, 'expense', 10)
    assert.equal(memory.suggestions.length, 10)
    assert.ok(memory.suggestions.every((name) => /^Loja \d+$/.test(name)))
    assert.ok(memory.recall('loja 59'))
  })

  test('10 mil lançamentos: monta em poucos milissegundos e cada consulta é imediata', () => {
    let s = createSeedData('2026-01-01T00:00:00.000Z')
    const bank = s.banks[0].id
    const category = s.categories.find((c) => c.kind === 'expense')!.id
    const base = { kind: 'expense' as const, amount: 1, bankId: bank, categoryId: category, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
    s = { ...s, transactions: Array.from({ length: 10_000 }, (_, i) => ({ ...base, id: `t${i}`, date: '2026-01-01', counterparty: `Loja ${i % 500}` })) }
    const started = performance.now()
    const memory = counterpartyMemory(s, 'expense')
    const built = performance.now() - started
    const lookups = performance.now()
    for (let i = 0; i < 1000; i++) memory.recall(`loja ${i % 500}`)
    assert.ok(built < 200, `montar levou ${built} ms`)
    assert.ok(performance.now() - lookups < 50)
  })
})
