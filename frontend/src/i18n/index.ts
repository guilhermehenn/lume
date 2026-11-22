// Tradução e formatação (datas, moeda, números) no idioma escolhido em Configurações.

import { useMemo } from 'react'
import { formatDate, formatDateTime, formatMonth, formatMonthShort, formatRelativeTime, type ISODate, type MonthKey } from '../lib/dates'
import { formatMoney, formatNumber, formatPercent, type Currency, type MoneyFormatOptions } from '../lib/money'
import { useSettings } from '../data/store'
import type { Category, Language } from '../data/types'
import { en } from './en'
import { es } from './es'
import { pt, type Dictionary } from './pt'

export const DICTIONARIES: Record<Language, Dictionary> = { pt, en, es }
export const LANGUAGES: Language[] = ['pt', 'en', 'es']
export const LOCALES: Record<Language, string> = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' }

// Chaves válidas, ex.: 'nav.home'. Chaves com _zero/_one/_other aparecem sem o sufixo.
type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never
type Paths<T> = { [K in keyof T]: T[K] extends string ? K : Join<K, Paths<T[K]>> }[keyof T]
type StripPlural<P> = P extends `${infer B}_one` ? B : P extends `${infer B}_other` ? B : P extends `${infer B}_zero` ? B : P
export type TKey = StripPlural<Paths<Dictionary>>
export type TParams = Record<string, string | number>

function lookup(dict: unknown, key: string): string | undefined {
  let node: unknown = dict
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

const pluralRules = new Map<Language, Intl.PluralRules>()

export function translate(language: Language, key: TKey | string, params?: TParams): string {
  const dict = DICTIONARIES[language] ?? pt
  let text: string | undefined
  if (params && params.count === 0) text = lookup(dict, `${key}_zero`) ?? lookup(pt, `${key}_zero`)
  if (!text && params && typeof params.count === 'number') {
    let rules = pluralRules.get(language)
    if (!rules) {
      rules = new Intl.PluralRules(LOCALES[language])
      pluralRules.set(language, rules)
    }
    const form = rules.select(params.count) === 'one' ? 'one' : 'other'
    text = lookup(dict, `${key}_${form}`) ?? lookup(pt, `${key}_${form}`)
  }
  text ??= lookup(dict, key) ?? lookup(pt, key) ?? key
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    if (value === undefined) return match
    // Anos ("2026") nunca recebem separador de milhar; contagens sim ("1.234 lançamentos").
    if (typeof value === 'number') return name === 'year' ? String(value) : formatNumber(value, LOCALES[language], 3)
    return value
  })
}

export interface I18n {
  language: Language
  locale: string
  currency: Currency
  t: (key: TKey, params?: TParams) => string
  /** Para chaves montadas em tempo de execução (ex.: `paymentMethods.${pm}`). */
  tx: (key: string, params?: TParams) => string
  money: (cents: number, options?: MoneyFormatOptions) => string
  number: (value: number, maxFractionDigits?: number) => string
  percent: (value: number, options?: { sign?: boolean; digits?: number }) => string
  date: (date: ISODate, style?: 'short' | 'medium' | 'long') => string
  /** Data e hora de um instante ISO completo, no fuso deste computador. */
  dateTime: (isoDateTime: string) => string
  month: (month: MonthKey, style?: 'long' | 'short') => string
  /** Mês no meio de uma frase: minúsculo em português e espanhol ("Resumo de novembro de 2026"). */
  monthInline: (month: MonthKey) => string
  monthShort: (month: MonthKey) => string
  relative: (isoDateTime: string) => string
  categoryName: (category: Pick<Category, 'name' | 'nameKey'> | undefined) => string
}

export function createI18n(language: Language, currency: Currency): I18n {
  const locale = LOCALES[language]
  const tx = (key: string, params?: TParams) => translate(language, key, params)
  return {
    language,
    locale,
    currency,
    t: tx,
    tx,
    money: (cents, options) => formatMoney(cents, locale, currency, options),
    number: (value, digits) => formatNumber(value, locale, digits),
    percent: (value, options) => formatPercent(value, locale, options),
    date: (date, style) => formatDate(date, locale, style),
    dateTime: (iso) => formatDateTime(iso, locale),
    month: (month, style) => formatMonth(month, locale, style),
    monthInline: (month) => (language === 'en' ? formatMonth(month, locale) : formatMonth(month, locale).toLocaleLowerCase(locale)),
    monthShort: (month) => formatMonthShort(month, locale),
    relative: (iso) => formatRelativeTime(iso, locale),
    categoryName: (category) => {
      if (!category) return '—'
      if (category.name) return category.name
      return category.nameKey ? tx(`categoryNames.${category.nameKey}`) : '—'
    },
  }
}

export function useI18n(): I18n {
  const { language, currency } = useSettings()
  return useMemo(() => createI18n(language, currency), [language, currency])
}

/** Contexto de tradução para gerar arquivos de exportação no idioma escolhido. */
export function exportContext(i18n: I18n, ownerName: string, now = new Date()): import('../data/exporters').ExportContext {
  // Um arquivo repete as mesmas datas milhares de vezes: cada uma é formatada uma vez só.
  const dates = new Map<ISODate, string>()
  return {
    t: i18n.tx,
    categoryName: i18n.categoryName,
    csvDate: (date) => {
      let text = dates.get(date)
      if (text === undefined) {
        text = i18n.date(date, 'short')
        dates.set(date, text)
      }
      return text
    },
    monthLabel: (month) => i18n.month(month),
    separator: i18n.language === 'en' ? ',' : ';',
    currencyName: i18n.tx(`currencies.${i18n.currency}`),
    ownerName,
    now,
  }
}
