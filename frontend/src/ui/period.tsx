// Escolha de mês e de período (relatórios).

import { LuChevronLeft, LuChevronRight } from 'react-icons/lu'
import { addMonths, currentMonth, type MonthKey } from '../lib/dates'
import { PERIOD_PRESETS, periodFor, type Period } from '../lib/period'
import { useI18n } from '../i18n'
import { DateField, Select } from './inputs'
import { IconButton } from './primitives'

export function MonthSwitcher({
  month,
  onChange,
  disabled,
  current = currentMonth(),
}: {
  month: MonthKey
  onChange: (month: MonthKey) => void
  disabled?: boolean
  /** Mês de hoje (quem acompanha a virada do dia passa o seu). */
  current?: MonthKey
}) {
  const i18n = useI18n()
  const isCurrent = month === current
  return (
    <div className={`flex items-center gap-1 rounded-[10px] bg-fill-2 p-0.5 transition-opacity ${disabled ? 'opacity-40' : ''}`}>
      <IconButton label={i18n.t('common.previousMonth')} onClick={() => onChange(addMonths(month, -1))} disabled={disabled} className="size-8 rounded-lg">
        <LuChevronLeft className="size-4" aria-hidden />
      </IconButton>
      <button
        type="button"
        disabled={disabled || isCurrent}
        onClick={() => onChange(current)}
        className="min-w-[9.5rem] px-1 text-center text-[15px] font-semibold tabular"
        aria-live="polite"
      >
        {i18n.month(month)}
      </button>
      <IconButton label={i18n.t('common.nextMonth')} onClick={() => onChange(addMonths(month, 1))} disabled={disabled} className="size-8 rounded-lg">
        <LuChevronRight className="size-4" aria-hidden />
      </IconButton>
    </div>
  )
}

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (period: Period) => void }) {
  const i18n = useI18n()
  const { t } = i18n
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex h-9 items-center rounded-[10px] bg-fill-2 pr-1 pl-3">
        <Select
          label={t('common.period')}
          value={value.preset}
          options={PERIOD_PRESETS.map((p) => ({ value: p, label: t(`reports.presets.${p}`) }))}
          placeholder={t('common.period')}
          onChange={(preset) => onChange(periodFor(preset, new Date(), value))}
          className="mr-0 font-medium"
        />
      </div>
      {value.preset === 'custom' ? (
        <div className="fx-fade flex h-9 items-center gap-1 rounded-[10px] bg-fill-2 px-2 text-[14px]">
          <span className="text-label-2">{t('common.from')}</span>
          {/* Datas digitadas fora de ordem não deixam o período vazio: a outra ponta acompanha. */}
          <DateField label={t('common.from')} value={value.from} max={value.to} onChange={(from) => from && onChange({ ...value, from, to: from > value.to ? from : value.to })} />
          <span className="text-label-2">{t('common.to')}</span>
          <DateField label={t('common.to')} value={value.to} min={value.from} onChange={(to) => to && onChange({ ...value, to, from: to < value.from ? to : value.from })} />
        </div>
      ) : (
        // As datas do período escolhido, para não haver dúvida (e para sair na impressão).
        <span className="tabular text-[13px] text-label-2">{t('reports.range', { from: i18n.date(value.from, 'short'), to: i18n.date(value.to, 'short') })}</span>
      )}
    </div>
  )
}
