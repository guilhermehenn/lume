// Visão geral do período: receitas, despesas, saldo, taxa de poupança, investido, mês a mês e
// onde o dinheiro foi.

import { useMemo } from 'react'
import { lastMonths, monthOf, type ISODate } from '../../lib/dates'
import { monthsBetween, type Period } from '../../lib/period'
import { categoryTotals, monthlySeries, periodSummary } from '../../data/selectors'
import { useData } from '../../data/store'
import { useI18n } from '../../i18n'
import { Amount, BarChart, Legend, useHidden } from '../../ui/display'
import { Card, CardHeader } from '../../ui/primitives'
import { PeriodPicker } from '../../ui/period'
import { CategoryBars, COLORS, Kpi } from './parts'

/** Quantos meses do gráfico cabem: mais que isso, só os mais recentes. */
const CHART_MAX = 36

export function Overview({ period, setPeriod, today }: { period: Period; setPeriod: (p: Period) => void; today: ISODate }) {
  const data = useData()
  const i18n = useI18n()
  const { t } = i18n
  const hidden = useHidden()
  const summary = useMemo(() => periodSummary(data, period.from, period.to), [data, period])
  const top = useMemo(() => categoryTotals(data, 'expense', period.from, period.to).slice(0, 5), [data, period])

  const periodMonths = monthsBetween(period.from, period.to)
  // Um mês só não faz gráfico mês a mês: mostra os 6 meses até ele, e o título diz isso.
  const single = periodMonths.length < 2
  const chartMonths = single ? lastMonths(6, periodMonths[0]) : periodMonths.slice(-CHART_MAX)
  const chartKey = chartMonths.join()
  const series = useMemo(() => monthlySeries(data, chartKey.split(',')), [data, chartKey])
  const chartTitle = single || periodMonths.length > CHART_MAX ? t('reports.lastMonthsCount', { count: chartMonths.length }) : t('reports.months')
  // Média por mês só faz sentido com 2 meses ou mais, e conta só os meses que já começaram.
  const thisMonth = monthOf(today)
  const elapsed = periodMonths.filter((m) => m <= thisMonth).length
  const showAverages = !single && elapsed > 0
  const net = summary.contributions - summary.redemptions

  return (
    <div className="space-y-4">
      <PeriodPicker value={period} onChange={setPeriod} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label={t('reports.income')} delay={20}>
          <Amount cents={summary.income} animate className="text-income" />
        </Kpi>
        <Kpi label={t('reports.expense')} delay={50}>
          <Amount cents={summary.expense} animate />
        </Kpi>
        <Kpi label={t('reports.balance')} delay={80}>
          <Amount cents={summary.balance} animate sign="auto" className={summary.balance < 0 ? 'text-expense' : undefined} />
        </Kpi>
        <Kpi label={t('reports.savingsRate')} delay={110}>
          <span className="tabular">{summary.savingsRate === null || hidden ? '—' : i18n.percent(summary.savingsRate, { digits: 1 })}</span>
        </Kpi>
        <Kpi label={t('reports.invested')} delay={140}>
          <Amount cents={net} animate className="text-invest" />
        </Kpi>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="fx-rise p-6 lg:col-span-3" style={{ animationDelay: '160ms' }}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[16.5px] font-semibold tracking-tight">{chartTitle}</h3>
            <Legend
              items={[
                { label: t('reports.income'), color: COLORS.income },
                { label: t('reports.expense'), color: COLORS.expense },
              ]}
            />
          </div>
          <BarChart
            label={chartTitle}
            format={(v) => i18n.money(v)}
            series={[
              { key: 'income', label: t('reports.income'), color: COLORS.income },
              { key: 'expense', label: t('reports.expense'), color: COLORS.expense },
            ]}
            groups={series.map((p) => ({ key: p.month, label: i18n.monthShort(p.month), title: i18n.month(p.month), values: { income: p.income, expense: p.expense } }))}
          />
          {showAverages && (
            <div className="mt-5 grid grid-cols-2 gap-3 border-t border-sep/50 pt-4 text-[13.5px]">
              <div>
                <p className="text-label-2">{t('reports.avgIncome')}</p>
                <Amount cents={Math.round(summary.income / elapsed)} className="text-[16.5px] font-semibold" />
              </div>
              <div>
                <p className="text-label-2">{t('reports.avgExpense')}</p>
                <Amount cents={Math.round(summary.expense / elapsed)} className="text-[16.5px] font-semibold" />
              </div>
            </div>
          )}
        </Card>
        <Card className="fx-rise lg:col-span-2" style={{ animationDelay: '200ms' }}>
          <CardHeader title={t('reports.topExpenses')} />
          <CategoryBars kind="expense" groups={top} total={summary.expense} />
        </Card>
      </div>
    </div>
  )
}
