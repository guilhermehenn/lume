// Por categoria: rosca e lista do período. Cada categoria abre o personalizado já filtrado, para
// ver para quem foi (ou de quem veio) o dinheiro.

import { useMemo, useState } from 'react'
import { LuChevronRight } from 'react-icons/lu'
import { cn } from '../../lib/cn'
import type { Period } from '../../lib/period'
import { categoryTotals } from '../../data/selectors'
import { useData } from '../../data/store'
import type { Kind } from '../../data/types'
import { useI18n } from '../../i18n'
import { Amount, CategoryIcon, Donut, useHidden } from '../../ui/display'
import { Card, CardHeader, EmptyState, Segmented } from '../../ui/primitives'
import { PeriodPicker } from '../../ui/period'

export function ByCategory({
  period,
  setPeriod,
  onDrill,
}: {
  period: Period
  setPeriod: (p: Period) => void
  onDrill: (categoryId: string, kind: Kind) => void
}) {
  const data = useData()
  const i18n = useI18n()
  const { t } = i18n
  const hidden = useHidden()
  const [kind, setKind] = useState<Kind>('expense')
  const [active, setActive] = useState<string | null>(null)
  const groups = useMemo(() => categoryTotals(data, kind, period.from, period.to), [data, kind, period])
  const categories = useMemo(() => new Map(data.categories.map((c) => [c.id, c])), [data.categories])
  const total = groups.reduce((s, g) => s + g.total, 0)
  const segments = groups.map((g) => {
    const c = categories.get(g.key)
    return { key: g.key, value: g.total, color: c?.color ?? '#8E8E93', label: i18n.categoryName(c) }
  })
  const current = segments.find((s) => s.key === active)
  const title = kind === 'expense' ? t('reports.topExpenses') : t('reports.topIncome')
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <PeriodPicker value={period} onChange={setPeriod} />
        <Segmented
          className="w-60"
          label={t('common.type')}
          value={kind}
          onChange={(next) => {
            setKind(next)
            setActive(null)
          }}
          options={[
            { value: 'expense', label: t('kinds.expenses'), tone: 'text-expense' },
            { value: 'income', label: t('kinds.incomes'), tone: 'text-income' },
          ]}
        />
      </div>
      {groups.length === 0 ? (
        <Card>
          <EmptyState title={t('reports.noData')} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <Card className="fx-rise grid place-items-center p-6 lg:col-span-2">
            <Donut
              key={kind}
              segments={segments}
              size={220}
              thickness={18}
              label={segments.map((s) => `${s.label}${hidden ? '' : ` ${i18n.percent((s.value / total) * 100, { digits: 1 })}`}`).join(', ')}
              activeKey={active}
              onActiveChange={setActive}
              center={
                <div className="flex w-[130px] flex-col items-center">
                  <p className="line-clamp-2 text-[13px] leading-tight text-label-2">{current ? current.label : t('common.total')}</p>
                  <Amount cents={current ? current.value : total} className="text-[18.5px] font-bold" />
                  {current && !hidden && <p className="text-[13px] text-label-3">{t('reports.share', { value: i18n.percent((current.value / total) * 100, { digits: 1 }) })}</p>}
                </div>
              }
            />
          </Card>
          <Card className="fx-rise lg:col-span-3" style={{ animationDelay: '60ms' }}>
            <CardHeader title={title} />
            <p className="-mt-2 px-6 pb-2 text-[13px] text-label-2 print:hidden">{t('reports.drillHint')}</p>
            <ul className="px-2 pb-2">
              {groups.map((g, i) => {
                const c = categories.get(g.key)
                const name = i18n.categoryName(c)
                return (
                  <li key={g.key} className="fx-rise" style={{ animationDelay: `${80 + i * 25}ms` }}>
                    {/* Botão: pelo teclado também destaca a fatia, e Enter abre o detalhe. */}
                    <button
                      type="button"
                      onClick={() => onDrill(g.key, kind)}
                      onPointerEnter={() => setActive(g.key)}
                      onPointerLeave={() => setActive(null)}
                      onFocus={() => setActive(g.key)}
                      onBlur={() => setActive(null)}
                      aria-label={t('reports.drill', { name })}
                      className={cn('group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-fill-2', active === g.key && 'bg-fill-2')}
                    >
                      <CategoryIcon icon={c?.icon ?? 'ellipsis'} color={c?.color ?? '#8E8E93'} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">{name}</span>
                        <span className="block text-[13px] text-label-2">{t('common.entries', { count: g.count })}</span>
                      </span>
                      {!hidden && <span className="tabular text-[13px] text-label-3">{i18n.percent((g.total / total) * 100, { digits: 1 })}</span>}
                      <Amount cents={g.total} className="w-28 text-right text-[15px] font-semibold" />
                      <LuChevronRight className="size-4 shrink-0 text-label-3 transition-transform group-hover:translate-x-0.5 print:hidden" aria-hidden />
                    </button>
                  </li>
                )
              })}
            </ul>
          </Card>
        </div>
      )}
    </div>
  )
}
