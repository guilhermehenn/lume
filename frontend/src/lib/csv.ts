import { cachedFormatter } from './intl'

export type CsvCell = string | number | null | undefined

function escapeCell(value: CsvCell, separator: string): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  // Evita que planilhas executem fórmulas vindas de texto digitado (CSV injection).
  const looksNumeric = /^-?\d+([.,]\d+)?$/.test(text)
  const safe = typeof value === 'string' && !looksNumeric && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  if (safe.includes(separator) || safe.includes('"') || safe.includes('\n') || safe.includes('\r')) {
    return `"${safe.replace(/"/g, '""')}"`
  }
  return safe
}

/** CSV com BOM (acentos certos no Excel). Separador ";" para pt/es e "," para inglês. */
export function toCsv(rows: CsvCell[][], separator = ';'): string {
  return '﻿' + rows.map((row) => row.map((cell) => escapeCell(cell, separator)).join(separator)).join('\r\n') + '\r\n'
}

/** Quantidade (cotas, ações, frações de cripto) com até 8 casas, sem notação científica: 0,00000001 e não 1e-8. */
export function csvQuantity(value: number, separator = ';'): string {
  const text = cachedFormatter('csvQuantity', () => new Intl.NumberFormat('en-US', { maximumFractionDigits: 8, useGrouping: false })).format(value)
  return separator === ';' ? text.replace('.', ',') : text
}

/** Número decimal no formato do separador escolhido (vírgula quando o separador é ";"). */
export function csvDecimal(cents: number, separator = ';'): string {
  const text = (cents / 100).toFixed(2)
  return separator === ';' ? text.replace('.', ',') : text
}
