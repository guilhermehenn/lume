import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { readBackup, createBackup } from '../../src/data/backup'
import { createSeedData } from '../../src/data/model'
import { createSampleData } from '../../src/data/sample'
import { actions, getData, getSettings, undo, updateSettings } from '../../src/data/store'
import { diff, emptyPending, merge, toPayload } from '../../src/data/sync'
import { createI18n, translate } from '../../src/i18n'
import { formatDateTime } from '../../src/lib/dates'

const NOW = '2026-11-20T12:00:00.000Z'

describe('Configurações: cópia do cofre antes de trocar tudo', () => {
  test('o motivo vai no lote; juntar mudanças guarda o primeiro', () => {
    const s = createSeedData(NOW)
    const sample = createSampleData('2026-11-20')
    const change = diff(s, sample)
    assert.equal(change.checkpoint, null)
    assert.equal(toPayload(change, 3).checkpoint, undefined)
    change.checkpoint = 'before-sample'
    assert.equal(toPayload(change, 3).checkpoint, 'before-sample')
    const later = emptyPending()
    later.checkpoint = 'before-reset'
    // A cópia do primeiro pedido tem o estado de antes de tudo o que veio junto.
    assert.equal(merge(change, later).checkpoint, 'before-sample')
    const fresh = emptyPending()
    assert.equal(merge(fresh, later).checkpoint, 'before-reset')
  })
})

describe('Configurações: desfazer a restauração', () => {
  test('volta os dados e também idioma, tema e moeda de antes', () => {
    actions.resetAll()
    updateSettings({ language: 'pt', theme: 'dark', currency: 'BRL', hideValues: false })
    const before = getData()
    const sample = createSampleData('2026-11-20')
    const file = createBackup(sample, { language: 'en', currency: 'USD', theme: 'light', hideValues: true, onboardingDone: true, emailCopies: false })
    actions.importBackup(readBackup(file))
    assert.equal(getSettings().language, 'en')
    assert.equal(getSettings().currency, 'USD')
    assert.equal(getData().transactions.length, sample.transactions.length)
    assert.equal(undo(), true)
    assert.equal(getData(), before)
    const s = getSettings()
    assert.deepEqual([s.language, s.currency, s.theme, s.hideValues], ['pt', 'BRL', 'dark', false])
    // Desfazer de novo não faz nada.
    assert.equal(undo(), false)
  })

  test('outra alteração depois da restauração encerra o desfazer das configurações', () => {
    updateSettings({ language: 'pt' })
    const file = createBackup(createSampleData('2026-11-20'), { language: 'es', currency: 'EUR', theme: 'system', hideValues: false, onboardingDone: true, emailCopies: false })
    actions.importBackup(file)
    actions.loadSample()
    // O "Desfazer" agora é o do exemplo: volta os dados do backup, sem mexer no idioma.
    assert.equal(undo(), true)
    assert.equal(getSettings().language, 'es')
  })
})

describe('Configurações: textos', () => {
  test('data e hora no fuso deste computador; texto que não é data fica vazio', () => {
    const iso = '2026-11-21T02:30:00.000Z'
    const local = new Date(iso)
    const text = formatDateTime(iso, 'pt-BR')
    assert.match(text, new RegExp(`${local.getDate()} de nov\\. de 2026`))
    assert.match(text, new RegExp(`${String(local.getHours()).padStart(2, '0')}:30`))
    assert.equal(formatDateTime('ontem', 'pt-BR'), '')
    assert.equal(createI18n('en', 'BRL').dateTime('2026-11-20T15:05:00'), 'Nov 20, 2026, 3:05 PM')
  })

  test('contagens no singular e no plural, nos três idiomas', () => {
    assert.equal(translate('pt', 'settings.countBanks', { count: 1 }), '1 banco')
    assert.equal(translate('pt', 'settings.countCategories', { count: 24 }), '24 categorias')
    assert.equal(translate('pt', 'settings.countReports', { count: 0 }), 'nenhum relatório salvo')
    assert.equal(translate('en', 'settings.countReports', { count: 1 }), '1 saved report')
    assert.equal(translate('es', 'settings.countCategories', { count: 1 }), '1 categoría')
    assert.equal(translate('pt', 'export.countTransactions', { count: 1234 }), '1.234 lançamentos')
    assert.equal(translate('pt', 'settings.lastCopy', { when: 'hoje', count: 1 }), 'Última cópia do cofre: hoje. 1 cópia guardada neste computador.')
  })
})
