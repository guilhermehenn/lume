import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createSeedData, saveInvestment, setPrimaryBank } from '../../src/data/model'
import { computedTotal, defaultInvestmentBank, initialInvestment, TOTAL_FIELDS, toInvestmentInput } from '../../src/screens/entry/investmentForm'

describe('formulário de investimento', () => {
  test('total calculado: aplicação soma taxas, resgate desconta, sem quantidade ou preço é zero', () => {
    const base = { quantity: 10, unitPrice: 2550, fees: 490 }
    assert.equal(computedTotal({ ...base, operation: 'contribution' }), 10 * 2550 + 490)
    assert.equal(computedTotal({ ...base, operation: 'redemption' }), 10 * 2550 - 490)
    assert.equal(computedTotal({ ...base, operation: 'redemption', fees: 999_999 }), 0)
    assert.equal(computedTotal({ ...base, operation: 'contribution', quantity: undefined }), 0)
    assert.equal(computedTotal({ ...base, operation: 'contribution', unitPrice: 0 }), 0)
    // Fração de cota arredonda para centavos.
    assert.equal(computedTotal({ operation: 'contribution', quantity: 0.333, unitPrice: 1000, fees: 0 }), 333)
    assert.deepEqual([...TOTAL_FIELDS].sort(), ['fees', 'operation', 'quantity', 'unitPrice'])
  })

  test('instituição padrão: a do último investimento; senão corretora; senão banco principal', () => {
    let s = createSeedData('2026-01-01T00:00:00.000Z')
    const broker = s.banks.find((b) => b.kind === 'broker')!.id
    assert.equal(defaultInvestmentBank(s), broker)

    const nubank = s.banks.find((b) => b.name === 'Nubank')!.id
    const itau = s.banks.find((b) => b.name === 'Itaú')!.id
    ;[s] = saveInvestment(s, { operation: 'contribution', type: 'cdb', amount: 100, date: '2026-01-02', bankId: nubank, asset: '' }, '2026-01-02T00:00:00.000Z')
    ;[s] = saveInvestment(s, { operation: 'contribution', type: 'cdb', amount: 100, date: '2026-01-01', bankId: itau, asset: '' }, '2026-01-03T00:00:00.000Z')
    // O lançado por último, não o de data mais recente.
    assert.equal(defaultInvestmentBank(s), itau)

    const noBrokers = { ...createSeedData('2026-01-01T00:00:00.000Z') }
    noBrokers.banks = noBrokers.banks.filter((b) => b.kind !== 'broker')
    const withPrimary = setPrimaryBank(noBrokers, noBrokers.banks[3].id)
    assert.equal(defaultInvestmentBank(withPrimary), noBrokers.banks[3].id)
    assert.equal(defaultInvestmentBank({ ...noBrokers, banks: [] }), '')
  })

  test('conversão para gravar: vazios viram ausentes e a gravação aceita o resultado', () => {
    const s = createSeedData('2026-01-01T00:00:00.000Z')
    const form = initialInvestment(s, undefined, { type: 'stock', operation: 'contribution' })
    const input = toInvestmentInput({ ...form, asset: 'petr4', quantity: 100, unitPrice: 3850 }, { amount: 385_000, date: '2026-05-02', note: '' })
    assert.equal(input.fees, undefined)
    assert.equal(input.issuer, undefined)
    assert.equal(input.rate, undefined)
    assert.equal(input.maturity, undefined)
    const [, saved] = saveInvestment(s, input)
    assert.equal(saved.asset, 'PETR4')
    assert.equal(saved.quantity, 100)
  })

  test('edição e preset de resgate preenchem o formulário', () => {
    const s = createSeedData('2026-01-01T00:00:00.000Z')
    const bankId = s.banks[0].id
    const [, saved] = saveInvestment(s, { operation: 'contribution', type: 'stock', amount: 1000, date: '2026-01-02', bankId, asset: 'ITSA4', quantity: 10, unitPrice: 100 })
    const editing = initialInvestment(s, saved)
    assert.equal(editing.asset, 'ITSA4')
    assert.equal(editing.bankId, bankId)
    assert.equal(editing.fees, 0)
    const preset = initialInvestment(s, undefined, { operation: 'redemption', type: 'stock', asset: 'ITSA4', bankId, quantity: 10 })
    assert.equal(preset.operation, 'redemption')
    assert.equal(preset.quantity, 10)
  })
})
