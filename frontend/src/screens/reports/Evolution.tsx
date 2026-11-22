// Evolução: os últimos 12 meses (até o mês de hoje), em gráfico e em tabela.

import { useMemo } from 'react'
import { lastMonths, monthOf, type ISODate } from '../../lib/dates'
import { monthlySeries } from '../../data/selectors'
import { useData } from '../../data/store'
import { useI18n } from '../../i18n'
import { Amount, BarChart, Legend, useHidden } from '../../ui/display'
import { Card } from '../../ui/primitives'
import { COLORS } from './parts'

export function Evolution({ today }: { today: ISODate }) {
  const data = useData()
  const i18n = useI18n()
  const { t } = i18n
  const hidden = useHidden()
  // Mês de hoje pelo relógio do app: acompanha a virada do mês com a tela aberta.
  const month = monthOf(today)
  const series = useMemo(() => monthlySeries(data, lastMonths(12, month)), [data, month])
  const totals = series.reduce((acc, p) => ({ income: acc.income + p.income, expense: acc.expense + p.expense, invested: acc.invested + p.invested }), { income: 0, expense: 0, invested: 0 })
  const rate = (income: number, expense: number) => (income > 0 && !hidden ? i18n.percent(((income - expense) / income) * 100, { digits: 0 }) : '—')
  return (
    <div className="space-y-4">
      <Card className="fx-rise p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[16.5px] font-semibold tracking-tight">{t('reports.presets.last12')}</h3>
          <Legend
            items={[
              { label: t('reports.income'), color: COLORS.income },
              { label: t('reports.expense'), color: COLORS.expense },
              { label: t('kinds.investments'), color: COLORS.invest },
            ]}
          />
        </div>
        <BarChart
          height={220}
          label={t('reports.months')}
          format={(v) => i18n.money(v)}
          series={[
            { key: 'income', label: t('reports.income'), color: COLORS.income },
            { key: 'expense', label: t('reports.expense'), color: COLORS.expense },
            { key: 'invested', label: t('kinds.investments'), color: COLORS.invest },
          ]}
          groups={series.map((p) => ({ key: p.month, label: i18n.monthShort(p.month), title: i18n.month(p.month), values: { income: p.income, expense: p.expense, invested: Math.max(0, p.invested) } }))}
        />
      </Card>
      <Card className="fx-rise overflow-x-auto" style={{ animationDelay: '60ms' }}>
        <table className="w-full min-w-[40rem] text-[14px]" aria-label={t('reports.presets.last12')}>
          <thead>
            <tr className="border-b border-sep/60 text-left text-[13px] text-label-2">
              <th scope="col" className="px-6 py-3.5 font-medium">{t('reports.month')}</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">{t('reports.income')}</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">{t('reports.expense')}</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">{t('reports.net')}</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">{t('reports.savingsRate')}</th>
              <th scope="col" className="px-6 py-3.5 text-right font-medium">{t('reports.invested')}</th>
            </tr>
          </thead>
          <tbody>
            {[...series].reverse().map((p) => {
              const net = p.income - p.expense
              return (
                <tr key={p.month} className="border-b border-sep/30 last:border-0 hover:bg-fill-2/50">
                  <th scope="row" className="px-6 py-3 text-left font-medium">{i18n.month(p.month)}</th>
                  <td className="px-3 py-3 text-right"><Amount cents={p.income} className="text-income" /></td>
                  <td className="px-3 py-3 text-right"><Amount cents={p.expense} /></td>
                  <td className="px-3 py-3 text-right"><Amount cents={net} className={net < 0 ? 'text-expense' : undefined} /></td>
                  <td className="tabular px-3 py-3 text-right text-label-2">{rate(p.income, p.expense)}</td>
                  <td className="px-6 py-3 text-right"><Amount cents={p.invested} className="text-invest" /></td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-sep/60 font-semibold">
              <th scope="row" className="px-6 py-3.5 text-left">{t('common.total')}</th>
              <td className="px-3 py-3 text-right"><Amount cents={totals.income} className="text-income" /></td>
              <td className="px-3 py-3 text-right"><Amount cents={totals.expense} /></td>
              <td className="px-3 py-3 text-right"><Amount cents={totals.income - totals.expense} className={totals.income - totals.expense < 0 ? 'text-expense' : undefined} /></td>
              <td className="tabular px-3 py-3 text-right text-label-2">{rate(totals.income, totals.expense)}</td>
              <td className="px-6 py-3.5 text-right"><Amount cents={totals.invested} className="text-invest" /></td>
            </tr>
          </tfoot>
        </table>
      </Card>
    </div>
  )
}
