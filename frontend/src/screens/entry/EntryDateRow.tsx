// Data do lançamento com atalhos "Hoje" e "Ontem" e aviso de data no futuro.

import { addDays, todayISO } from '../../lib/dates'
import { cn } from '../../lib/cn'
import { useI18n } from '../../i18n'
import { DateField } from '../../ui/inputs'
import { Row } from '../../ui/primitives'

export function EntryDateRow({ id, value, onChange, error }: { id: string; value: string; onChange: (value: string) => void; error?: string }) {
  const { t } = useI18n()
  const today = todayISO()
  const yesterday = addDays(today, -1)
  const chip = (target: string, label: string) => (
    <button
      type="button"
      onClick={() => onChange(target)}
      aria-pressed={value === target}
      className={cn(
        'h-7 rounded-full px-2.5 text-[13px] font-medium transition-colors',
        value === target ? 'bg-accent/15 text-accent' : 'text-label-2 hover:bg-fill-2 hover:text-label',
      )}
    >
      {label}
    </button>
  )
  return (
    <Row label={t('common.date')} htmlFor={id} error={error} hint={value > today ? <span className="text-warn">{t('form.futureDate')}</span> : undefined}>
      <div className="flex items-center gap-1">
        {chip(today, t('form.today'))}
        {chip(yesterday, t('form.yesterday'))}
        <DateField id={id} value={value} onChange={onChange} invalid={Boolean(error)} />
      </div>
    </Row>
  )
}
