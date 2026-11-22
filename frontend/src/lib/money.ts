// Dinheiro sempre em centavos inteiros (number inteiro). Nunca float para valores.

import { cachedFormatter } from './intl'

export type Currency = 'BRL' | 'USD' | 'EUR'
export const CURRENCIES: Currency[] = ['BRL', 'USD', 'EUR']

const MAX_DIGITS = 13 // até 99.999.999.999,99

function formatter(locale: string, currency: Currency, signDisplay: Intl.NumberFormatOptions['signDisplay']) {
  return cachedFormatter(
    `money|${locale}|${currency}|${signDisplay}`,
    () => new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay }),
  )
}

export interface MoneyFormatOptions {
  /** 'auto' mostra o sinal só para negativos; 'always' mostra + e −. */
  sign?: 'auto' | 'always' | 'never'
}

export function formatMoney(cents: number, locale: string, currency: Currency, options: MoneyFormatOptions = {}): string {
  const sign = options.sign ?? 'auto'
  const signDisplay = sign === 'always' ? 'exceptZero' : sign === 'never' ? 'never' : 'auto'
  const value = Math.round(cents) / 100
  return formatter(locale, currency, signDisplay).format(value).replace('-', '−')
}

/** Converte o texto de um campo de valor (qualquer formato) em centavos usando só os dígitos. */
export function digitsToCents(text: string): number {
  const digits = text.replace(/\D/g, '').replace(/^0+/, '').slice(0, MAX_DIGITS)
  return digits ? Number.parseInt(digits, 10) : 0
}

/**
 * Lê um valor colado ou digitado por extenso ("1.234,56", "R$ 10", "1,234.56", "12.5").
 * O último separador seguido de 1 ou 2 dígitos é o decimal; os outros são de milhar.
 * Retorna null se não for um número válido.
 */
export function parseMoneyText(text: string): number | null {
  const cleaned = text.replace(/[^\d.,-]/g, '')
  if (!/\d/.test(cleaned)) return null
  const negative = cleaned.startsWith('-')
  const body = cleaned.replace(/-/g, '')
  const lastSep = Math.max(body.lastIndexOf(','), body.lastIndexOf('.'))
  let intPart = body
  let fracPart = ''
  if (lastSep >= 0) {
    const after = body.slice(lastSep + 1)
    if (after.length >= 1 && after.length <= 2) {
      intPart = body.slice(0, lastSep)
      fracPart = after
    }
  }
  intPart = intPart.replace(/[.,]/g, '')
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null
  const cents = Number.parseInt(intPart || '0', 10) * 100 + Number.parseInt((fracPart + '00').slice(0, 2), 10)
  if (!Number.isFinite(cents) || String(Math.trunc(cents / 100)).length > MAX_DIGITS - 2) return null
  return negative ? -cents : cents
}

export function formatNumber(value: number, locale: string, maxFractionDigits = 2): string {
  return cachedFormatter(`number|${locale}|${maxFractionDigits}`, () => new Intl.NumberFormat(locale, { maximumFractionDigits: maxFractionDigits })).format(value)
}

export function formatPercent(value: number, locale: string, options: { sign?: boolean; digits?: number } = {}): string {
  const digits = options.digits ?? 2
  const sign = options.sign ? 'exceptZero' : 'auto'
  return cachedFormatter(
    `percent|${locale}|${digits}|${sign}`,
    () => new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: sign }),
  )
    .format(value / 100)
    .replace('-', '−')
}

/** Valor total de uma compra: quantidade × preço unitário + taxas, em centavos. */
export function totalFromQuantity(quantity: number, unitPriceCents: number, feesCents = 0): number {
  if (!Number.isFinite(quantity) || quantity <= 0 || unitPriceCents <= 0) return 0
  return Math.round(quantity * unitPriceCents) + Math.max(0, feesCents)
}

/** Lê quantidades com vírgula ou ponto decimal ("0,5", "1.234,5678", "0.00098"). null se inválido. */
export function parseDecimal(text: string): number | null {
  let s = text.trim().replace(/\s/g, '')
  if (!s) return null
  const comma = s.lastIndexOf(',')
  const dot = s.lastIndexOf('.')
  if (comma >= 0 && dot >= 0) {
    s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (comma >= 0) {
    s = (s.match(/,/g)!.length > 1 ? s.replace(/,/g, '') : s.replace(',', '.'))
  } else if (dot >= 0 && s.match(/\./g)!.length > 1) {
    s = s.replace(/\./g, '')
  }
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null
  const value = Number.parseFloat(s)
  return Number.isFinite(value) ? value : null
}
