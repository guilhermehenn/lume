import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { annualReport, annualReportHtml } from '../../src/data/annualReport'
import { BACKUP_MAX_BYTES, backupFilename, createBackup, readBackup } from '../../src/data/backup'
import {
  accountantSheets,
  availableYears,
  defaultTaxYear,
  investmentsCsv,
  transactionsCsv,
  yearCounts,
  yearEarnings,
  yearSummary,
  yearTotals,
} from '../../src/data/exporters'
import { createSeedData } from '../../src/data/model'
import { createSampleData } from '../../src/data/sample'
import { bankBalances, periodSummary } from '../../src/data/selectors'
import type { DataState, Investment, Transaction } from '../../src/data/types'
import { createI18n, exportContext } from '../../src/i18n'
import { csvQuantity } from '../../src/lib/csv'
import { lastMonths, monthRange, todayISO, yearRange } from '../../src/lib/dates'
import { formatFileSize } from '../../src/lib/download'
import { buildXlsxZip, excelSerial } from '../../src/lib/xlsx'

const NOW = '2026-01-01T00:00:00.000Z'
const pt = createI18n('pt', 'BRL')
const ctx = exportContext(pt, 'Guilherme Henn', new Date(2026, 10, 21, 12))
/** Valores com espaço comum no lugar do espaço fixo que o Intl usa ("R$ 1,00"). */
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value).replace(/\u00a0|\u202f/g, ' '))

/** Estado com bancos e categorias do catálogo e os lançamentos/operações pedidos. */
function world(transactions: Partial<Transaction>[] = [], investments: Partial<Investment>[] = []): DataState {
  const s = createSeedData(NOW)
  const bank = s.banks[0].id
  const expense = s.categories.find((c) => c.kind === 'expense')!.id
  const income = s.categories.find((c) => c.kind === 'income')!.id
  return {
    ...s,
    transactions: transactions.map((x, i) => ({
      id: `t${i}`,
      kind: 'expense',
      amount: 1000,
      date: '2026-03-10',
      bankId: bank,
      categoryId: x.kind === 'income' ? income : expense,
      counterparty: 'Loja',
      createdAt: NOW,
      updatedAt: NOW,
      ...x,
    })),
    investments: investments.map((x, i) => ({
      id: `i${i}`,
      operation: 'contribution',
      type: 'stock',
      asset: 'PETR4',
      amount: 10000,
      date: '2026-03-10',
      bankId: bank,
      quantity: 1,
      unitPrice: 10000,
      createdAt: NOW,
      updatedAt: NOW,
      ...x,
    })),
  }
}

/** Gerador simples e repetível (o mesmo resultado a cada execução). */
function random(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    return seed / 2 ** 31
  }
}

describe('Exportar: resumos do ano numa passada', () => {
  test('os 12 meses e o total batem com periodSummary mês a mês', () => {
    const r = random(7)
    const txs = Array.from({ length: 3000 }, () => ({
      kind: r() < 0.3 ? ('income' as const) : ('expense' as const),
      amount: 1 + Math.floor(r() * 500_000),
      date: `${2025 + Math.floor(r() * 3)}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`,
    }))
    const ops = ['contribution', 'redemption', 'earning'] as const
    const invs = Array.from({ length: 1500 }, () => ({
      operation: ops[Math.floor(r() * 3)],
      amount: 1 + Math.floor(r() * 90_000),
      date: `2026-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`,
    }))
    const s = world(txs, invs)
    const { months, total } = yearTotals(s, 2026)
    assert.deepEqual(
      months.map((m) => m.month),
      lastMonths(12, '2026-12'),
    )
    for (const m of months) {
      const { month, ...got } = m
      const r2 = monthRange(month)
      assert.deepEqual(got, periodSummary(s, r2.from, r2.to), month)
    }
    const y = yearRange(2026)
    assert.deepEqual(total, periodSummary(s, y.from, y.to))
    assert.equal(yearSummary(s, 2026).hasData, true)
    assert.equal(yearSummary(s, 2030).hasData, false)
  })

  test('contagem por ano, anos disponíveis e ano padrão', () => {
    const s = world([{ date: '2024-05-01' }, { date: '2025-12-31' }, { date: '2027-01-15' }], [{ date: '2025-06-01' }])
    const now = new Date(2026, 10, 21)
    const counts = yearCounts(s, now)
    assert.deepEqual([...counts.keys()], [2027, 2026, 2025, 2024])
    assert.deepEqual(counts.get(2025), { transactions: 1, investments: 1 })
    assert.deepEqual(counts.get(2026), { transactions: 0, investments: 0 })
    const years = availableYears(s, now)
    assert.deepEqual(years, [2027, 2026, 2025, 2024])
    // Até junho: o ano anterior (época da declaração). Depois: o ano atual, nunca um ano futuro.
    assert.equal(defaultTaxYear(years, '2026-03-10'), 2025)
    assert.equal(defaultTaxYear(years, '2026-06-30'), 2025)
    assert.equal(defaultTaxYear(years, '2026-07-01'), 2026)
    assert.equal(defaultTaxYear(years, '2026-11-21'), 2026)
    assert.equal(defaultTaxYear([2026], '2026-02-01'), 2026) // sem ano anterior: o atual
    assert.equal(defaultTaxYear([2027, 2026], '2026-02-01'), 2026) // nunca o futuro
    assert.equal(defaultTaxYear([], '2026-02-01'), 2026)
  })

  test('rendimentos do ano por tipo, com IR retido', () => {
    const s = world([], [
      { operation: 'earning', earningKind: 'jcp', amount: 1000, taxWithheld: 150, quantity: undefined, unitPrice: undefined },
      { operation: 'earning', earningKind: 'jcp', amount: 2000, taxWithheld: 300, quantity: undefined, unitPrice: undefined },
      { operation: 'earning', amount: 500, date: '2025-12-31', quantity: undefined, unitPrice: undefined },
    ])
    const e = yearEarnings(s, 2026)
    assert.deepEqual([...e], [['jcp', { total: 3000, tax: 450 }]])
  })
})

describe('Exportar: CSV', () => {
  test('quantidade sem notação científica, com vírgula ou ponto conforme o separador', () => {
    assert.equal(csvQuantity(0.00000001, ';'), '0,00000001')
    assert.equal(csvQuantity(0.00000001, ','), '0.00000001')
    assert.equal(csvQuantity(123456.12345678, ';'), '123456,12345678')
    assert.equal(csvQuantity(999_999_999.5, ';'), '999999999,5')
    assert.equal(csvQuantity(18, ';'), '18')
    assert.equal(csvQuantity(1e21, ','), '1000000000000000000000')
    const s = world([], [{ type: 'crypto', asset: 'BTC', quantity: 0.00000001, unitPrice: 1, amount: 1 }])
    const csv = investmentsCsv(s, ctx, yearRange(2026))
    assert.ok(!/\de-\d/.test(csv), 'sem 1e-8 no arquivo')
    assert.match(csv, /;0,00000001;/)
  })

  test('texto que parece fórmula vira texto; número negativo continua número', () => {
    const s = world([{ counterparty: '=HYPERLINK("http://x")', note: '+5' }, { counterparty: '@SOMA(A1)', note: '-12,50' }])
    const csv = transactionsCsv(s, ctx, yearRange(2026))
    assert.ok(csv.includes(`"'=HYPERLINK(""http://x"")"`))
    assert.ok(csv.includes(";'+5\r\n"))
    assert.ok(csv.includes("'@SOMA(A1)"))
    assert.ok(csv.includes(';-12,50\r\n'))
  })

  test('100 mil lançamentos viram CSV rápido (bancos e categorias consultados uma vez)', () => {
    const r = random(3)
    const s = world(Array.from({ length: 100_000 }, (_, i) => ({ amount: 100 + i, date: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}` })))
    const started = performance.now()
    const csv = transactionsCsv(s, exportContext(pt, ''), yearRange(2026))
    const elapsed = performance.now() - started
    assert.equal(csv.split('\r\n').length, 100_002) // cabeçalho + linhas + final vazio
    // Antes: ~6,5 s (um formatador de data novo e um mapa de bancos novo por linha).
    assert.ok(elapsed < 2500, `${elapsed.toFixed(0)} ms`)
  })
})

describe('Exportar: planilha', () => {
  test('data no Excel conta o 29/02/1900 que não existiu', () => {
    assert.equal(excelSerial('1900-01-01'), 1)
    assert.equal(excelSerial('1900-02-28'), 59)
    assert.equal(excelSerial('1900-03-01'), 61)
    assert.equal(excelSerial('2026-01-01'), 46023)
    assert.equal(excelSerial('2199-12-31'), 109574)
  })

  test('Leia-me com a moeda escolhida; Bancos com o saldo de 31/12 dos dois anos', () => {
    const s = createSampleData('2026-11-20')
    const usd = exportContext(createI18n('pt', 'USD'), '', new Date(2026, 10, 21))
    const sheets = accountantSheets(s, 2026, usd)
    const readme = sheets[0].rows.flat().join('\n')
    assert.match(readme, /Moeda: Dólar americano \(US\$\)/)
    assert.match(readme, /Gerado em 21\/11\/2026/)
    const banks = sheets.find((x) => x.name === 'Bancos')!
    assert.deepEqual(
      banks.columns.map((c) => c.header).slice(3),
      ['Saldo inicial', 'Saldo em 31/12 do ano anterior', 'Saldo em 31/12'],
    )
    const prev = bankBalances(s, '2025-12-31')
    const end = bankBalances(s, '2026-12-31')
    for (const row of banks.rows) {
      const bank = s.banks.find((b) => b.name === row[0])!
      assert.equal(row[4], prev.get(bank.id) ?? 0)
      assert.equal(row[5], end.get(bank.id) ?? 0)
    }
    for (const sheet of sheets) for (const row of sheet.rows) assert.equal(row.length, sheet.columns.length, sheet.name)
  })

  test('texto com caracteres de controle e símbolos do XML não estraga a planilha', () => {
    const s = world([{ counterparty: 'A & B <tag> "aspas"\u0007 fim', note: '\u0000\u001F' }])
    const zip = buildXlsxZip(accountantSheets(s, 2026, ctx))
    // Lançamentos é a 4ª aba.
    return zip
      .file('xl/worksheets/sheet4.xml')!
      .async('string')
      .then((xml) => {
        assert.ok(xml.includes('A &amp; B &lt;tag&gt; &quot;aspas&quot; fim'))
        assert.ok(!/[\u0000-\u0008]/.test(xml))
      })
  })
})

describe('Exportar: backup', () => {
  test('JSON compacto que volta igual, com o nome na data deste computador', () => {
    const s = createSampleData('2026-11-20')
    const settings = { language: 'pt', currency: 'BRL', theme: 'dark', hideValues: false, onboardingDone: true, emailCopies: true } as const
    const text = createBackup(s, settings, new Date('2026-11-21T23:30:00-03:00'))
    assert.ok(!text.includes('\n'), 'sem quebras de linha')
    const back = readBackup(text)
    assert.deepEqual(back.data, JSON.parse(JSON.stringify(s)))
    assert.equal(back.exportedAt, '2026-11-22T02:30:00.000Z')
    // 23h30 em Brasília já é dia 22 em Greenwich: o nome usa a data daqui.
    assert.equal(backupFilename(todayISO(new Date(2026, 10, 21, 23, 30))), 'lume-backup-2026-11-21.json')
    assert.equal(BACKUP_MAX_BYTES, 256 * 1024 * 1024)
  })

  test('tamanho de arquivo legível', () => {
    assert.equal(formatFileSize(23.4 * 1024 * 1024, 'pt-BR'), '23,4 MB')
    assert.equal(formatFileSize(15 * 1024 * 1024, 'pt-BR'), '15 MB')
    assert.equal(formatFileSize(820 * 1024, 'en-US'), '820 KB')
    assert.equal(formatFileSize(10, 'pt-BR'), '1 KB')
  })
})

describe('Exportar: relatório anual', () => {
  const now = new Date(2026, 10, 21, 23, 30) // 23h30: em Greenwich já seria dia 22

  test('título, data local e meses sem movimento com traço', () => {
    const s = world([{ date: '2026-03-10', amount: 5000 }, { kind: 'income', date: '2026-03-05', amount: 20000 }])
    const report = annualReport(s, 2026, pt, 'Guilherme Henn', now)
    assert.equal(report.title, 'Relatório anual 2026')
    assert.match(report.generatedAt, /21 de nov\. de 2026/)
    const months = report.tables[0]
    assert.deepEqual(months.rows[0].slice(1), ['—', '—', '—', '—', '—'])
    assert.equal(plain(months.rows[2][1]), 'R$ 200,00')
    assert.equal(plain(months.foot![1]), 'R$ 200,00')
  })

  test('previdência PGBL com traço no grupo e no código; resultado só quando houve venda', () => {
    const s = world(
      [],
      [
        { type: 'pension', plan: 'pgbl', asset: 'Prev PGBL', quantity: undefined, unitPrice: undefined, amount: 50000 },
        { type: 'stock', asset: 'PETR4', quantity: 10, unitPrice: 3000, amount: 30000 },
      ],
    )
    let report = annualReport(s, 2026, pt, '', now)
    let positions = report.tables[3]
    assert.equal(positions.head.length, 6)
    const pgbl = positions.rows.find((r) => r[2].startsWith('Prev PGBL'))!
    assert.deepEqual(pgbl.slice(0, 2), ['—', '—'])
    const stock = positions.rows.find((r) => r[2].startsWith('PETR4'))!
    assert.equal(stock[0], '03')
    // Vende metade com lucro: aparece a coluna de resultado.
    s.investments.push({ ...s.investments[1], id: 'sell', operation: 'redemption', quantity: 5, unitPrice: 4000, amount: 20000, date: '2026-08-01' })
    report = annualReport(s, 2026, pt, '', now)
    positions = report.tables[3]
    assert.equal(positions.head.length, 7)
    assert.equal(positions.head[6], 'Resultado no ano')
    for (const row of positions.rows) assert.equal(row.length, 7)
    assert.equal(positions.foot!.length, 7)
  })

  test('rendimentos com IR retido e total; HTML do e-mail escapa o texto', () => {
    const s = world([], [{ operation: 'earning', earningKind: 'jcp', amount: 10000, taxWithheld: 1500, quantity: undefined, unitPrice: undefined }])
    const report = annualReport(s, 2026, pt, '<b>Gui</b>', now)
    const earnings = report.tables[4]
    assert.deepEqual(earnings.head, ['Tipo de rendimento', 'Total', 'IR retido'])
    assert.deepEqual(plain(earnings.rows), [['Juros sobre capital próprio', 'R$ 100,00', 'R$ 15,00']])
    assert.deepEqual(plain(earnings.foot), ['Total', 'R$ 100,00', 'R$ 15,00'])
    const html = annualReportHtml(report, { lang: 'pt-BR', empty: 'Sem dados' })
    assert.ok(html.includes('&lt;b&gt;Gui&lt;/b&gt;'))
    assert.ok(!html.includes('<b>Gui</b>'))
    assert.ok(html.includes('Relatório anual 2026'))
  })

  test('ano vazio: o relatório diz que não há dados', () => {
    const report = annualReport(world(), 2026, pt, '', now)
    assert.equal(report.hasData, false)
    assert.equal(report.tables[4].foot, undefined)
  })
})
