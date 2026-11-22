// Uma posição da carteira: ativo, custo (ou resultado, se encerrada) e, aberta, os números do
// ativo, os atalhos de nova operação já preenchidos e o histórico de operações.

import { useId } from 'react'
import { LuChevronDown, LuMinus, LuPlus, LuTrendingUp } from 'react-icons/lu'
import { openEntry } from '../../app/entrySheet'
import { cn } from '../../lib/cn'
import { formatIrpf, INVESTMENT_TYPE_MAP, irpfCode } from '../../data/investments'
import { isOpenPosition, type Position } from '../../data/selectors'
import type { Investment, InvestmentOperation } from '../../data/types'
import { useI18n } from '../../i18n'
import { Amount, CategoryIcon } from '../../ui/display'
import { Badge, Button } from '../../ui/primitives'
import { EntryRow, type Lookups } from '../EntryRow'

/** Campos que descrevem o ativo: a nova operação nasce com eles preenchidos. */
const ASSET_FIELDS = [
  'type',
  'bankId',
  'asset',
  'issuer',
  'issuerCnpj',
  'indexer',
  'rate',
  'maturity',
  'dailyLiquidity',
  'incentivized',
  'fixedIncomeEtf',
  'fundClass',
  'plan',
  'cryptoClass',
  'treasuryTitle',
] as const satisfies readonly (keyof Investment)[]

export function presetFrom(last: Investment, operation: InvestmentOperation) {
  const preset: Partial<Pick<Investment, (typeof ASSET_FIELDS)[number]>> & { operation: InvestmentOperation } = { operation }
  for (const field of ASSET_FIELDS) (preset as Record<string, unknown>)[field] = last[field]
  return preset
}

export function PositionRow({
  position: p,
  index,
  bankName,
  expanded,
  onToggle,
  operations,
  lookups,
}: {
  position: Position
  /** Posição na lista, só para escalonar a animação de entrada. */
  index: number
  bankName: string
  expanded: boolean
  onToggle: () => void
  operations: Investment[]
  lookups: Lookups
}) {
  const i18n = useI18n()
  const { t } = i18n
  const meta = INVESTMENT_TYPE_MAP[p.type]
  const isOpen = isOpenPosition(p)
  const code = irpfCode(p.last)
  const panelId = useId()
  const codeLabel = code ? t('investments.irpfBadge', { group: code.group, code: code.code }) : t('form.irpfNone')
  return (
    <li className={cn('fx-rise rounded-xl transition-colors', expanded && 'bg-fill-2/60')} style={{ animationDelay: `${180 + Math.min(index, 10) * 25}ms` }}>
      <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={panelId} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-fill-2">
        <CategoryIcon icon={meta.icon} color={meta.color} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={cn('truncate text-[15px] font-medium', !isOpen && 'text-label-2')}>{p.asset}</span>
            <Badge title={codeLabel} aria-label={codeLabel}>
              {formatIrpf(code)}
            </Badge>
            {!isOpen && <Badge>{t('investments.closedBadge')}</Badge>}
          </span>
          <span className="block truncate text-[13px] text-label-2">
            {t(`investmentTypes.${p.type}`)} · {bankName}
            {p.last.maturity && <> · {t('investments.maturity', { date: i18n.date(p.last.maturity, 'short') })}</>}
          </span>
        </span>
        <span className="shrink-0 text-right">
          {isOpen ? (
            <>
              <Amount cents={p.cost} className="block text-[15px] font-semibold" />
              {p.quantity > 0 && (
                <span className="tabular block text-[12.5px] text-label-2">
                  {i18n.number(p.quantity, 8)}
                  {p.averagePrice !== null && (
                    <>
                      {' × '}
                      <Amount cents={p.averagePrice} />
                    </>
                  )}
                </span>
              )}
            </>
          ) : (
            // Encerrada: o custo é zero; o que interessa é quanto ganhou ou perdeu.
            <>
              <Amount cents={p.realized} sign="always" className={cn('block text-[15px] font-semibold', p.realized < 0 ? 'text-expense' : 'text-income')} />
              <span className="block text-[12.5px] text-label-2">{t('investments.result')}</span>
            </>
          )}
        </span>
        <LuChevronDown className={cn('size-4 shrink-0 text-label-3 transition-transform duration-300 ease-apple', expanded && 'rotate-180')} aria-hidden />
      </button>
      {expanded && (
        <div id={panelId} className="fx-fade px-3 pb-3">
          <div className="mb-2 grid grid-cols-3 gap-2 text-[13px]">
            <Mini label={t('investments.earnings')} cents={p.earnings} />
            <Mini label={t('investments.realized')} cents={p.realized} />
            <Mini label={t('reports.taxWithheld')} cents={p.taxWithheld} />
          </div>
          <div className="mb-2 flex flex-wrap gap-2">
            <Button size="sm" variant="tinted" onClick={() => openEntry({ kind: 'investment', preset: presetFrom(p.last, 'contribution') })}>
              <LuPlus className="size-3.5" aria-hidden />
              {t('operations.contribution')}
            </Button>
            {isOpen && (
              <Button size="sm" variant="tinted" onClick={() => openEntry({ kind: 'investment', preset: presetFrom(p.last, 'redemption') })}>
                <LuMinus className="size-3.5" aria-hidden />
                {t('operations.redemption')}
              </Button>
            )}
            <Button size="sm" variant="tinted" onClick={() => openEntry({ kind: 'investment', preset: presetFrom(p.last, 'earning') })}>
              <LuTrendingUp className="size-3.5" aria-hidden />
              {t('operations.earning')}
            </Button>
          </div>
          <div className="rounded-xl bg-surface/70">
            {operations.map((inv, i) => (
              <EntryRow
                key={inv.id}
                index={i}
                showDate
                lookups={lookups}
                entry={{ entryKind: 'investment', id: inv.id, date: inv.date, amount: inv.amount, createdAt: inv.createdAt, inv }}
              />
            ))}
          </div>
        </div>
      )}
    </li>
  )
}

function Mini({ label, cents }: { label: string; cents: number }) {
  return (
    // Rótulo que quebra de linha não desalinha os valores: eles ficam todos no pé do quadro.
    <div className="flex flex-col justify-between gap-0.5 rounded-lg bg-surface/70 px-2.5 py-1.5">
      <p className="leading-snug text-label-2">{label}</p>
      <Amount cents={cents} className="font-semibold" />
    </div>
  )
}
