// Dados de exemplo (6 meses) para conhecer o app sem digitar nada.
// Determinístico: a mesma data base gera sempre os mesmos lançamentos.

import { addMonths, currentMonth, monthRange, todayISO } from '../lib/dates'
import { createSeedData, saveInvestment, saveTransaction, setPrimaryBank } from './model'
import type { DataState, Kind, PaymentMethod } from './types'

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

export function createSampleData(today: string = todayISO()): DataState {
  let state = createSeedData()
  const bank = (name: string) => state.banks.find((b) => b.name === name)!.id
  const nubank = bank('Nubank')
  const itau = bank('Itaú')
  const xp = bank('XP Investimentos')
  state = setPrimaryBank(state, nubank)
  state = {
    ...state,
    banks: state.banks.map((b) =>
      b.id === nubank ? { ...b, initialBalance: 450000 } : b.id === itau ? { ...b, initialBalance: 1500000 } : b.id === xp ? { ...b, initialBalance: 2000000 } : b,
    ),
  }
  const cat = (key: string) => state.categories.find((c) => c.nameKey === key)!.id
  const random = rng(20261120)
  const end = currentMonth(new Date(`${today}T12:00:00`))

  const add = (kind: Kind, amount: number, date: string, bankId: string, categoryKey: string, counterparty: string, paymentMethod?: PaymentMethod, note?: string) => {
    if (date > today) return
    ;[state] = saveTransaction(state, { kind, amount, date, bankId, categoryId: cat(categoryKey), counterparty, paymentMethod, note })
  }

  for (let back = 5; back >= 0; back--) {
    const month = addMonths(end, -back)
    const { to } = monthRange(month)
    const day = (d: number) => `${month}-${String(Math.min(d, Number(to.slice(8)))).padStart(2, '0')}`
    add('income', 820000, day(5), nubank, 'salary', 'Empresa XYZ Ltda', undefined, 'Salário líquido')
    if (back % 2 === 0) add('income', 150000 + Math.round(random() * 90000), day(18), itau, 'freelance', 'Cliente Studio Norte')
    add('expense', 230000, day(10), itau, 'housing', 'Imobiliária Centro', 'boleto', 'Aluguel')
    add('expense', 18990, day(12), nubank, 'bills', 'CEEE Equatorial', 'pix', 'Luz')
    add('expense', 9990, day(15), nubank, 'bills', 'Vivo Fibra', 'credit', 'Internet')
    add('expense', 5590, day(8), nubank, 'subscriptions', 'Netflix', 'credit')
    add('expense', 2190, day(8), nubank, 'subscriptions', 'Spotify', 'credit')
    for (let w = 0; w < 4; w++) {
      add('expense', 32000 + Math.round(random() * 22000), day(3 + w * 7), nubank, 'groceries', w % 2 ? 'Zaffari' : 'Supermercado Asun', 'debit')
      add('expense', 4500 + Math.round(random() * 9000), day(5 + w * 7), nubank, 'restaurants', ['iFood', 'Café do Centro', 'Pizzaria Bella'][w % 3], 'credit')
      add('expense', 1800 + Math.round(random() * 4000), day(6 + w * 7), nubank, 'transport', w % 2 ? 'Uber' : 'Posto Ipiranga', w % 2 ? 'credit' : 'debit')
    }
    if (back % 3 === 1) add('expense', 18000 + Math.round(random() * 20000), day(20), itau, 'health', 'Farmácia São João', 'debit')
    if (back === 2) add('expense', 189000, day(22), nubank, 'travel', 'Latam', 'credit', 'Passagens para as férias')
    if (back % 2 === 1) add('expense', 12000 + Math.round(random() * 15000), day(24), nubank, 'shopping', 'Renner', 'credit')
    add('expense', 15900, day(14), itau, 'education', 'Curso de Inglês', 'boleto')

    const inv = (input: Parameters<typeof saveInvestment>[1]) => {
      if (input.date > today) return
      ;[state] = saveInvestment(state, input)
    }
    inv({ operation: 'contribution', type: 'cdb', amount: 100000, date: day(6), bankId: nubank, asset: '', issuer: 'Nu Financeira', issuerCnpj: '30.680.829/0001-43', indexer: 'cdi', rate: '100% CDI', dailyLiquidity: true })
    inv({ operation: 'contribution', type: 'fii', amount: 50000 + 0, date: day(7), bankId: xp, asset: 'HGLG11', quantity: 3, unitPrice: 16500, fees: 500 })
    inv({ operation: 'earning', type: 'fii', amount: 330 * (6 - back), date: day(15), bankId: xp, asset: 'HGLG11', earningKind: 'fii_income' })
    if (back % 2 === 0) inv({ operation: 'contribution', type: 'treasury', amount: 30000, date: day(9), bankId: xp, asset: '', treasuryTitle: 'ipca', maturity: '2035-05-15', quantity: 0.0937, unitPrice: 320171, rate: 'IPCA + 6,8%' })
    if (back === 3) inv({ operation: 'contribution', type: 'crypto', amount: 50000, date: day(11), bankId: xp, asset: 'BTC', cryptoClass: 'bitcoin', quantity: 0.00098, unitPrice: 51020408 })
  }
  return state
}
