// Peças comuns aos relatórios: cores das séries, cartão de número e barras por categoria.

import type { ReactNode } from 'react'
import type { GroupTotal } from '../../data/selectors'
import { useData } from '../../data/store'
import type { Kind } from '../../data/types'
import { useI18n } from '../../i18n'
import { Amount, CategoryIcon, ProgressBar, useHidden } from '../../ui/display'
import { Card, EmptyState } from '../../ui/primitives'

export const COLORS = { income: 'var(--lume-green)', expense: 'var(--lume-red)', invest: 'var(--lume-purple)' }

export function Kpi({ label, children, delay = 0 }: { label: string; children: ReactNode; delay?: number }) {
  return (
    <Card className="fx-rise p-5" style={{ animationDelay: `${delay}ms` }}>
      <p className="text-[13px] font-medium text-label-2">{label}</p>
      {/* No celular, dois por linha: a letra diminui com a tela para o valor caber inteiro. */}
      <div className="mt-1 truncate text-[clamp(17px,4.8vw,23px)] font-bold tracking-[-0.02em]">{children}</div>
    </Card>
  )
}

export function CategoryBars({ groups, total, kind }: { groups: GroupTotal[]; total: number; kind: Kind }) {
  const data = useData()
  const i18n = useI18n()
  const hidden = useHidden()
  const max = groups[0]?.total ?? 0
  if (groups.length === 0) return <EmptyState title={i18n.t('reports.noData')} />
  const categories = new Map(data.categories.map((c) => [c.id, c]))
  return (
    <ul className="space-y-3.5 px-6 pb-6">
      {groups.map((g, i) => {
        const category = categories.get(g.key)
        return (
          <li key={g.key} className="fx-rise" style={{ animationDelay: `${220 + i * 40}ms` }}>
            <div className="mb-1.5 flex items-center gap-2.5 text-[14px]">
              <CategoryIcon icon={category?.icon ?? 'ellipsis'} color={category?.color ?? '#8E8E93'} size="sm" />
              <span className="min-w-0 flex-1 truncate font-medium">{i18n.categoryName(category)}</span>
              {!hidden && total > 0 && <span className="tabular text-[13px] text-label-3">{i18n.percent((g.total / total) * 100, { digits: 0 })}</span>}
              <Amount cents={g.total} className="font-semibold" />
            </div>
            <ProgressBar value={g.total} max={max} color={category?.color ?? (kind === 'income' ? COLORS.income : COLORS.expense)} />
          </li>
        )
      })}
    </ul>
  )
}
