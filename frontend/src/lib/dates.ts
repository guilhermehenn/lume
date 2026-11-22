// Datas de lançamento são texto "AAAA-MM-DD" (sem hora e sem fuso), como no banco.
// Assim um lançamento do dia 1º nunca "vira" dia 31 por causa do fuso horário.

import { cachedFormatter } from './intl'

export type ISODate = string // AAAA-MM-DD
export type MonthKey = string // AAAA-MM

const pad = (n: number) => String(n).padStart(2, '0')

export function toISODate(date: Date): ISODate {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function todayISO(now: Date = new Date()): ISODate {
  return toISODate(now)
}

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = fromISODate(value)
  return toISODate(d) === value
}

/** Soma dias a uma data AAAA-MM-DD (negativo volta). */
export function addDays(date: ISODate, days: number): ISODate {
  const d = fromISODate(date)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

/** Anos aceitos num lançamento (os mesmos do servidor). */
export const MIN_YEAR = 1900
export const MAX_YEAR = 2199

/** Data válida e dentro dos anos aceitos. */
export function isEntryDate(value: unknown): value is ISODate {
  if (!isISODate(value)) return false
  const year = Number(value.slice(0, 4))
  return year >= MIN_YEAR && year <= MAX_YEAR
}

export function fromISODate(value: ISODate): Date {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d, 12) // meio-dia evita bordas de horário de verão
}

export function monthOf(date: ISODate): MonthKey {
  return date.slice(0, 7)
}

export function currentMonth(now: Date = new Date()): MonthKey {
  return monthOf(todayISO(now))
}

export function addMonths(month: MonthKey, delta: number): MonthKey {
  const [y, m] = month.split('-').map(Number)
  const index = y * 12 + (m - 1) + delta
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`
}

export function monthRange(month: MonthKey): { from: ISODate; to: ISODate } {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return { from: `${month}-01`, to: `${month}-${pad(last)}` }
}

export function yearRange(year: number): { from: ISODate; to: ISODate } {
  return { from: `${year}-01-01`, to: `${year}-12-31` }
}

export function lastMonths(count: number, end: MonthKey = currentMonth()): MonthKey[] {
  return Array.from({ length: count }, (_, i) => addMonths(end, i - count + 1))
}

export function inRange(date: ISODate, from?: ISODate, to?: ISODate): boolean {
  return (!from || date >= from) && (!to || date <= to)
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((fromISODate(b).getTime() - fromISODate(a).getTime()) / 86_400_000)
}

const DATE_STYLES: Record<'short' | 'medium' | 'long', Intl.DateTimeFormatOptions> = {
  short: { day: '2-digit', month: '2-digit', year: 'numeric' },
  medium: { day: 'numeric', month: 'short', year: 'numeric' },
  long: { weekday: 'long', day: 'numeric', month: 'long' },
}

export function formatDate(date: ISODate, locale: string, style: 'short' | 'medium' | 'long' = 'medium'): string {
  return cachedFormatter(`date|${locale}|${style}`, () => new Intl.DateTimeFormat(locale, DATE_STYLES[style])).format(fromISODate(date))
}

/** Data e hora de um instante (ISO completo, com ou sem fuso), no fuso deste computador:
 *  "20 de nov. de 2026, 07:00". Vazio se o texto não for uma data. */
export function formatDateTime(isoDateTime: string, locale: string): string {
  const when = new Date(isoDateTime)
  if (Number.isNaN(when.getTime())) return ''
  return cachedFormatter(`dateTime|${locale}`, () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })).format(when)
}

export function formatMonth(month: MonthKey, locale: string, style: 'long' | 'short' = 'long'): string {
  const text = cachedFormatter(`month|${locale}|${style}`, () => new Intl.DateTimeFormat(locale, { month: style, year: 'numeric' })).format(
    fromISODate(`${month}-01`),
  )
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function formatMonthShort(month: MonthKey, locale: string): string {
  const text = cachedFormatter(`monthShort|${locale}`, () => new Intl.DateTimeFormat(locale, { month: 'short' }))
    .format(fromISODate(`${month}-01`))
    .replace('.', '')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** "há 5 min", "há 2 h" etc. a partir de um instante ISO completo. */
export function formatRelativeTime(isoDateTime: string, locale: string, now: Date = new Date()): string {
  const then = new Date(isoDateTime)
  if (Number.isNaN(then.getTime())) return ''
  // Tudo o que aparece assim já aconteceu; data "no futuro" é relógio ou fuso errado: vira "agora".
  const seconds = Math.min(0, Math.round((then.getTime() - now.getTime()) / 1000))
  const rtf = cachedFormatter(`relative|${locale}`, () => new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' }))
  const abs = Math.abs(seconds)
  if (abs < 60) return rtf.format(0, 'second')
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour')
  return rtf.format(Math.round(seconds / 86400), 'day')
}
