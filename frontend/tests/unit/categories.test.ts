// Categorias: nome repetido (também contra o catálogo em outro idioma), ícone, limite, exclusão
// (relatórios, o que vai para o servidor), ordem da lista e o lote de restauração.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createSeedData, DataError, deleteCategory, duplicateCategory, LIMITS, saveCategory, saveReport, saveTransaction, type CategoryInput } from '../../src/data/model'
import { categoriesByName, categoryUsageCounts } from '../../src/data/selectors'
import { diff, emptyPending, merge, pendingCount, toPayload } from '../../src/data/sync'
import type { Category, DataState, Transaction } from '../../src/data/types'

const NOW = '2026-11-21T12:00:00.000Z'

function seed() {
  const s = createSeedData('2026-01-01T00:00:00.000Z')
  const bank = (name: string) => s.banks.find((b) => b.name === name)!.id
  const cat = (key: string) => s.categories.find((c) => c.nameKey === key)!.id
  return { s, bank, cat }
}

const input = (extra: Partial<CategoryInput> = {}): CategoryInput => ({ kind: 'expense', name: 'Academia', icon: 'dumbbell', color: '#FF453A', ...extra })

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    assert.ok(err instanceof DataError, `esperava DataError, veio ${err}`)
    return err.field ? `${err.code}:${err.field}` : err.code
  }
  assert.fail('não lançou erro')
}

describe('nome repetido', () => {
  test('conta o nome do catálogo em qualquer idioma, sem acento ou maiúsculas, só no mesmo tipo', () => {
    const { s } = seed()
    for (const name of ['Mercado', ' mercado ', 'Groceries', 'Supermercado y almacén', 'EDUCACAO']) {
      const expected = name === 'Supermercado y almacén' ? null : 'duplicate:name'
      if (expected) assert.equal(code(() => saveCategory(s, input({ name }))), expected, name)
      else assert.doesNotThrow(() => saveCategory(s, input({ name })), name)
    }
    // Receita com o nome de uma despesa: são listas separadas.
    assert.doesNotThrow(() => saveCategory(s, input({ kind: 'income', name: 'Mercado', icon: 'cart' })))
    assert.equal(duplicateCategory(s, 'income', 'salario')?.nameKey, 'salary')
  })

  test('editar sem trocar o nome vale; renomear para o de outra não', () => {
    const { s, cat } = seed()
    const [kept] = saveCategory(s, { id: cat('housing'), ...input({ name: 'Moradia', icon: 'sofa' }), keepTranslation: true })
    assert.equal(kept.categories.find((c) => c.id === cat('housing'))!.icon, 'sofa')
    assert.equal(code(() => saveCategory(s, { id: cat('housing'), ...input({ name: 'mercado' }) })), 'duplicate:name')
    // Repetição vinda de versão anterior: dá para mudar a cor sem trocar o nome.
    const legacy: DataState = {
      ...s,
      categories: [...s.categories, { id: 'x1', kind: 'expense', name: 'Academia', icon: 'dumbbell', color: '#FF453A', createdAt: NOW, updatedAt: NOW }, { id: 'x2', kind: 'expense', name: 'academia', icon: 'dumbbell', color: '#FF453A', createdAt: NOW, updatedAt: NOW }],
    }
    assert.doesNotThrow(() => saveCategory(legacy, { id: 'x2', ...input({ name: 'academia', color: '#0A84FF' }) }))
    // Mudar o tipo conta como nome novo naquele tipo.
    assert.doesNotThrow(() => saveCategory(legacy, { id: 'x2', ...input({ kind: 'income', name: 'academia' }) }))
  })
})

describe('cadastro', () => {
  test('ícone da grade; um ícone antigo fora dela continua valendo enquanto não muda', () => {
    const { s } = seed()
    assert.equal(code(() => saveCategory(s, input({ icon: 'nao-existe' }))), 'invalid:icon')
    const legacy: DataState = { ...s, categories: [...s.categories, { id: 'old', kind: 'expense', name: 'Seguro', icon: 'shield', color: '#8E8E93', createdAt: NOW, updatedAt: NOW }] }
    assert.doesNotThrow(() => saveCategory(legacy, { id: 'old', ...input({ name: 'Seguro', icon: 'shield', color: '#0A84FF' }) }))
    assert.equal(code(() => saveCategory(legacy, { id: 'old', ...input({ name: 'Seguro', icon: 'outro-que-nao-existe' }) })), 'invalid:icon')
  })

  test('limite de categorias: o mesmo do backup', () => {
    const { s } = seed()
    const categories: Category[] = Array.from({ length: LIMITS.categories }, (_, i) => ({ id: `c${i}`, kind: 'expense', name: `Cat ${i}`, icon: 'tag', color: '#0A84FF', createdAt: NOW, updatedAt: NOW }))
    const full = { ...s, categories }
    assert.equal(code(() => saveCategory(full, input())), 'limit')
    assert.doesNotThrow(() => saveCategory(full, { id: 'c0', ...input({ name: 'Cat 0 nova' }) }))
  })
})

describe('excluir categoria', () => {
  function withEntries() {
    const { s, bank, cat } = seed()
    let state = s
    const add = (key: string, who: string) => {
      ;[state] = saveTransaction(state, { kind: 'expense', amount: 1000, date: '2026-11-10', bankId: bank('Nubank'), categoryId: cat(key), counterparty: who })
    }
    add('pets', 'Petz')
    add('pets', 'Veterinário')
    add('groceries', 'Zaffari')
    ;[state] = saveReport(state, { name: 'Só pets', filters: { kinds: [], categoryIds: [cat('pets')], bankIds: [] }, groupBy: 'month' })
    ;[state] = saveReport(state, { name: 'Pets e outras', filters: { kinds: [], categoryIds: [cat('pets'), cat('other_expense')], bankIds: [] }, groupBy: 'month' })
    ;[state] = saveReport(state, { name: 'Tudo', filters: { kinds: [], categoryIds: [], bankIds: [] }, groupBy: 'month' })
    return { state, cat }
  }

  test('lançamentos vão para a escolhida, com a alteração registrada; os outros ficam iguais', () => {
    const { state, cat } = withEntries()
    const next = deleteCategory(state, cat('pets'), cat('other_expense'), NOW)
    const moved = next.transactions.filter((t) => t.counterparty !== 'Zaffari')
    assert.ok(moved.every((t) => t.categoryId === cat('other_expense') && t.updatedAt === NOW))
    assert.equal(
      next.transactions.find((t) => t.counterparty === 'Zaffari'),
      state.transactions.find((t) => t.counterparty === 'Zaffari'),
    )
  })

  test('relatórios salvos passam a filtrar a escolhida, sem repetir; os outros nem mudam', () => {
    const { state, cat } = withEntries()
    const next = deleteCategory(state, cat('pets'), cat('other_expense'), NOW)
    const byName = (name: string) => next.reports.find((r) => r.name === name)!
    assert.deepEqual(byName('Só pets').filters.categoryIds, [cat('other_expense')])
    assert.deepEqual(byName('Pets e outras').filters.categoryIds, [cat('other_expense')])
    assert.equal(byName('Tudo'), state.reports.find((r) => r.name === 'Tudo'))
    // Para o servidor: a categoria excluída, 2 lançamentos e 2 relatórios.
    assert.equal(pendingCount(diff(state, next)), 1 + 2 + 2)
  })

  test('20 mil lançamentos movidos em poucos milissegundos', () => {
    const { s, bank, cat } = seed()
    const base: Transaction = { id: '', kind: 'expense', amount: 1000, date: '2026-01-01', bankId: bank('Nubank'), categoryId: cat('groceries'), counterparty: 'Mercado', createdAt: NOW, updatedAt: NOW }
    const transactions = Array.from({ length: 100_000 }, (_, i) => ({ ...base, id: `t${i}`, categoryId: i % 5 === 0 ? cat('pets') : cat('groceries') }))
    const state = { ...s, transactions }
    const started = performance.now()
    const changes = diff(state, deleteCategory(state, cat('pets'), cat('other_expense'), NOW))
    const elapsed = performance.now() - started
    assert.equal(changes.upserts.transactions.size, 20_000)
    assert.ok(elapsed < 400, `${elapsed.toFixed(0)} ms`)
  })
})

describe('lista', () => {
  test('em ordem de nome (com acento e números), "Outras …" no fim; uso contado numa passada', () => {
    const { s, bank, cat } = seed()
    const extra: Category[] = ['Item 10', 'Item 2', 'Ábaco'].map((name, i) => ({ id: `e${i}`, kind: 'expense', name, icon: 'tag', color: '#0A84FF', createdAt: NOW, updatedAt: NOW }))
    const state = { ...s, categories: [...s.categories, ...extra] }
    const names = categoriesByName(state.categories, 'expense', (c) => c.name ?? c.nameKey ?? '', 'pt-BR').map((x) => x.name)
    assert.equal(names[0], 'Ábaco')
    assert.ok(names.indexOf('Item 2') < names.indexOf('Item 10'))
    assert.equal(names.at(-1), 'other_expense')
    assert.equal(names.length, 19)
    let withTx = state
    ;[withTx] = saveTransaction(withTx, { kind: 'expense', amount: 100, date: '2026-11-01', bankId: bank('Nubank'), categoryId: cat('pets'), counterparty: 'x' })
    assert.equal(categoryUsageCounts(withTx).get(cat('pets')), 1)
  })
})

describe('lote de restauração', () => {
  test('backup e "Desfazer" vão marcados; a marca sobrevive à junção com outras mudanças', () => {
    const { s, cat } = seed()
    const [edited] = saveCategory(s, { id: cat('pets'), ...input({ name: 'Bichos', icon: 'paw' }) })
    const plain = diff(s, edited)
    assert.equal(plain.restore, false)
    assert.equal(toPayload(plain, 1).restore, undefined)
    const restored = diff(edited, s)
    restored.restore = true
    const merged = merge(merge(emptyPending(), plain), restored)
    assert.equal(merged.restore, true)
    assert.equal(toPayload(merged, 1).restore, true)
  })
})
