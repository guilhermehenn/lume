import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createSeedData, deleteBank, deleteTransaction, saveBank, saveTransaction, setPrimaryBank } from '../../src/data/model'
import { createSampleData } from '../../src/data/sample'
import { diff, emptyPending, isEmpty, merge, pendingCount, rebase, toPayload, fitsKeepalive } from '../../src/data/sync'
import type { DataState } from '../../src/data/types'

const NOW = '2026-11-20T12:00:00.000Z'

function base(): DataState {
  return createSeedData(NOW)
}

function addTx(state: DataState, amount = 1000) {
  const bank = state.banks[0]
  const category = state.categories.find((c) => c.kind === 'expense')!
  return saveTransaction(state, { kind: 'expense', amount, date: '2026-11-10', bankId: bank.id, categoryId: category.id, counterparty: 'Padaria' }, NOW)
}

describe('diferenças para gravar no cofre', () => {
  test('nada mudou, nada a gravar', () => {
    const s = base()
    assert.ok(isEmpty(diff(s, s)))
    assert.ok(isEmpty(diff(s, { ...s, banks: [...s.banks] })))
    // cópia profunda igual também não conta como mudança
    assert.ok(isEmpty(diff(s, JSON.parse(JSON.stringify(s)))))
  })

  test('inclusão, alteração e exclusão', () => {
    const s0 = base()
    const [s1, tx] = addTx(s0)
    const d1 = diff(s0, s1)
    assert.equal(pendingCount(d1), 1)
    assert.equal(d1.upserts.transactions.get(tx.id), tx)

    const [s2] = saveTransaction(s1, { ...tx, amount: 2500 }, NOW)
    const d2 = diff(s1, s2)
    assert.equal((d2.upserts.transactions.get(tx.id) as typeof tx).amount, 2500)

    const s3 = deleteTransaction(s2, tx.id)
    const d3 = diff(s2, s3)
    assert.deepEqual([...d3.deletes.transactions], [tx.id])
    assert.equal(pendingCount(d3), 1)
  })

  test('banco principal muda só os bancos afetados', () => {
    const s0 = base()
    const s1 = setPrimaryBank(s0, s0.banks[2].id)
    const s2 = setPrimaryBank(s1, s0.banks[5].id)
    const d = diff(s1, s2)
    assert.deepEqual([...d.upserts.banks.keys()].sort(), [s0.banks[2].id, s0.banks[5].id].sort())
  })

  test('excluir banco movendo lançamentos gera as duas coisas', () => {
    const s0 = base()
    const [s1, tx] = addTx(s0)
    const s2 = deleteBank(s1, s0.banks[0].id, s0.banks[1].id)
    const d = diff(s1, s2)
    assert.deepEqual([...d.deletes.banks], [s0.banks[0].id])
    assert.equal((d.upserts.transactions.get(tx.id) as typeof tx).bankId, s0.banks[1].id)
  })

  test('juntar mudanças: a mais recente vence', () => {
    const s0 = base()
    const [s1, tx] = addTx(s0)
    const pending = merge(emptyPending(), diff(s0, s1))
    const s2 = deleteTransaction(s1, tx.id)
    merge(pending, diff(s1, s2))
    assert.equal(pending.upserts.transactions.size, 0)
    assert.ok(pending.deletes.transactions.has(tx.id))
    // e voltar (desfazer) troca a exclusão por inclusão de novo
    merge(pending, diff(s2, s1))
    assert.equal(pending.deletes.transactions.size, 0)
    assert.equal(pending.upserts.transactions.get(tx.id), tx)
  })

  test('formato enviado ao servidor', () => {
    const s0 = base()
    const [s1, tx] = addTx(s0)
    const [s2, bank] = saveBank(s1, { name: 'Banco Novo', kind: 'digital', color: '#123456', initialBalance: 0, isPrimary: false }, NOW)
    const payload = toPayload(diff(s0, s2), 7)
    assert.equal(payload.baseRevision, 7)
    assert.deepEqual(Object.keys(payload.upserts).sort(), ['banks', 'transactions'])
    assert.equal((payload.upserts.banks as { id: string }[])[0].id, bank.id)
    assert.equal((payload.upserts.transactions as { id: string }[])[0].id, tx.id)
    assert.deepEqual(payload.deletes, {})
    assert.ok(fitsKeepalive(payload))
  })

  test('aplicar pendências sobre dados mais novos do servidor (outra janela)', () => {
    const s0 = base()
    const [mine, myTx] = addTx(s0, 111)
    const pending = diff(s0, mine)
    // outra janela incluiu um lançamento e renomeou um banco
    const [theirs, theirTx] = addTx(s0, 999)
    const [server] = saveBank(theirs, { ...theirs.banks[3], name: 'Renomeado' }, NOW)
    const merged = rebase(server, pending)
    assert.deepEqual(merged.transactions.map((t) => t.id), [theirTx.id, myTx.id])
    assert.equal(merged.banks[3].name, 'Renomeado')
    // exclusão pendente some mesmo se o servidor ainda tem o item
    const del = diff(mine, deleteTransaction(mine, myTx.id))
    const after = rebase({ ...server, transactions: [...server.transactions, myTx] }, del)
    assert.deepEqual(after.transactions.map((t) => t.id), [theirTx.id])
  })

  test('trocar tudo (dados de exemplo) e voltar', () => {
    const s0 = base()
    const sample = createSampleData()
    const d = diff(s0, sample)
    assert.equal(d.upserts.transactions.size, sample.transactions.length)
    const back = diff(sample, s0)
    assert.equal(back.deletes.transactions.size, sample.transactions.length)
    assert.equal(rebase(sample, back).transactions.length, 0)
  })
})

describe('dados da v0.2', () => {
  test('bancos sem id (erro da v0.2) são consertados na importação', async () => {
    const { repairLegacy } = await import('../../src/data/prefs')
    const { parseData } = await import('../../src/data/backup')
    const s = base()
    const [withTx] = addTx(s)
    const broken = JSON.parse(JSON.stringify(withTx)) as { banks: Record<string, unknown>[]; transactions: Record<string, unknown>[] }
    broken.banks.push({ name: 'Cofrinho', kind: 'savings', color: '#30D158', initialBalance: 0, isPrimary: false, createdAt: NOW, updatedAt: NOW })
    broken.transactions.push({ ...broken.transactions[0], id: 'tx-orfao', bankId: undefined })
    const clean = JSON.parse(JSON.stringify(broken))
    assert.throws(() => parseData(clean))
    const fixed = parseData(repairLegacy(clean))
    const cofrinho = fixed.banks.find((b) => b.name === 'Cofrinho')!
    assert.ok(cofrinho.id)
    assert.equal(fixed.transactions.find((t) => t.id === 'tx-orfao')!.bankId, cofrinho.id)
    // dados sem o problema passam intactos
    assert.equal(repairLegacy(withTx), withTx)
  })
})

describe('e-mail e senha na criação do cofre', () => {
  test('sugestão para erros de digitação em domínios comuns', async () => {
    const { suggestEmail, isValidEmail, passwordProblem } = await import('../../src/lib/password')
    assert.equal(suggestEmail('gui@gmial.com'), 'gui@gmail.com')
    assert.equal(suggestEmail('gui@gmail.con'), 'gui@gmail.com')
    assert.equal(suggestEmail('ana@hotmial.com'), 'ana@hotmail.com')
    assert.equal(suggestEmail('ana@outlok.com'), 'ana@outlook.com')
    assert.equal(suggestEmail('Gui.Henn@Yaho.com.br'), 'Gui.Henn@yahoo.com.br')
    assert.equal(suggestEmail('gui@gmail.com'), null)
    assert.equal(suggestEmail('gui@empresa.com.br'), null) // domínio próprio: nada a sugerir
    assert.equal(suggestEmail('gui@'), null)
    assert.ok(isValidEmail('  gui+lume@example.com.br '))
    assert.ok(!isValidEmail('gui@@example.com'))
    assert.ok(!isValidEmail('gui example@x.com'))
    assert.equal(passwordProblem(' comeca com espaco'), 'spaces')
    assert.equal(passwordProblem('1234567'), 'short')
    assert.equal(passwordProblem('x'.repeat(201)), 'long')
    assert.equal(passwordProblem('frase longa e boa'), null)
  })
})
