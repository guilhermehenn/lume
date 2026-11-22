// Linha de lançamento usada no Início, em Lançamentos e em Investimentos.

import { useMemo } from 'react'
import { openEntry } from '../app/entrySheet'
import { cn } from '../lib/cn'
import { INVESTMENT_TYPE_MAP } from '../data/investments'
import type { Entry } from '../data/selectors'
import type { Bank, Category, DataState, ID } from '../data/types'
import { useI18n, type I18n } from '../i18n'
import { Amount, CategoryIcon } from '../ui/display'

export interface Lookups {
  banks: Map<ID, Bank>
  categories: Map<ID, Category>
}

export function useLookups(data: DataState): Lookups {
  return useMemo(
    () => ({
      banks: new Map(data.banks.map((b) => [b.id, b])),
      categories: new Map(data.categories.map((c) => [c.id, c])),
    }),
    [data.banks, data.categories],
  )
}

export function entryTitle(entry: Entry): string {
  return entry.entryKind === 'investment' ? entry.inv.asset : entry.tx.counterparty
}

export function entrySubtitle(entry: Entry, lookups: Lookups, i18n: I18n): string {
  if (entry.entryKind === 'investment') {
    const bank = lookups.banks.get(entry.inv.bankId)?.name ?? '—'
    return `${i18n.tx(`operations.${entry.inv.operation}`)} · ${i18n.tx(`investmentTypes.${entry.inv.type}`)} · ${bank}`
  }
  const category = i18n.categoryName(lookups.categories.get(entry.tx.categoryId))
  const bank = lookups.banks.get(entry.tx.bankId)?.name ?? '—'
  return `${category} · ${bank}`
}

export function EntryRow({ entry, lookups, showDate = false, index = 0 }: { entry: Entry; lookups: Lookups; showDate?: boolean; index?: number }) {
  const i18n = useI18n()
  const isInv = entry.entryKind === 'investment'
  const category = !isInv ? lookups.categories.get(entry.tx.categoryId) : undefined
  const meta = isInv ? INVESTMENT_TYPE_MAP[entry.inv.type] : undefined
  const kind = isInv ? 'investment' : entry.tx.kind
  // Investimento: aplicação tira dinheiro do banco (−), resgate e rendimento devolvem (+).
  const signed = isInv ? (entry.inv.operation === 'contribution' ? -entry.amount : entry.amount) : entry.tx.kind === 'expense' ? -entry.amount : entry.amount
  const note = isInv ? entry.inv.note : entry.tx.note
  return (
    <button
      type="button"
      onClick={() => openEntry({ kind: isInv ? 'investment' : entry.tx.kind, id: entry.id })}
      className="fx-rise group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors duration-150 hover:bg-fill-2 active:bg-fill"
      style={{ animationDelay: `${Math.min(index, 12) * 22}ms` }}
    >
      {isInv ? <CategoryIcon icon={meta!.icon} color={meta!.color} /> : <CategoryIcon icon={category?.icon ?? 'ellipsis'} color={category?.color ?? '#8E8E93'} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-label">{entryTitle(entry)}</span>
        <span className="block truncate text-[13px] text-label-2">
          {showDate && <span className="tabular">{i18n.date(entry.date, 'short')} · </span>}
          {entrySubtitle(entry, lookups, i18n)}
          {note && <span className="text-label-3"> · {note}</span>}
        </span>
      </span>
      <Amount
        cents={signed}
        sign="always"
        className={cn('shrink-0 text-[15px] font-semibold', kind === 'income' && 'text-income', kind === 'investment' && 'text-invest')}
      />
    </button>
  )
}
