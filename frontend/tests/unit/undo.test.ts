import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { actions, captureUndoAction, clearVault, getData } from '../../src/data/store'

describe('Desfazer: aviso vinculado à alteração', () => {
  test('um aviso antigo não pode desfazer uma exclusão mais recente', () => {
    actions.resetAll()
    actions.loadSample()
    const sampleAction = captureUndoAction('Desfazer')
    assert.equal(sampleAction.isValid(), true)

    const bank = actions.saveBank({ name: 'Carteira', kind: 'cash', color: '#123456', initialBalance: 0, isPrimary: false })
    assert.equal(sampleAction.isValid(), false)
    actions.deleteBank(bank.id)
    const deletionAction = captureUndoAction('Desfazer')
    assert.equal(deletionAction.isValid(), true)

    sampleAction.onClick()
    assert.equal(getData().banks.some((item) => item.id === bank.id), false)
    assert.equal(deletionAction.isValid(), true)
    deletionAction.onClick()
    assert.equal(getData().banks.some((item) => item.id === bank.id), true)
    assert.equal(deletionAction.isValid(), false)
  })

  test('fechar o cofre invalida um aviso que ainda está na tela', () => {
    actions.loadSample()
    const action = captureUndoAction('Desfazer')
    assert.equal(action.isValid(), true)
    clearVault()
    const empty = getData()
    assert.equal(action.isValid(), false)
    action.onClick()
    assert.equal(getData(), empty)
  })
})
