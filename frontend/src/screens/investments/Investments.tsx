// Investimentos: carteira pelo custo de aquisição, distribuição por tipo e operações de cada ativo.
//
// A carteira vai até hoje (operação agendada só entra na data dela) e acompanha a virada do
// dia. Clicar num tipo do gráfico (ou da legenda) mostra só as posições daquele tipo.

import { useMemo, useState } from 'react'
import { LuChartNoAxesCombined, LuPlus, LuX } from 'react-icons/lu'
import { openEntry } from '../../app/entrySheet'
import { cn } from '../../lib/cn'
import { yearRange } from '../../lib/dates'
import { useToday } from '../../lib/useToday'
import { INVESTMENT_TYPE_MAP, positionKey } from '../../data/investments'
import { earningsByKind, investedByType, investmentPositions, isOpenPosition } from '../../data/selectors'
import { useData } from '../../data/store'
import type { InvestmentTypeId } from '../../data/types'
import { useI18n } from '../../i18n'
import { Amount, Donut, useHidden } from '../../ui/display'
import { Button, Card, CardHeader, EmptyState, PageHeader } from '../../ui/primitives'
import { useLookups } from '../EntryRow'
import { PositionRow } from './PositionRow'

export function Investments() {
  const data = useData()
  const i18n = useI18n()
  const { t } = i18n
  const hidden = useHidden()
  const lookups = useLookups(data)
  const { today } = useToday()
  const [showClosed, setShowClosed] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  /** Tipo sob o mouse ou o foco (destaque no gráfico). */
  const [hoverType, setHoverType] = useState<string | null>(null)
  /** Tipo escolhido com clique: filtra a carteira. */
  const [pickedType, setPickedType] = useState<InvestmentTypeId | null>(null)
  const year = Number(today.slice(0, 4))

  const positions = useMemo(() => investmentPositions(data, today), [data, today])
  const open = useMemo(() => positions.filter(isOpenPosition), [positions])
  const closed = useMemo(() => positions.filter((p) => !isOpenPosition(p)), [positions])
  const byType = useMemo(() => investedByType(positions), [positions])
  const totalCost = open.reduce((s, p) => s + p.cost, 0)
  const realized = positions.reduce((s, p) => s + p.realized, 0)
  const earningsYear = useMemo(() => {
    const { from } = yearRange(year)
    return [...earningsByKind(data, from, today).values()].reduce((a, b) => a + b, 0)
  }, [data, year, today])
  const futureCount = useMemo(() => data.investments.filter((i) => i.date > today).length, [data.investments, today])
  // Histórico só da posição aberta, da operação mais nova para a mais antiga. Refeito quando ela
  // ou o cofre mudam; passar o mouse no gráfico não refaz nada.
  const expandedOps = useMemo(
    () =>
      expanded === null
        ? []
        : data.investments
            .filter((inv) => positionKey(inv) === expanded)
            .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [data.investments, expanded],
  )

  const segments = byType.map((g) => ({
    key: g.key,
    value: g.total,
    color: INVESTMENT_TYPE_MAP[g.key as InvestmentTypeId].color,
    label: t(`investmentTypes.${g.key as InvestmentTypeId}`),
  }))
  const activeKey = hoverType ?? pickedType
  const active = segments.find((s) => s.key === activeKey)
  const centerValue = active ? active.value : totalCost
  const share = (value: number) => (totalCost > 0 ? i18n.percent((value / totalCost) * 100, { digits: 1 }) : '')
  const pick = (key: string) => setPickedType((current) => (current === key ? null : (key as InvestmentTypeId)))

  if (data.investments.length === 0) {
    return (
      <div>
        <PageHeader title={t('investments.title')} subtitle={t('investments.subtitle')} />
        <Card>
          <EmptyState
            icon={<LuChartNoAxesCombined />}
            title={t('investments.empty')}
            hint={t('investments.emptyHint')}
            action={
              <Button variant="primary" onClick={() => openEntry({ kind: 'investment' })}>
                <LuPlus className="size-4" aria-hidden />
                {t('investments.newOperation')}
              </Button>
            }
          />
        </Card>
      </div>
    )
  }

  const ofType = (list: typeof positions) => (pickedType ? list.filter((p) => p.type === pickedType) : list)
  const openShown = ofType(open)
  const closedShown = ofType(closed)
  const list = showClosed ? [...openShown, ...closedShown] : openShown

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('investments.title')}
        subtitle={t('investments.subtitle')}
        actions={
          <Button variant="primary" onClick={() => openEntry({ kind: 'investment' })}>
            <LuPlus className="size-4" aria-hidden />
            {t('investments.newOperation')}
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: t('investments.totalCost'), cents: totalCost, cls: 'text-invest' },
          { label: t('investments.earningsYear', { year }), cents: earningsYear, cls: 'text-income' },
          { label: t('investments.realized'), cents: realized, cls: realized < 0 ? 'text-expense' : undefined },
        ].map((s, i) => (
          <Card key={s.label} className="fx-rise p-5" style={{ animationDelay: `${40 + i * 40}ms` }}>
            <p className="text-[13px] font-medium text-label-2">{s.label}</p>
            <Amount cents={s.cents} animate className={cn('mt-1 block text-[24px] font-bold tracking-[-0.02em]', s.cls)} />
          </Card>
        ))}
      </div>

      {/* grid-cols-1: no celular, um nome longo na carteira não alarga a coluna além da tela. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="fx-rise p-6 lg:col-span-2" style={{ animationDelay: '120ms' }} aria-labelledby="inv-by-type">
          <h2 id="inv-by-type" className="text-[16.5px] font-semibold tracking-tight">
            {t('investments.byType')}
          </h2>
          {segments.length === 0 ? (
            <p className="mt-3 text-[14px] text-label-2">{t('investments.nothingOpen')}</p>
          ) : (
            <div className="mt-4 flex flex-col items-center gap-5">
              <Donut
                segments={segments}
                size={200}
                label={segments.map((s) => `${s.label}${hidden ? '' : ` ${share(s.value)}`}`).join(', ')}
                activeKey={activeKey}
                onActiveChange={setHoverType}
                center={
                  // Cabe no furo do gráfico: nome longo quebra em até três linhas estreitas; valor longo diminui.
                  <div className="flex w-[112px] flex-col items-center">
                    <p className="line-clamp-3 max-w-[100px] text-[11.5px] leading-tight text-label-2">{active ? active.label : t('common.total')}</p>
                    <Amount
                      cents={centerValue}
                      className={cn('font-semibold', i18n.money(centerValue).length > 13 ? 'text-[13.5px]' : 'text-[16.5px]')}
                    />
                    {active && !hidden && <p className="text-[12.5px] text-label-3">{share(active.value)}</p>}
                  </div>
                }
              />
              <ul className="w-full space-y-1">
                {segments.map((s) => (
                  <li key={s.key}>
                    {/* Botão: o tipo também é escolhido pelo teclado, e o clique filtra a carteira. */}
                    <button
                      type="button"
                      aria-pressed={pickedType === s.key}
                      onClick={() => pick(s.key)}
                      onPointerEnter={() => setHoverType(s.key)}
                      onPointerLeave={() => setHoverType(null)}
                      onFocus={() => setHoverType(s.key)}
                      onBlur={() => setHoverType(null)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[14px] transition-colors hover:bg-fill-2',
                        activeKey === s.key && 'bg-fill-2',
                        pickedType === s.key && 'ring-2 ring-accent/60',
                      )}
                    >
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{s.label}</span>
                      {!hidden && <span className="tabular text-[13px] text-label-3">{share(s.value)}</span>}
                      <Amount cents={s.value} className="w-28 text-right font-medium" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card className="fx-rise lg:col-span-3" style={{ animationDelay: '160ms' }}>
          <CardHeader
            title={t('investments.positions')}
            action={
              closedShown.length > 0 && (
                <button type="button" onClick={() => setShowClosed((v) => !v)} className="text-[13.5px] font-medium text-accent hover:underline">
                  {showClosed ? t('investments.hideClosed') : t('investments.showClosedCount', { count: closedShown.length })}
                </button>
              )
            }
          />
          {(pickedType || futureCount > 0) && (
            <div className="-mt-1 flex flex-wrap items-center gap-2 px-5 pb-2 text-[13px] text-label-2">
              {pickedType && (
                <button
                  type="button"
                  onClick={() => setPickedType(null)}
                  className="flex items-center gap-1 rounded-full bg-fill-2 py-0.5 pr-1.5 pl-2.5 font-medium text-label hover:bg-fill"
                  aria-label={t('investments.clearType', { type: t(`investmentTypes.${pickedType}`) })}
                >
                  {t(`investmentTypes.${pickedType}`)}
                  <LuX className="size-3.5" aria-hidden />
                </button>
              )}
              {futureCount > 0 && <span>{t('investments.futureOps', { count: futureCount })}</span>}
            </div>
          )}
          {list.length === 0 ? (
            <p className="px-5 pb-5 text-[14px] text-label-2">{t('investments.nothingOpen')}</p>
          ) : (
            <ul className="px-2 pb-2">
              {list.map((p, i) => (
                <PositionRow
                  key={p.key}
                  position={p}
                  index={i}
                  bankName={lookups.banks.get(p.bankId)?.name ?? '—'}
                  expanded={expanded === p.key}
                  onToggle={() => setExpanded(expanded === p.key ? null : p.key)}
                  operations={expanded === p.key ? expandedOps : []}
                  lookups={lookups}
                />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
