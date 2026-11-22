import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { vaultStats } from '../../src/app/vaultStats'
import { emptyState } from '../../src/data/model'
import { createSampleData } from '../../src/data/sample'
import { getSession, signOut } from '../../src/data/session'
import { actions, clearVault, getData, hasUnsaved, saveNow } from '../../src/data/store'
import { createI18n } from '../../src/i18n'

describe('Sair e trocar de cofre', () => {
  test('com tudo salvo, gravar agora termina na hora', async () => {
    clearVault()
    assert.equal(hasUnsaved(), false)
    assert.equal(await saveNow(50), true)
  })

  test('com algo por gravar e sem cofre para receber, não sai: devolve "unsaved" e não perde nada', async () => {
    clearVault()
    actions.loadSample()
    assert.equal(hasUnsaved(), true)
    assert.equal(await saveNow(50), false)
    const before = getSession()
    assert.equal(await signOut('logout'), 'unsaved')
    assert.equal(getSession(), before) // nada mudou: a tela pergunta
    assert.ok(getData().transactions.length > 0)
    // "Sair e descartar": sai mesmo assim e limpa a memória.
    assert.equal(await signOut('switch', { force: true }), 'done')
    assert.deepEqual(getSession(), { status: 'locked', reason: 'switch' })
    assert.equal(hasUnsaved(), false)
    assert.equal(getData().transactions.length, 0)
  })
})

describe('O que há no cofre, numa linha', () => {
  const pt = createI18n('pt', 'BRL').t
  test('zero, um e vários, sem "0 banco" (no português, 0 usa a forma do singular)', () => {
    assert.equal(vaultStats(emptyState(), pt), 'nenhum banco · nenhuma categoria · nenhum lançamento · nenhuma operação de investimento · nenhum relatório salvo')
    const s = createSampleData('2026-11-20')
    const one = { ...s, banks: s.banks.slice(0, 1), categories: s.categories.slice(0, 1), transactions: s.transactions.slice(0, 1), investments: s.investments.slice(0, 1), reports: [] }
    assert.equal(vaultStats(one, pt), '1 banco · 1 categoria · 1 lançamento · 1 operação de investimento · nenhum relatório salvo')
    assert.match(vaultStats(s, createI18n('en', 'BRL').t), /^18 banks · 24 categories · \d+ transactions · \d+ investment operations · no saved reports$/)
  })
})
