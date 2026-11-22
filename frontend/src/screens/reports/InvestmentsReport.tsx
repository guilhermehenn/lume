// Investimentos para o Imposto de Renda: posição em 31/12 pelo custo (ficha Bens e Direitos),
// resultado em vendas e resgates no ano e rendimentos recebidos com o IR retido.

import { useMemo } from 'react'
import { availableYears, yearEarnings, yearPositions } from '../../data/exporters'
import { INVESTMENT_TYPE_MAP } from '../../data/investments'
import { useOwnerName } from '../../data/session'
import { useData } from '../../data/store'
import { exportContext, useI18n } from '../../i18n'
import { Amount, CategoryIcon } from '../../ui/display'
import { Select } from '../../ui/inputs'
import { Badge, Card, CardHeader, EmptyState } from '../../ui/primitives'

export function InvestmentsReport({ year, setYear }: { year: number; setYear: (year: number) => void }) {
  const data = useData()
  const owner = useOwnerName()
  const i18n = useI18n()
  const { t } = i18n
  const years = useMemo(() => availableYears(data), [data])
  const rows = useMemo(() => yearPositions(data, year, exportContext(i18n, owner.full)), [data, year, i18n, owner.full])
  // Rendimentos e IR retido por tipo, numa passada.
  const earnings = useMemo(() => yearEarnings(data, year), [data, year])
  const endDate = i18n.date(`${year}-12-31`, 'short')
  const prevDate = i18n.date(`${year - 1}-12-31`, 'short')
  const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + pick(r), 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-9 items-center gap-2 rounded-[10px] bg-fill-2 pr-1 pl-3 text-[14px]">
          <span className="text-label-2">{t('reports.year')}</span>
          <Select label={t('reports.year')} value={String(year)} options={years.map((y) => ({ value: String(y), label: String(y) }))} placeholder="" onChange={(v) => setYear(Number(v))} />
        </div>
        <p className="text-[13.5px] text-label-2">{t('reports.positionHint')}</p>
      </div>
      <Card className="fx-rise overflow-x-auto">
        <CardHeader title={t('reports.positionAt', { date: endDate })} />
        {rows.length === 0 ? (
          <EmptyState title={t('reports.noData')} />
        ) : (
          <table className="w-full min-w-[52rem] text-[14px]" aria-label={t('reports.positionAt', { date: endDate })}>
            <thead>
              <tr className="border-b border-sep/60 text-left text-[13px] text-label-2">
                <th scope="col" className="px-6 py-3 font-medium">{t('reports.irpfCols')}</th>
                <th scope="col" className="px-3 py-3 font-medium">{t('export.cols.asset')}</th>
                <th scope="col" className="px-3 py-3 font-medium">{t('export.cols.bank')}</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">{prevDate}</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">{endDate}</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">{t('reports.realizedYear')}</th>
                <th scope="col" className="px-6 py-3 text-right font-medium">{t('investments.earnings')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const meta = INVESTMENT_TYPE_MAP[r.type]
                const code = r.group ? t('investments.irpfBadge', { group: r.group, code: r.code }) : t('form.irpfNone')
                return (
                  <tr key={r.key} className="border-b border-sep/30 last:border-0 hover:bg-fill-2/50">
                    <td className="px-6 py-3">
                      {/* PGBL não vai em Bens e Direitos: traço, com a explicação para quem passar o mouse. */}
                      <Badge title={code} aria-label={code}>
                        {r.group ? `${r.group} · ${r.code}` : '—'}
                      </Badge>
                    </td>
                    <td className="px-3 py-3">
                      <span className="flex items-center gap-2">
                        <CategoryIcon icon={meta.icon} color={meta.color} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{r.asset}</span>
                          <span className="block truncate text-[12.5px] text-label-2">
                            {t(`investmentTypes.${r.type}`)}
                            {r.cnpj && <> · {r.cnpj}</>}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-3 text-label-2">{r.bank}</td>
                    <td className="px-3 py-3 text-right"><Amount cents={r.costPrevious} className={r.costPrevious ? 'text-label-2' : 'text-label-3'} /></td>
                    <td className="px-3 py-3 text-right font-semibold"><Amount cents={r.costCurrent} /></td>
                    <td className="px-3 py-3 text-right">
                      <Amount cents={r.realized} sign={r.realized ? 'always' : undefined} className={r.realized > 0 ? 'text-income' : r.realized < 0 ? 'text-expense' : 'text-label-3'} />
                    </td>
                    <td className="px-6 py-3 text-right"><Amount cents={r.earnings} className={r.earnings ? 'text-income' : 'text-label-3'} /></td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-sep/60 font-semibold">
                <th scope="row" className="px-6 py-3.5 text-left" colSpan={3}>{t('common.total')}</th>
                <td className="px-3 py-3 text-right"><Amount cents={sum((r) => r.costPrevious)} /></td>
                <td className="px-3 py-3 text-right"><Amount cents={sum((r) => r.costCurrent)} /></td>
                <td className="px-3 py-3 text-right"><Amount cents={sum((r) => r.realized)} sign={sum((r) => r.realized) ? 'always' : undefined} /></td>
                <td className="px-6 py-3.5 text-right"><Amount cents={sum((r) => r.earnings)} className="text-income" /></td>
              </tr>
            </tfoot>
          </table>
        )}
      </Card>
      <Card className="fx-rise" style={{ animationDelay: '60ms' }}>
        <CardHeader title={t('reports.earningsTitle')} />
        {earnings.size === 0 ? (
          <EmptyState title={t('reports.noData')} />
        ) : (
          <ul className="px-6 pb-5">
            {[...earnings.entries()].map(([kind, e]) => (
              <li key={kind} className="flex items-center gap-3 border-b border-sep/30 py-2.5 text-[14px] last:border-0">
                <span className="flex-1 font-medium">{t(`earningKinds.${kind}`)}</span>
                {e.tax > 0 && (
                  <span className="text-[13px] text-label-2">
                    {t('reports.taxWithheld')}: <Amount cents={e.tax} />
                  </span>
                )}
                <Amount cents={e.total} className="w-28 text-right font-semibold text-income" />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
