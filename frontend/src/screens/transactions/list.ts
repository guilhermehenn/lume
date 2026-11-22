// Regras da lista de lançamentos: o que entra (mês, busca, banco, categoria, tipo), os totais e
// a busca sem acento e por valor. Sem React, para testar direto.

import type { MonthKey } from '../../lib/dates'
import { normalize } from '../../lib/text'
import type { Entry } from '../../data/selectors'
import type { DataState, ID, Investment, Transaction } from '../../data/types'

export type KindFilter = 'all' | 'expense' | 'income' | 'investment'
export const KIND_FILTERS: KindFilter[] = ['all', 'expense', 'income', 'investment']

export interface ListFilters {
  month: MonthKey
  /** Texto da busca já normalizado; vazio = sem busca (a busca vale para todos os meses). */
  query: string
  kind: KindFilter
  bankId?: ID
  categoryId?: ID
}

export interface Totals {
  income: number
  expense: number
  /** Aplicações − resgates. */
  invested: number
}

/**
 * Busca que parece um valor ("45,90", "R$ 1.234,56", "1,234.56", "120") vira centavos.
 * O último separador com 1 ou 2 dígitos depois é o decimal; os outros são de milhar.
 */
export function parseAmountQuery(query: string): number | null {
  const raw = query.replace(/r\$|\$|€|\s/gi, '')
  if (!/^\d[\d.,]*$/.test(raw)) return null
  const last = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('.'))
  const decimals = last >= 0 ? raw.length - last - 1 : 0
  let integer = raw
  let fraction = ''
  if (last >= 0 && decimals >= 1 && decimals <= 2) {
    integer = raw.slice(0, last)
    fraction = raw.slice(last + 1)
  }
  integer = integer.replace(/[.,]/g, '')
  if (!/^\d+$/.test(integer) || integer.length > 13) return null
  return Number(integer) * 100 + Number(fraction.padEnd(2, '0') || 0)
}

/** Mais novo primeiro: data, depois criação (a mesma ordem de `allEntries`). */
const sortEntries = (list: Entry[]) => list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))

function txEntry(tx: Transaction): Entry {
  return { entryKind: tx.kind, id: tx.id, date: tx.date, amount: tx.amount, createdAt: tx.createdAt, tx }
}

function invEntry(inv: Investment): Entry {
  return { entryKind: 'investment', id: inv.id, date: inv.date, amount: inv.amount, createdAt: inv.createdAt, inv }
}

/** Lançamentos de um mês, do mais novo para o mais antigo. Só ordena o próprio mês. */
export function monthEntries(state: DataState, month: MonthKey): Entry[] {
  const prefix = `${month}-`
  const out: Entry[] = []
  for (const t of state.transactions) if (t.date.startsWith(prefix)) out.push(txEntry(t))
  for (const i of state.investments) if (i.date.startsWith(prefix)) out.push(invEntry(i))
  return sortEntries(out)
}

export interface SearchItem {
  entry: Entry
  /** Texto normalizado com tudo o que a busca enxerga. */
  hay: string
}

/**
 * Índice da busca: o texto normalizado de cada lançamento. Antes, cada tecla normalizava o texto
 * de todos os lançamentos.
 *
 * `cache` guarda o texto por registro (o objeto do lançamento): os dados são imutáveis, então
 * depois de uma gravação só o que mudou é normalizado de novo. Quem chama troca o cache quando
 * muda o que entra no texto (nome de banco ou categoria, idioma).
 */
export function buildSearchIndex(
  state: DataState,
  describe: (entry: Entry) => string,
  cache: WeakMap<object, string> = new WeakMap(),
): SearchItem[] {
  const entries = sortEntries([...state.transactions.map(txEntry), ...state.investments.map(invEntry)])
  return entries.map((entry) => {
    const record = entry.entryKind === 'investment' ? entry.inv : entry.tx
    let hay = cache.get(record)
    if (hay === undefined) {
      hay = normalize(describe(entry))
      cache.set(record, hay)
    }
    return { entry, hay }
  })
}

export function searchEntries(index: SearchItem[], query: string): Entry[] {
  const cents = parseAmountQuery(query)
  const out: Entry[] = []
  for (const item of index) if (item.entry.amount === cents || item.hay.includes(query)) out.push(item.entry)
  return out
}

/** Banco e categoria. Filtrar por categoria deixa de fora os investimentos (eles não têm). */
export function matchesScope(entry: Entry, bankId?: ID, categoryId?: ID): boolean {
  const bank = entry.entryKind === 'investment' ? entry.inv.bankId : entry.tx.bankId
  if (bankId && bank !== bankId) return false
  if (categoryId && (entry.entryKind === 'investment' || entry.tx.categoryId !== categoryId)) return false
  return true
}

export function totalsOf(entries: Entry[]): Totals {
  const totals: Totals = { income: 0, expense: 0, invested: 0 }
  for (const e of entries) {
    if (e.entryKind === 'investment') {
      if (e.inv.operation === 'contribution') totals.invested += e.amount
      else if (e.inv.operation === 'redemption') totals.invested -= e.amount
    } else if (e.entryKind === 'income') totals.income += e.amount
    else totals.expense += e.amount
  }
  return totals
}

export interface DayGroup {
  date: string
  entries: Entry[]
  /** Receitas − despesas do dia (investimentos não entram). */
  net: number
}

export function groupByDay(entries: Entry[]): DayGroup[] {
  const groups: DayGroup[] = []
  for (const e of entries) {
    let last = groups[groups.length - 1]
    if (!last || last.date !== e.date) {
      last = { date: e.date, entries: [], net: 0 }
      groups.push(last)
    }
    last.entries.push(e)
    if (e.entryKind === 'income') last.net += e.amount
    else if (e.entryKind === 'expense') last.net -= e.amount
  }
  return groups
}
