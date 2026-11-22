import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { positionKey } from '../../src/data/investments'
import { createSeedData, resolveAsset, saveInvestment, type InvestmentInput } from '../../src/data/model'
import { heldQuantity, investmentPositions, isOpenPosition } from '../../src/data/selectors'
import type { DataState } from '../../src/data/types'
import { presetFrom } from '../../src/screens/investments/PositionRow'

function world() {
  let s: DataState = createSeedData('2026-01-01T00:00:00.000Z')
  const bank = (name: string) => s.banks.find((b) => b.name === name)!.id
  let clock = 0
  const op = (input: Partial<InvestmentInput> & Pick<InvestmentInput, 'operation' | 'type' | 'amount' | 'date'>, bankName = 'XP Investimentos') => {
    // Horário de criação crescente: desempata operações do mesmo dia na ordem em que foram feitas.
    const created = new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString()
    const [next, inv] = saveInvestment(s, { asset: '', bankId: bank(bankName), ...input } as InvestmentInput, created)
    s = next
    return inv
  }
  const position = (asset: string, upTo?: string) => investmentPositions(s, upTo).find((p) => p.asset === asset)!
  return {
    get s() {
      return s
    },
    bank,
    op,
    position,
  }
}

describe('carteira pelo custo médio', () => {
  test('renda fixa: o que o resgate passa do custo é ganho realizado', () => {
    const w = world()
    w.op({ operation: 'contribution', type: 'cdb', amount: 100000, date: '2026-01-10', asset: 'CDB Banco X' })
    w.op({ operation: 'redemption', type: 'cdb', amount: 50000, date: '2026-03-10', asset: 'CDB Banco X' })
    let p = w.position('CDB Banco X')
    assert.equal(p.cost, 50000)
    assert.equal(p.realized, 0)
    w.op({ operation: 'redemption', type: 'cdb', amount: 65000, date: '2026-06-10', asset: 'CDB Banco X' })
    p = w.position('CDB Banco X')
    assert.equal(p.cost, 0)
    assert.equal(p.realized, 15000)
    assert.equal(isOpenPosition(p), false)
  })

  test('poupança resgatada pelo que entrou: sem resultado', () => {
    const w = world()
    w.op({ operation: 'contribution', type: 'savings', amount: 20000, date: '2026-01-10' })
    w.op({ operation: 'redemption', type: 'savings', amount: 20000, date: '2026-02-10' })
    const [p] = investmentPositions(w.s)
    assert.equal(p.realized, 0)
    assert.equal(isOpenPosition(p), false)
  })

  test('custo médio: compra a preços diferentes, venda parcial mantém o preço médio', () => {
    const w = world()
    w.op({ operation: 'contribution', type: 'stock', amount: 100000, date: '2026-01-10', asset: 'itsa4', quantity: 100, unitPrice: 1000 })
    w.op({ operation: 'contribution', type: 'stock', amount: 200000, date: '2026-02-10', asset: 'ITSA4', quantity: 100, unitPrice: 2000 })
    let p = w.position('ITSA4')
    assert.equal(p.averagePrice, 1500)
    w.op({ operation: 'redemption', type: 'stock', amount: 100000, date: '2026-03-10', asset: 'ITSA4', quantity: 50, unitPrice: 2000 })
    p = w.position('ITSA4')
    assert.equal(p.quantity, 150)
    assert.equal(p.cost, 225000)
    assert.equal(p.averagePrice, 1500)
    assert.equal(p.realized, 100000 - 75000)
  })

  test('vender mais do que havia: só a parte que existia entra no resultado', () => {
    const w = world()
    w.op({ operation: 'contribution', type: 'stock', amount: 100000, date: '2026-01-10', asset: 'PETR4', quantity: 100, unitPrice: 1000 })
    // Vendeu 150 a R$ 15 (R$ 2.250): 50 delas foram compradas antes de começar a usar o Lume.
    w.op({ operation: 'redemption', type: 'stock', amount: 225000, date: '2026-02-10', asset: 'PETR4', quantity: 150, unitPrice: 1500 })
    const p = w.position('PETR4')
    assert.equal(p.quantity, 0)
    assert.equal(p.cost, 0)
    assert.equal(p.realized, 150000 - 100000) // antes: 225.000 − 100.000
  })

  test('venda sem nada em carteira não inventa custo nem resultado', () => {
    const w = world()
    w.op({ operation: 'redemption', type: 'stock', amount: 50000, date: '2026-02-10', asset: 'VALE3', quantity: 10, unitPrice: 5000 })
    const p = w.position('VALE3')
    assert.equal(p.realized, 0)
    assert.equal(p.cost, 0)
    assert.equal(p.redemptions, 50000)
  })

  test('dados antigos: ação aplicada e resgatada sem quantidade baixa pelo valor e encerra', () => {
    // Cofres e backups de antes da v0.3.5 podem ter operações de ações sem quantidade; o servidor
    // as aceita na importação, e a carteira não pode ficar com custo preso para sempre.
    const w = world()
    const base = { type: 'stock', asset: 'ITUB4', bankId: w.bank('XP Investimentos'), createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' } as const
    const state: DataState = {
      ...w.s,
      investments: [
        { ...base, id: 'old-1', operation: 'contribution', amount: 100000, date: '2025-01-10' },
        { ...base, id: 'old-2', operation: 'redemption', amount: 120000, date: '2025-06-10' },
      ],
    }
    const p = investmentPositions(state).find((x) => x.asset === 'ITUB4')!
    assert.equal(p.cost, 0)
    assert.equal(p.realized, 20000)
    assert.equal(isOpenPosition(p), false)
  })

  test('cripto: 0,1 + 0,2 e venda de 0,3 zera a posição sem sobra de arredondamento', () => {
    const w = world()
    w.op({ operation: 'contribution', type: 'crypto', amount: 5000000, date: '2026-01-10', asset: 'BTC', quantity: 0.1, unitPrice: 50000000 })
    w.op({ operation: 'contribution', type: 'crypto', amount: 10000000, date: '2026-01-11', asset: 'BTC', quantity: 0.2, unitPrice: 50000000 })
    assert.equal(w.position('BTC').quantity, 0.3)
    w.op({ operation: 'redemption', type: 'crypto', amount: 18000000, date: '2026-02-10', asset: 'BTC', quantity: 0.3, unitPrice: 60000000 })
    const p = w.position('BTC')
    assert.equal(p.quantity, 0)
    assert.equal(p.cost, 0)
    assert.equal(p.realized, 3000000)
  })

  test('operação agendada só entra na carteira na data dela', () => {
    const w = world()
    w.op({ operation: 'contribution', type: 'cdb', amount: 100000, date: '2026-01-10', asset: 'CDB A' })
    w.op({ operation: 'contribution', type: 'cdb', amount: 50000, date: '2026-12-10', asset: 'CDB A' })
    assert.equal(w.position('CDB A', '2026-11-21').cost, 100000)
    assert.equal(w.position('CDB A').cost, 150000)
  })

  test('rendimentos e IR retido ficam na posição', () => {
    const w = world()
    w.op({ operation: 'contribution', type: 'fii', amount: 100000, date: '2026-01-10', asset: 'HGLG11', quantity: 10, unitPrice: 10000 })
    w.op({ operation: 'earning', type: 'fii', amount: 950, date: '2026-02-15', asset: 'HGLG11', earningKind: 'fii_income' })
    w.op({ operation: 'earning', type: 'fii', amount: 1000, date: '2026-03-15', asset: 'HGLG11', earningKind: 'fii_income', taxWithheld: 50 })
    const p = w.position('HGLG11')
    assert.equal(p.earnings, 1950)
    assert.equal(p.taxWithheld, 50)
    assert.equal(p.cost, 100000)
  })

  test('20 mil operações em 500 ativos: carteira em poucos milissegundos', () => {
    const w = world()
    const bankId = w.bank('XP Investimentos')
    const ops = Array.from({ length: 20_000 }, (_, i) => ({
      id: `i${i}`,
      operation: (i % 5 === 4 ? 'redemption' : 'contribution') as 'redemption' | 'contribution',
      type: 'stock' as const,
      amount: 10000,
      date: `20${10 + (i % 17)}-${String((i % 12) + 1).padStart(2, '0')}-10`,
      bankId,
      asset: `ATV${i % 500}`,
      quantity: 10,
      unitPrice: 1000,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }))
    const s = { ...w.s, investments: ops }
    const started = performance.now()
    const positions = investmentPositions(s, '2026-11-21')
    const elapsed = performance.now() - started
    assert.equal(positions.length, 500)
    assert.ok(elapsed < 150, `${elapsed.toFixed(1)} ms`)
  })
})

describe('formulário de resgate', () => {
  test('quantidade em carteira na data, sem a operação em edição, por instituição', () => {
    const w = world()
    w.op({ operation: 'contribution', type: 'stock', amount: 100000, date: '2026-01-10', asset: 'BBAS3', quantity: 100, unitPrice: 1000 })
    const sale = w.op({ operation: 'redemption', type: 'stock', amount: 30000, date: '2026-02-10', asset: 'BBAS3', quantity: 30, unitPrice: 1000 })
    w.op({ operation: 'contribution', type: 'stock', amount: 50000, date: '2026-03-10', asset: 'BBAS3', quantity: 50, unitPrice: 1000 })
    w.op({ operation: 'contribution', type: 'stock', amount: 50000, date: '2026-01-10', asset: 'BBAS3', quantity: 999, unitPrice: 50 }, 'Nubank')
    const key = positionKey({ type: 'stock', asset: 'BBAS3', bankId: w.bank('XP Investimentos') })
    assert.equal(heldQuantity(w.s, key, '2026-01-31'), 100)
    assert.equal(heldQuantity(w.s, key, '2026-02-28'), 70)
    // Editando a própria venda: ela não conta (senão a venda "não caberia" nela mesma).
    assert.equal(heldQuantity(w.s, key, '2026-02-28', sale.id), 100)
    assert.equal(heldQuantity(w.s, key, '2026-12-31'), 120)
    assert.equal(heldQuantity(w.s, key, '2025-12-31'), 0)
  })

  test('nome do ativo igual ao que a gravação usa', () => {
    assert.equal(resolveAsset({ type: 'stock', asset: '  petr4 ' }, 'XP'), 'PETR4')
    assert.equal(resolveAsset({ type: 'treasury', asset: '', treasuryTitle: 'ipca', maturity: '2035-05-15' }, 'XP'), 'Tesouro IPCA+ 2035')
    assert.equal(resolveAsset({ type: 'cdb', asset: '' }, 'Nubank'), 'CDB Nubank')
    assert.equal(resolveAsset({ type: 'cdb', asset: '', issuer: 'Banco Inter' }, 'XP'), 'CDB Banco Inter')
    assert.equal(resolveAsset({ type: 'gold', asset: 'qualquer' }, 'XP'), 'Ouro')
  })

  test('atalho de nova operação copia o ativo, não valores nem data', () => {
    const w = world()
    const inv = w.op({ operation: 'contribution', type: 'treasury', amount: 100000, date: '2026-01-10', treasuryTitle: 'ipca', maturity: '2035-05-15', quantity: 0.5, unitPrice: 200000, note: 'nota' })
    const preset = presetFrom(inv, 'redemption')
    assert.equal(preset.operation, 'redemption')
    assert.equal(preset.asset, 'Tesouro IPCA+ 2035')
    assert.equal(preset.treasuryTitle, 'ipca')
    assert.equal(preset.maturity, '2035-05-15')
    for (const key of ['amount', 'quantity', 'unitPrice', 'date', 'note', 'id', 'createdAt']) assert.equal(key in preset, false, key)
  })
})
