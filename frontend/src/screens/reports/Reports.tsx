// Relatórios: visão geral, por categoria, evolução, investimentos (posição em 31/12) e
// personalizado. O período, o ano e os filtros do personalizado ficam guardados enquanto a pessoa
// troca de aba; a aba fica no endereço.

import { useState } from 'react'
import { LuPrinter } from 'react-icons/lu'
import { replaceQuery, useRoute } from '../../app/router'
import { periodFor, type Period } from '../../lib/period'
import { useToday } from '../../lib/useToday'
import { availableYears, defaultTaxYear } from '../../data/exporters'
import { useData } from '../../data/store'
import type { Kind } from '../../data/types'
import { useI18n } from '../../i18n'
import { Select } from '../../ui/inputs'
import { Button, PageHeader, Segmented } from '../../ui/primitives'
import { ByCategory } from './ByCategory'
import { Custom, emptyCustom, type CustomState } from './Custom'
import { Evolution } from './Evolution'
import { InvestmentsReport } from './InvestmentsReport'
import { Overview } from './Overview'

type Tab = 'overview' | 'byCategory' | 'evolution' | 'investments' | 'custom'
const TABS: Tab[] = ['overview', 'byCategory', 'evolution', 'investments', 'custom']

export function Reports() {
  const data = useData()
  const i18n = useI18n()
  const { t } = i18n
  const route = useRoute()
  const { today } = useToday()
  const tabParam = route.query.get('tab') as Tab | null
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'overview'
  const setTab = (next: Tab) => replaceQuery({ tab: next === 'overview' ? undefined : next })
  const [period, setPeriod] = useState<Period>(() => periodFor('thisMonth'))
  const [custom, setCustom] = useState<CustomState>(emptyCustom)
  const [year, setYear] = useState(() => defaultTaxYear(availableYears(data), today))

  // "Por categoria" → personalizado com a categoria e o período, por quem pagou/recebeu.
  const drill = (categoryId: string, kind: Kind) => {
    setCustom({ ...emptyCustom(), kinds: [kind], categoryIds: [categoryId], groupBy: 'counterparty' })
    setTab('custom')
  }

  const tabOptions = TABS.map((x) => ({ value: x, label: t(`reports.tabs.${x}`) }))
  // O que sai no topo da impressão: a aba, o período (ou o ano) e quando foi gerado.
  const scope =
    tab === 'investments'
      ? t('reports.yearScope', { year })
      : tab === 'evolution'
        ? t('reports.presets.last12')
        : t('reports.range', { from: i18n.date(period.from, 'short'), to: i18n.date(period.to, 'short') })

  return (
    <div>
      <PageHeader
        title={t('reports.title')}
        actions={
          <Button onClick={() => window.print()}>
            <LuPrinter className="size-4" aria-hidden />
            {t('reports.print')}
          </Button>
        }
      />
      {/* No celular, as cinco abas não cabem lado a lado: vira uma lista de escolha. */}
      <div className="fx-rise mb-5 sm:hidden" style={{ animationDelay: '40ms' }}>
        <div className="flex h-10 items-center justify-between gap-2 rounded-[11px] bg-fill-2 pr-1 pl-3 text-[14px]">
          <span className="text-label-2">{t('reports.tabLabel')}</span>
          <Select id="reports-tab" label={t('reports.tabLabel')} value={tab} options={tabOptions} placeholder="" onChange={setTab} className="font-semibold" />
        </div>
      </div>
      <div className="fx-rise mb-5 max-sm:hidden" style={{ animationDelay: '40ms' }}>
        <Segmented label={t('reports.title')} value={tab} onChange={setTab} options={tabOptions} />
      </div>
      <div key={tab} className="print-area fx-fade">
        <div className="mb-4 hidden print:block">
          <h2 className="text-xl font-bold">
            Lume · {t(`reports.tabs.${tab}`)} · {scope}
          </h2>
          <p className="text-[12px]">{t('reports.generatedAt', { date: i18n.date(today, 'medium') })}</p>
        </div>
        {tab === 'overview' && <Overview period={period} setPeriod={setPeriod} today={today} />}
        {tab === 'byCategory' && <ByCategory period={period} setPeriod={setPeriod} onDrill={drill} />}
        {tab === 'evolution' && <Evolution today={today} />}
        {tab === 'investments' && <InvestmentsReport year={year} setYear={setYear} />}
        {tab === 'custom' && <Custom period={period} setPeriod={setPeriod} state={custom} setState={setCustom} />}
      </div>
    </div>
  )
}
