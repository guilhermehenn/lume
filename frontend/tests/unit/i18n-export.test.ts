import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { CATEGORY_CATALOG } from '../../src/data/catalog'
import { accountantSheets, availableYears, investmentsCsv, transactionsCsv, yearPositions } from '../../src/data/exporters'
import { INVESTMENT_TYPES } from '../../src/data/investments'
import { createSampleData } from '../../src/data/sample'
import { createI18n, DICTIONARIES, exportContext, LANGUAGES, translate } from '../../src/i18n'
import { buildXlsxZip } from '../../src/lib/xlsx'

function flatten(obj: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.set(key, v)
    else for (const [kk, vv] of flatten(v, key)) out.set(kk, vv)
  }
  return out
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')

describe('traduções', () => {
  const pt = flatten(DICTIONARIES.pt)

  for (const lang of LANGUAGES) {
    test(`${lang}: mesmas chaves e mesmos marcadores do português`, () => {
      const dict = flatten(DICTIONARIES[lang])
      assert.deepEqual([...dict.keys()].sort(), [...pt.keys()].sort())
      for (const [key, text] of dict) {
        assert.ok(text.trim().length > 0, `${lang}.${key} vazio`)
        assert.equal(placeholders(text), placeholders(pt.get(key)!), `${lang}.${key}: marcadores diferentes`)
      }
    })
  }

  test('todas as categorias, tipos e formas de pagamento têm nome', () => {
    for (const lang of LANGUAGES) {
      for (const c of CATEGORY_CATALOG) assert.notEqual(translate(lang, `categoryNames.${c.key}`), `categoryNames.${c.key}`)
      for (const t of INVESTMENT_TYPES) assert.notEqual(translate(lang, `investmentTypes.${t.id}`), `investmentTypes.${t.id}`)
    }
  })

  test('plural, parâmetros e chave desconhecida', () => {
    assert.equal(translate('pt', 'common.entries', { count: 1 }), '1 lançamento')
    assert.equal(translate('pt', 'common.entries', { count: 1234 }), '1.234 lançamentos')
    assert.equal(translate('en', 'common.entries', { count: 0 }), '0 transactions')
    assert.equal(translate('es', 'banks.deleteTitle', { name: 'Itaú' }), '¿Eliminar Itaú?')
    assert.equal(translate('pt', 'gate.entries', { count: 0 }), 'Nenhum lançamento')
    assert.equal(translate('pt', 'gate.entries', { count: 1 }), '1 lançamento')
    assert.equal(translate('en', 'gate.entries', { count: 1234 }), '1,234 entries')
    assert.equal(translate('pt', 'nao.existe'), 'nao.existe')
  })

  test('formatos por idioma', () => {
    const pt = createI18n('pt', 'BRL')
    const en = createI18n('en', 'USD')
    assert.equal(pt.date('2026-11-20', 'short'), '20/11/2026')
    assert.equal(en.date('2026-11-20', 'short'), '11/20/2026')
    assert.equal(en.money(150), '$1.50')
    assert.equal(pt.categoryName({ nameKey: 'groceries' }), 'Mercado')
    assert.equal(en.categoryName({ nameKey: 'groceries' }), 'Groceries')
    assert.equal(en.categoryName({ nameKey: 'groceries', name: 'Feira' }), 'Feira')
  })
})

describe('exportação para o contador', () => {
  const state = createSampleData('2026-11-20')
  const i18n = createI18n('pt', 'BRL')
  const ctx = exportContext(i18n, 'Guilherme', new Date('2026-11-20T12:00:00'))

  test('anos disponíveis', () => {
    assert.deepEqual(availableYears(state, new Date('2026-11-20T12:00:00')), [2026])
  })

  test('posição em 31/12 com códigos e custo', () => {
    const rows = yearPositions(state, 2026, ctx)
    const fii = rows.find((r) => r.asset === 'HGLG11')!
    assert.equal(fii.group, '07')
    assert.equal(fii.code, '03')
    assert.equal(fii.costPrevious, 0)
    assert.equal(fii.costCurrent, 6 * 50000)
    assert.equal(fii.quantity, 18)
    assert.ok(fii.earnings > 0)
    const cdb = rows.find((r) => r.type === 'cdb')!
    assert.equal(cdb.code, '02')
    assert.equal(cdb.cnpj, '30.680.829/0001-43')
    assert.ok(rows.every((r) => r.group !== ''))
  })

  test('planilha: abas, cabeçalhos e totais', () => {
    const sheets = accountantSheets(state, 2026, ctx)
    assert.deepEqual(
      sheets.map((s) => s.name),
      ['Leia-me', 'Posição 31-12', 'Rendimentos', 'Lançamentos', 'Investimentos', 'Resumo mensal', 'Por categoria', 'Bancos'],
    )
    const tx = sheets.find((s) => s.name === 'Lançamentos')!
    assert.equal(tx.rows.length, state.transactions.length)
    assert.equal(tx.columns.length, tx.rows[0].length)
    const total = tx.totalRow![8] as number
    const expected = state.transactions.reduce((s, t) => s + (t.kind === 'expense' ? -t.amount : t.amount), 0)
    assert.equal(total, expected)
    const monthly = sheets.find((s) => s.name === 'Resumo mensal')!
    assert.equal(monthly.rows.length, 12)
    for (const sheet of sheets) for (const row of sheet.rows) assert.equal(row.length, sheet.columns.length, `${sheet.name}: largura`)
    const zip = buildXlsxZip(sheets)
    assert.ok(zip.file('xl/workbook.xml'))
    assert.ok(zip.file('xl/worksheets/sheet8.xml'))
  })

  test('CSV com separador do idioma e decimal brasileiro', () => {
    const csv = transactionsCsv(state, ctx, { from: '2026-11-01', to: '2026-11-30' })
    const lines = csv.slice(1).trim().split('\r\n')
    assert.match(lines[0], /^Data;Tipo;Categoria;Pago a \/ Recebido de;Banco/)
    assert.match(lines[1], /^\d{2}\/11\/2026;/)
    assert.ok(lines.slice(1).every((l) => /;-?\d+,\d{2};/.test(l)))
    const enCtx = exportContext(createI18n('en', 'BRL'), '')
    const invCsv = investmentsCsv(state, enCtx)
    assert.match(invCsv.slice(1), /^Date,Operation,Investment type,Asset/)
    assert.match(invCsv, /HGLG11/)
  })
})
