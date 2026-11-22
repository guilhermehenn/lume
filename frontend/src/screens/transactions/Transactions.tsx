// Lançamentos: lista única de despesas, receitas e investimentos, agrupada por dia.
//
// O endereço guarda o que está na tela (?month=, ?q=, ?kind=, ?bank=, ?category=), então o
// Início e os relatórios podem abrir a lista já filtrada, e recarregar não perde nada.
// Os totais mostram o mês (ou a busca) com banco e categoria, mas sem o filtro de tipo: escolher
// "Despesas" não zera o "Entrou", só destaca o "Saiu".

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { LuArrowLeftRight, LuSearchX } from 'react-icons/lu'
import { openNewEntry } from '../../app/entrySheet'
import { replaceQuery, useRoute } from '../../app/router'
import { cn } from '../../lib/cn'
import { addDays, fromISODate, monthOf, type ISODate, type MonthKey } from '../../lib/dates'
import { normalize } from '../../lib/text'
import { useToday } from '../../lib/useToday'
import type { Entry } from '../../data/selectors'
import { useData } from '../../data/store'
import type { Kind } from '../../data/types'
import { useI18n, type I18n } from '../../i18n'
import { Amount } from '../../ui/display'
import { Select, type SelectOption } from '../../ui/inputs'
import { Button, Card, EmptyState, PageHeader, SearchField, Segmented } from '../../ui/primitives'
import { MonthSwitcher } from '../../ui/period'
import { bankOptions, categoryOptions } from '../entry/options'
import { EntryRow, entrySubtitle, entryTitle, useLookups } from '../EntryRow'
import {
  buildSearchIndex,
  groupByDay,
  KIND_FILTERS,
  matchesScope,
  monthEntries,
  searchEntries,
  totalsOf,
  type KindFilter,
} from './list'

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
/** Linhas desenhadas de cada vez; "Mostrar mais" traz o próximo bloco. */
export const PAGE_SIZE = 300

export const FOCUS_SEARCH_EVENT = 'lume:focus-search'
let focusPending = false

/**
 * Atalho "/": foca a busca. Vindo de outra tela, a lista ainda nem existe quando o atalho
 * dispara; o pedido fica guardado e a lista foca a busca assim que aparece.
 */
export function focusTransactionsSearch(): void {
  focusPending = true
  window.dispatchEvent(new Event(FOCUS_SEARCH_EVENT))
}

/** "Hoje", "Ontem", "Amanhã"; de outro ano, com o ano. */
export function dayLabel(date: ISODate, today: ISODate, i18n: I18n): string {
  if (date === today) return i18n.t('common.today')
  if (date === addDays(today, -1)) return i18n.t('common.yesterday')
  if (date === addDays(today, 1)) return i18n.t('common.tomorrow')
  if (date.slice(0, 4) === today.slice(0, 4)) return i18n.date(date, 'long')
  return new Intl.DateTimeFormat(i18n.locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(fromISODate(date))
}

export function Transactions() {
  const data = useData()
  const i18n = useI18n()
  const { t } = i18n
  const route = useRoute()
  const { today } = useToday()
  const lookups = useLookups(data)
  const searchRef = useRef<HTMLInputElement>(null)

  // ---- o que está no endereço (valores inválidos são ignorados)
  const thisMonth = monthOf(today)
  const monthParam = route.query.get('month') ?? ''
  const month: MonthKey = MONTH_RE.test(monthParam) ? monthParam : thisMonth
  const kindParam = route.query.get('kind') as KindFilter | null
  const kind: KindFilter = kindParam && KIND_FILTERS.includes(kindParam) ? kindParam : 'all'
  const bankParam = route.query.get('bank')
  const bankId = bankParam && lookups.banks.has(bankParam) ? bankParam : undefined
  const categoryParam = route.query.get('category')
  const category = categoryParam ? lookups.categories.get(categoryParam) : undefined
  // Categoria de outro tipo que o escolhido (ex.: "Mercado" com "Receitas") não vale.
  const categoryId = category && (kind === 'all' || kind === category.kind) ? category.id : undefined
  const urlText = route.query.get('q') ?? ''
  const [text, setText] = useState(urlText)
  // Alguém abriu a lista com outra busca no endereço (voltar, link): a caixa acompanha.
  useEffect(() => setText((current) => (current === urlText ? current : urlText)), [urlText])
  const query = normalize(text.trim())
  const searching = query !== ''

  useEffect(() => {
    const focus = () => {
      focusPending = false
      searchRef.current?.focus()
    }
    if (focusPending) focus()
    window.addEventListener(FOCUS_SEARCH_EVENT, focus)
    return () => window.removeEventListener(FOCUS_SEARCH_EVENT, focus)
  }, [])

  // ---- o que entra na lista
  const describe = useCallback(
    (e: Entry) =>
      e.entryKind === 'investment'
        ? `${entryTitle(e)} ${entrySubtitle(e, lookups, i18n)} ${e.inv.issuer ?? ''} ${e.inv.note ?? ''}`
        : `${entryTitle(e)} ${entrySubtitle(e, lookups, i18n)} ${e.tx.note ?? ''}`,
    [lookups, i18n],
  )
  // O índice só existe enquanto há busca. O cache (um por `describe`: nomes de banco e
  // categoria, idioma) faz uma gravação no meio da busca normalizar só o que mudou.
  const hayCache = useMemo(() => new WeakMap<object, string>(), [describe])
  const index = useMemo(() => (searching ? buildSearchIndex(data, describe, hayCache) : null), [searching, data, describe, hayCache])
  const base = useMemo(() => (index ? searchEntries(index, query) : monthEntries(data, month)), [index, query, data, month])
  const scoped = useMemo(() => (bankId || categoryId ? base.filter((e) => matchesScope(e, bankId, categoryId)) : base), [base, bankId, categoryId])
  const totals = useMemo(() => totalsOf(scoped), [scoped])
  const visible = useMemo(() => (kind === 'all' ? scoped : scoped.filter((e) => e.entryKind === kind)), [scoped, kind])

  // ---- "Mostrar mais": volta ao primeiro bloco quando muda o que está sendo visto
  const scopeKey = [month, query, kind, bankId, categoryId].join('|')
  const [paging, setPaging] = useState({ key: scopeKey, limit: PAGE_SIZE })
  const limit = paging.key === scopeKey ? paging.limit : PAGE_SIZE
  const days = useMemo(() => groupByDay(visible.slice(0, limit)), [visible, limit])
  /** Posição da primeira linha de cada dia (para o atraso da animação de entrada). */
  const starts = useMemo(() => {
    let n = 0
    return days.map((day) => {
      const first = n
      n += day.entries.length
      return first
    })
  }, [days])
  const hidden = visible.length - Math.min(limit, visible.length)

  // ---- ações
  const setKind = (next: KindFilter) => {
    const keepCategory = category && (next === 'all' || next === category.kind)
    replaceQuery({ kind: next === 'all' ? undefined : next, category: keepCategory ? category.id : undefined })
  }
  const setMonth = (m: MonthKey) => replaceQuery({ month: m === thisMonth ? undefined : m })
  const onSearch = (value: string) => {
    setText(value)
    replaceQuery({ q: value || undefined })
  }
  const filtered = searching || kind !== 'all' || Boolean(bankId) || Boolean(categoryId)
  const clearFilters = () => {
    setText('')
    replaceQuery({ q: undefined, kind: undefined, bank: undefined, category: undefined })
  }

  const bankChoices = useMemo<SelectOption<string>[]>(() => [{ value: '', label: t('transactions.allBanks') }, ...bankOptions(data)], [data, t])
  const categoryChoices = useMemo<SelectOption<string>[]>(() => {
    const kinds: Kind[] = kind === 'income' ? ['income'] : kind === 'expense' ? ['expense'] : ['expense', 'income']
    const both = kinds.length > 1
    const options = kinds.flatMap((k) => categoryOptions(data, k, i18n).map((o) => (both ? { ...o, hint: t(`kinds.${k}`) } : o)))
    return [{ value: '', label: t('transactions.allCategories') }, ...options]
  }, [data, kind, i18n, t])

  return (
    <div>
      <PageHeader title={t('transactions.title')} actions={<MonthSwitcher month={month} current={thisMonth} onChange={setMonth} disabled={searching} />} />

      <div className="fx-rise mb-3 flex flex-wrap items-center gap-3" style={{ animationDelay: '40ms' }}>
        <SearchField inputRef={searchRef} value={text} onChange={onSearch} placeholder={t('transactions.searchPlaceholder')} className="min-w-56 flex-1" />
        <Segmented
          className="w-full sm:w-[25rem]"
          label={t('common.type')}
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: t('transactions.filterAll') },
            { value: 'expense', label: t('kinds.expenses') },
            { value: 'income', label: t('kinds.incomes') },
            {
              value: 'investment',
              label: (
                <>
                  <span className="max-sm:hidden">{t('kinds.investments')}</span>
                  <span className="sm:hidden">{t('kinds.investmentsShort')}</span>
                </>
              ),
            },
          ]}
        />
      </div>

      <div className="fx-rise mb-4 flex flex-wrap items-center gap-2" style={{ animationDelay: '60ms' }}>
        <FilterPill active={Boolean(bankId)}>
          <Select
            id="filter-bank"
            label={t('common.bank')}
            value={bankId ?? ''}
            options={bankChoices}
            placeholder={t('transactions.allBanks')}
            onChange={(v) => replaceQuery({ bank: v || undefined })}
            className="mr-0"
          />
        </FilterPill>
        {kind !== 'investment' && (
          <FilterPill active={Boolean(categoryId)}>
            <Select
              id="filter-category"
              label={t('form.category')}
              value={categoryId ?? ''}
              options={categoryChoices}
              placeholder={t('transactions.allCategories')}
              onChange={(v) => replaceQuery({ category: v || undefined })}
              className="mr-0"
            />
          </FilterPill>
        )}
        {searching && (
          <span className="text-[13px] text-label-2" role="status">
            {t('transactions.searchScope', { count: visible.length })}
          </span>
        )}
        {filtered && (
          <button type="button" onClick={clearFilters} className="ml-auto rounded-lg px-2 py-1 text-[13.5px] font-medium text-accent hover:bg-fill-2">
            {t('transactions.clearFilters')}
          </button>
        )}
      </div>

      <div className="fx-rise mb-5 grid gap-2 sm:grid-cols-3 sm:gap-3" style={{ animationDelay: '80ms' }}>
        <TotalPill label={searching ? t('transactions.foundIn') : t('transactions.monthIn')} cents={totals.income} tone="text-income" dim={kind !== 'all' && kind !== 'income'} />
        <TotalPill label={searching ? t('transactions.foundOut') : t('transactions.monthOut')} cents={totals.expense} dim={kind !== 'all' && kind !== 'expense'} />
        <TotalPill
          label={searching ? t('transactions.foundInvested') : t('transactions.monthInvested')}
          cents={totals.invested}
          tone="text-invest"
          dim={kind !== 'all' && kind !== 'investment'}
        />
      </div>

      <Card className="fx-rise overflow-hidden" style={{ animationDelay: '120ms' }}>
        {days.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={<LuSearchX />}
              title={t('transactions.emptyFiltered')}
              action={<Button onClick={clearFilters}>{t('transactions.clearFilters')}</Button>}
            />
          ) : (
            <EmptyState
              icon={<LuArrowLeftRight />}
              title={t('transactions.empty')}
              hint={t('transactions.emptyHint')}
              action={
                <Button variant="primary" onClick={() => openNewEntry()}>
                  {t('nav.new')}
                </Button>
              }
            />
          )
        ) : (
          <div className="px-2 py-2">
            {days.map((day, d) => {
              const label = dayLabel(day.date, today, i18n)
              const first = starts[d]
              return (
                <section key={day.date} className="mb-1" aria-label={label}>
                  <div className="sticky top-0 z-[1] flex items-center gap-2 bg-surface/90 px-3 pt-3 pb-1.5 backdrop-blur-sm">
                    <h2 className="text-[13px] font-semibold text-label-2 first-letter:uppercase">{label}</h2>
                    {day.date > today && <span className="rounded-full bg-fill-2 px-1.5 text-[11.5px] font-medium text-label-2">{t('transactions.future')}</span>}
                    <span className="flex-1" />
                    {day.entries.length > 1 && day.net !== 0 && <Amount cents={day.net} sign="always" className="text-[13px] font-medium text-label-3" />}
                  </div>
                  {day.entries.map((entry, i) => (
                    <EntryRow key={entry.id} entry={entry} lookups={lookups} index={first + i} />
                  ))}
                </section>
              )
            })}
            {hidden > 0 && (
              <div className="flex justify-center p-3">
                <Button onClick={() => setPaging({ key: scopeKey, limit: limit + PAGE_SIZE })}>{t('transactions.showMore', { count: hidden })}</Button>
              </div>
            )}
          </div>
        )}
      </Card>
      {visible.length > 0 && <p className="mt-3 text-center text-[13px] text-label-3">{t('common.entries', { count: visible.length })}</p>}
    </div>
  )
}

function FilterPill({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div className={cn('flex h-10 items-center rounded-[11px] bg-fill-2 pr-2.5 pl-1 max-sm:min-w-0 max-sm:flex-1', active && 'ring-2 ring-accent/60')}>
      {children}
    </div>
  )
}

/** No celular, uma linha por total (rótulo e valor lado a lado): em três colunas o valor era cortado. */
function TotalPill({ label, cents, tone, dim }: { label: string; cents: number; tone?: string; dim?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3 rounded-2xl bg-surface px-4 py-2.5 shadow-card ring-1 ring-sep/40 transition-opacity sm:block sm:py-3',
        dim && 'opacity-45',
      )}
    >
      <p className="text-[13px] font-medium text-label-2">{label}</p>
      <Amount cents={cents} animate className={cn('mt-0.5 block truncate text-[17px] font-semibold tracking-[-0.015em] sm:text-[20px]', tone)} />
    </div>
  )
}
