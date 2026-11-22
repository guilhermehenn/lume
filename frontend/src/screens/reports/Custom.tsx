// Personalizado: filtros (período, tipos, bancos, categorias, texto), agrupamento, exportação e
// relatórios salvos. O estado fica na tela de Relatórios, para não se perder ao trocar de aba.

import { useMemo, useState, type FormEvent } from 'react'
import { LuBookmark, LuDownload, LuEraser, LuMail, LuSave, LuX } from 'react-icons/lu'
import { useMail } from '../../app/mail'
import { reportPeriod, type Period } from '../../lib/period'
import { transactionsCsv } from '../../data/exporters'
import { DataError, LIMITS } from '../../data/model'
import { counterpartyLabels, filterTransactions, groupTransactions } from '../../data/selectors'
import { useOwnerName } from '../../data/session'
import { actions, undo, useData } from '../../data/store'
import type { Kind, ReportFilters, ReportGroupBy, SavedReport } from '../../data/types'
import { exportContext, useI18n } from '../../i18n'
import { cn } from '../../lib/cn'
import { Amount } from '../../ui/display'
import { MultiSelect, Select } from '../../ui/inputs'
import { Button, Card, EmptyState, IconButton, SearchField, Spinner } from '../../ui/primitives'
import { PeriodPicker } from '../../ui/period'
import { toast } from '../../ui/toast'
import { bankOptions, categoryOptions } from '../entry/options'

export interface CustomState {
  kinds: Kind[]
  bankIds: string[]
  categoryIds: string[]
  text: string
  groupBy: ReportGroupBy
  name: string
  /** Relatório salvo aberto agora (Salvar atualiza este; "Salvar como novo" cria outro). */
  currentId?: string
}

export const emptyCustom = (): CustomState => ({ kinds: [], bankIds: [], categoryIds: [], text: '', groupBy: 'category', name: '' })

const GROUPS: ReportGroupBy[] = ['category', 'bank', 'month', 'counterparty']

export function Custom({
  period,
  setPeriod,
  state,
  setState,
}: {
  period: Period
  setPeriod: (p: Period) => void
  state: CustomState
  setState: (update: (s: CustomState) => CustomState) => void
}) {
  const data = useData()
  const owner = useOwnerName()
  const mail = useMail()
  const i18n = useI18n()
  const { t } = i18n
  const [nameError, setNameError] = useState<string | null>(null)
  const { kinds, bankIds, categoryIds, text, groupBy, name, currentId } = state
  const set = <K extends keyof CustomState>(key: K, value: CustomState[K]) => setState((s) => ({ ...s, [key]: value }))
  const current = data.reports.find((r) => r.id === currentId)

  const filters = useMemo<ReportFilters>(() => {
    const f: ReportFilters = { from: period.from, to: period.to, kinds, bankIds, categoryIds, text: text.trim() || undefined }
    if (period.preset !== 'custom') f.preset = period.preset
    return f
  }, [period, kinds, bankIds, categoryIds, text])
  const list = useMemo(() => filterTransactions(data, filters), [data, filters])
  const rows = useMemo(() => groupTransactions(list, groupBy), [list, groupBy])
  const labels = useMemo(() => counterpartyLabels(list), [list])
  const totals = rows.reduce((a, r) => ({ income: a.income + r.income, expense: a.expense + r.expense }), { income: 0, expense: 0 })
  const lookups = useMemo(
    () => ({ categories: new Map(data.categories.map((c) => [c.id, c])), banks: new Map(data.banks.map((b) => [b.id, b.name])) }),
    [data.categories, data.banks],
  )

  // Categorias acompanham o filtro de tipo; com os dois tipos, cada uma diz de qual é
  // (receita e despesa podem ter o mesmo nome).
  const shownKinds: Kind[] = kinds.length === 1 ? kinds : ['expense', 'income']
  const catOptions = shownKinds.flatMap((k) => categoryOptions(data, k, i18n).map((o) => ({ ...o, hint: shownKinds.length > 1 ? t(`kinds.${k}`) : undefined })))
  const setKinds = (next: Kind[]) =>
    setState((s) => {
      const keep = next.length === 1 ? new Set(data.categories.filter((c) => c.kind === next[0]).map((c) => c.id)) : null
      return { ...s, kinds: next, categoryIds: keep ? s.categoryIds.filter((id) => keep.has(id)) : s.categoryIds }
    })

  const labelFor = (key: string) => {
    if (groupBy === 'category') return i18n.categoryName(lookups.categories.get(key))
    if (groupBy === 'bank') return lookups.banks.get(key) ?? '—'
    if (groupBy === 'month') return i18n.month(key)
    return labels.get(key) ?? key
  }
  const filtered = kinds.length > 0 || bankIds.length > 0 || categoryIds.length > 0 || text.trim() !== '' || currentId !== undefined

  const load = (report: SavedReport) => {
    setState(() => ({
      kinds: report.filters.kinds,
      bankIds: report.filters.bankIds,
      categoryIds: report.filters.categoryIds,
      text: report.filters.text ?? '',
      groupBy: report.groupBy,
      name: report.name,
      currentId: report.id,
    }))
    // "Este mês" salvo abre no mês de hoje; datas escolhidas abrem como foram salvas.
    const saved = reportPeriod(report.filters)
    if (saved) setPeriod(saved)
    setNameError(null)
  }
  const save = (asNew: boolean) => {
    try {
      const report = actions.saveReport({ id: asNew ? undefined : currentId, name, filters, groupBy })
      setState((s) => ({ ...s, name: report.name, currentId: report.id }))
      toast(asNew || !currentId ? t('reports.savedReport') : t('reports.updatedReport'))
      setNameError(null)
    } catch (err) {
      const code = err instanceof DataError ? err.code : null
      if (code === 'duplicate') setNameError(t('reports.duplicateName'))
      else if (code === 'invalid' && (err as DataError).field === 'name') setNameError(t('form.errors.name'))
      else if (code === 'invalid' && (err as DataError).field === 'period') toast.error(t('reports.invalidPeriod'))
      else if (code === 'limit') toast.error(t('reports.limit', { max: LIMITS.reports }))
      else toast.error(t('errors.generic'))
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) save(false)
  }
  const remove = (report: SavedReport) => {
    actions.deleteReport(report.id)
    if (currentId === report.id) set('currentId', undefined)
    toast(t('reports.deletedReport'), { action: { label: t('common.undo'), onClick: () => undo() } })
  }
  const clear = () => {
    setState(() => emptyCustom())
    setNameError(null)
  }
  const csvFile = () => {
    const csv = transactionsCsv(data, exportContext(i18n, owner.full), undefined, list)
    const label = t('mail.labels.report', { name: current?.name ?? t('reports.range', { from: i18n.date(period.from, 'short'), to: i18n.date(period.to, 'short') }) })
    return { blob: new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename: `lume-${period.from}-${period.to}.csv`, label }
  }
  const exportCsv = () => void mail.deliver(csvFile())
  const emailCsv = () => void mail.email(csvFile())

  return (
    <div className="space-y-4">
      {data.reports.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <span className="mr-1 flex items-center gap-1.5 text-[13px] font-medium text-label-2">
            <LuBookmark className="size-3.5" aria-hidden />
            {t('reports.savedReports')}
          </span>
          {data.reports.map((r) => (
            <span
              key={r.id}
              className={cn('fx-pop flex items-center rounded-full text-[13.5px] font-medium transition-colors', currentId === r.id ? 'bg-accent text-white' : 'bg-fill-2 text-label hover:bg-fill')}
            >
              <button type="button" onClick={() => load(r)} aria-pressed={currentId === r.id} className="py-1 pr-1 pl-3">
                {r.name}
              </button>
              <IconButton label={t('reports.deleteReport', { name: r.name })} onClick={() => remove(r)} className={cn('mr-0.5 size-6', currentId === r.id ? 'text-white/80 hover:bg-white/20 hover:text-white' : '')}>
                <LuX className="size-3" aria-hidden />
              </IconButton>
            </span>
          ))}
        </div>
      )}

      <Card className="fx-rise space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <PeriodPicker value={period} onChange={setPeriod} />
          <div className="flex h-9 items-center gap-2 rounded-[10px] bg-fill-2 pr-1 pl-3 text-[14px]">
            <span className="text-label-2">{t('reports.groupBy')}</span>
            <Select label={t('reports.groupBy')} value={groupBy} options={GROUPS.map((g) => ({ value: g, label: t(`reports.groups.${g}`) }))} placeholder="" onChange={(v) => set('groupBy', v)} />
          </div>
          {filtered && (
            <Button size="sm" variant="ghost" onClick={clear} className="ml-auto print:hidden">
              <LuEraser className="size-3.5" aria-hidden />
              {t('reports.clear')}
            </Button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MultiSelect
            label={t('reports.kinds')}
            allLabel={`${t('reports.kinds')}: ${t('common.all').toLowerCase()}`}
            value={kinds}
            onChange={setKinds}
            options={[
              { value: 'expense', label: t('kinds.expenses') },
              { value: 'income', label: t('kinds.incomes') },
            ]}
          />
          <MultiSelect label={t('reports.banks')} allLabel={t('reports.allBanks')} value={bankIds} onChange={(v) => set('bankIds', v)} options={bankOptions(data)} />
          <MultiSelect label={t('reports.categories')} allLabel={t('reports.allCategories')} value={categoryIds} onChange={(v) => set('categoryIds', v)} options={catOptions} />
          <SearchField value={text} onChange={(v) => set('text', v)} placeholder={t('reports.text')} />
        </div>
      </Card>

      <Card className="fx-rise overflow-x-auto" style={{ animationDelay: '60ms' }}>
        <div className="flex flex-wrap items-center gap-2 px-6 pt-5 pb-2">
          <h3 className="flex-1 text-[16.5px] font-semibold tracking-tight" role="status">
            {t('reports.results', { count: list.length })}
          </h3>
          <Button size="sm" onClick={emailCsv} disabled={list.length === 0 || mail.sending} className="print:hidden">
            {mail.sending ? <Spinner /> : <LuMail className="size-3.5" aria-hidden />}
            {t('mail.send')}
          </Button>
          <Button size="sm" onClick={exportCsv} disabled={list.length === 0} className="print:hidden">
            <LuDownload className="size-3.5" aria-hidden />
            {t('reports.exportCsv')}
          </Button>
        </div>
        {rows.length === 0 ? (
          <EmptyState title={t('reports.noData')} />
        ) : (
          <table className="w-full min-w-[34rem] text-[14px]" aria-label={t('reports.results', { count: list.length })}>
            <thead>
              <tr className="border-b border-sep/60 text-left text-[13px] text-label-2">
                <th scope="col" className="px-6 py-3 font-medium">{t(`reports.groups.${groupBy}`)}</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">{t('reports.count')}</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">{t('reports.income')}</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">{t('reports.expense')}</th>
                <th scope="col" className="px-6 py-3 text-right font-medium">{t('reports.net')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-sep/30 last:border-0 hover:bg-fill-2/50">
                  <th scope="row" className="max-w-64 truncate px-6 py-3 text-left font-medium">{labelFor(r.key)}</th>
                  <td className="tabular px-3 py-3 text-right text-label-2">{r.count}</td>
                  <td className="px-3 py-3 text-right"><Amount cents={r.income} className={r.income ? 'text-income' : 'text-label-3'} /></td>
                  <td className="px-3 py-3 text-right"><Amount cents={r.expense} className={r.expense ? undefined : 'text-label-3'} /></td>
                  <td className="px-6 py-3 text-right font-semibold"><Amount cents={r.net} className={r.net < 0 ? 'text-expense' : undefined} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-sep/60 font-semibold">
                <th scope="row" className="px-6 py-3.5 text-left">{t('common.total')}</th>
                <td className="tabular px-3 py-3 text-right">{list.length}</td>
                <td className="px-3 py-3 text-right"><Amount cents={totals.income} className="text-income" /></td>
                <td className="px-3 py-3 text-right"><Amount cents={totals.expense} /></td>
                <td className="px-6 py-3.5 text-right"><Amount cents={totals.income - totals.expense} className={totals.income - totals.expense < 0 ? 'text-expense' : undefined} /></td>
              </tr>
            </tfoot>
          </table>
        )}
      </Card>

      <Card className="fx-rise p-3 print:hidden" style={{ animationDelay: '100ms' }}>
        <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
          <label htmlFor="report-name" className="sr-only">
            {t('reports.reportName')}
          </label>
          <input
            id="report-name"
            value={name}
            maxLength={LIMITS.name}
            onChange={(e) => {
              set('name', e.target.value)
              setNameError(null)
            }}
            placeholder={t('reports.reportNamePlaceholder')}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'report-name-error' : undefined}
            className="h-9 min-w-48 flex-1 rounded-[10px] bg-fill-2 px-3 text-[15px] outline-none placeholder:text-label-3 focus:ring-2 focus:ring-accent/60"
          />
          <Button type="submit" variant="tinted" disabled={!name.trim()}>
            <LuSave className="size-4" aria-hidden />
            {currentId ? t('reports.updateReport') : t('reports.saveReport')}
          </Button>
          {currentId && (
            <Button onClick={() => save(true)} disabled={!name.trim()}>
              {t('reports.saveAsNew')}
            </Button>
          )}
        </form>
        {nameError && (
          <p id="report-name-error" role="alert" className="mt-2 px-1 text-[13px] font-medium text-expense">
            {nameError}
          </p>
        )}
        <p className="mt-2 px-1 text-[12.5px] text-label-3">
          {period.preset !== 'custom' ? t('reports.relativeHint', { period: t(`reports.presets.${period.preset}`) }) : t('reports.fixedHint')}
        </p>
      </Card>
      {data.reports.length === 0 && <p className="px-1 text-[13px] text-label-3">{t('reports.noSaved')}</p>}
    </div>
  )
}
