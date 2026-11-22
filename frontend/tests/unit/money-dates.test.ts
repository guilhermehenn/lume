import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { toCsv, csvDecimal } from '../../src/lib/csv'
import {
  addDays,
  addMonths,
  currentMonth,
  daysBetween,
  formatMonth,
  fromISODate,
  inRange,
  isEntryDate,
  isISODate,
  lastMonths,
  monthRange,
  toISODate,
  yearRange,
} from '../../src/lib/dates'
import { digitsToCents, formatMoney, formatPercent, parseDecimal, parseMoneyText, totalFromQuantity } from '../../src/lib/money'

const nbsp = (s: string) => s.replace(/ | /g, ' ')

describe('dinheiro', () => {
  test('formata em reais, dólar e euro com sinal de menos tipográfico', () => {
    assert.equal(nbsp(formatMoney(123456, 'pt-BR', 'BRL')), 'R$ 1.234,56')
    assert.equal(nbsp(formatMoney(-500, 'pt-BR', 'BRL')), '−R$ 5,00')
    assert.equal(formatMoney(123456, 'en-US', 'USD'), '$1,234.56')
    assert.equal(nbsp(formatMoney(100, 'pt-BR', 'BRL', { sign: 'always' })), '+R$ 1,00')
    assert.equal(nbsp(formatMoney(0, 'pt-BR', 'BRL', { sign: 'always' })), 'R$ 0,00')
    assert.match(nbsp(formatMoney(99, 'es-ES', 'EUR')), /0,99 €/)
  })

  test('digitação: só dígitos viram centavos, com limite de 13 dígitos', () => {
    assert.equal(digitsToCents('R$ 0,001'), 1)
    assert.equal(digitsToCents('R$ 12,345'), 12345)
    assert.equal(digitsToCents(''), 0)
    assert.equal(digitsToCents('abc'), 0)
    assert.equal(digitsToCents('99999999999999999'), 9999999999999)
  })

  test('colar valores em vários formatos', () => {
    assert.equal(parseMoneyText('1.234,56'), 123456)
    assert.equal(parseMoneyText('R$ 10'), 1000)
    assert.equal(parseMoneyText('1,234.56'), 123456)
    assert.equal(parseMoneyText('12.5'), 1250)
    assert.equal(parseMoneyText('-3,2'), -320)
    assert.equal(parseMoneyText('1.000'), 100000)
    assert.equal(parseMoneyText('texto'), null)
  })

  test('quantidades com vírgula ou ponto', () => {
    assert.equal(parseDecimal('0,5'), 0.5)
    assert.equal(parseDecimal('1.234,5678'), 1234.5678)
    assert.equal(parseDecimal('0.00098'), 0.00098)
    assert.equal(parseDecimal('1.000.000'), 1000000)
    assert.equal(parseDecimal('10'), 10)
    assert.equal(parseDecimal(''), null)
    assert.equal(parseDecimal('1,2,3x'), null)
  })

  test('total de compra por quantidade', () => {
    assert.equal(totalFromQuantity(3, 16500, 500), 50000)
    assert.equal(totalFromQuantity(0.0937, 320171), 30000)
    assert.equal(totalFromQuantity(0, 100), 0)
    assert.equal(totalFromQuantity(2, 0), 0)
  })

  test('percentual', () => {
    assert.equal(nbsp(formatPercent(10.5, 'pt-BR')), '10,50%')
    assert.equal(nbsp(formatPercent(-2, 'pt-BR', { sign: true, digits: 1 })), '−2,0%')
    assert.equal(formatPercent(1.25, 'en-US', { sign: true }), '+1.25%')
  })
})

describe('datas', () => {
  test('ISO sem fuso', () => {
    assert.equal(isISODate('2026-02-29'), false)
    assert.equal(isISODate('2028-02-29'), true)
    assert.equal(isISODate('2026-13-01'), false)
    assert.equal(isISODate('20-01-01'), false)
    assert.equal(toISODate(fromISODate('2026-01-01')), '2026-01-01')
  })

  test('meses e intervalos', () => {
    assert.equal(addMonths('2026-01', -1), '2025-12')
    assert.equal(addMonths('2026-11', 3), '2027-02')
    assert.deepEqual(monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' })
    assert.deepEqual(yearRange(2026), { from: '2026-01-01', to: '2026-12-31' })
    assert.deepEqual(lastMonths(3, '2026-01'), ['2025-11', '2025-12', '2026-01'])
    assert.equal(currentMonth(new Date(2026, 10, 20)), '2026-11')
    assert.equal(inRange('2026-05-10', '2026-05-01', '2026-05-31'), true)
    assert.equal(inRange('2026-06-01', '2026-05-01', '2026-05-31'), false)
    assert.equal(inRange('2026-06-01'), true)
    assert.equal(daysBetween('2026-01-01', '2026-03-01'), 59)
    assert.equal(formatMonth('2026-11', 'pt-BR'), 'Novembro de 2026')
  })
})

describe('CSV', () => {
  test('BOM, CRLF, aspas e proteção contra fórmulas', () => {
    const csv = toCsv([
      ['a;b', 'he said "hi"', '=SOMA(A1)', '-12,50', '+55 51', '@x'],
      [1, null, undefined, 'linha\nquebrada', '-', 'ok'],
    ])
    assert.ok(csv.startsWith('﻿'))
    const [l1, l2] = csv.slice(1).split('\r\n')
    assert.equal(l1, `"a;b";"he said ""hi""";'=SOMA(A1);-12,50;'+55 51;'@x`)
    assert.equal(l2, `1;;;"linha\nquebrada";'-;ok`)
    assert.equal(csvDecimal(-123456), '-1234,56')
    assert.equal(csvDecimal(5, ','), '0.05')
  })
})

describe('datas do lançamento', () => {
  test('addDays atravessa mês, ano e fevereiro bissexto', () => {
    assert.equal(addDays('2026-03-01', -1), '2026-02-28')
    assert.equal(addDays('2024-03-01', -1), '2024-02-29')
    assert.equal(addDays('2026-01-01', -1), '2025-12-31')
    assert.equal(addDays('2026-12-31', 1), '2027-01-01')
    // Horário de verão antigo do Brasil (outubro): o meio-dia evita pular ou repetir dia.
    assert.equal(addDays('2018-11-04', -1), '2018-11-03')
  })

  test('isEntryDate aceita só datas reais entre 1900 e 2199', () => {
    for (const ok of ['1900-01-01', '2199-12-31', '2024-02-29']) assert.ok(isEntryDate(ok), ok)
    for (const bad of ['1899-12-31', '2200-01-01', '2026-02-29', '2026-13-01', '0001-01-01', '20260101', '', null, 20260101]) {
      assert.equal(isEntryDate(bad), false, String(bad))
    }
  })
})
