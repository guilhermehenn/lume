// Campos de despesa e receita: quem pagou ou recebeu, categoria, banco, data e forma de pagamento.

import { LIMITS } from '../../data/model'
import type { Kind, PaymentMethod } from '../../data/types'
import { PAYMENT_METHODS } from '../../data/types'
import { useI18n } from '../../i18n'
import { Autocomplete, Select, type SelectOption } from '../../ui/inputs'
import { ChoiceChips, Group, Row } from '../../ui/primitives'
import { EntryDateRow } from './EntryDateRow'
import type { Errors } from './InvestmentFields'

export interface TxForm {
  counterparty: string
  categoryId?: string
  bankId: string
  date: string
  paymentMethod?: PaymentMethod
}

export function TransactionFields({
  kind,
  form,
  errors,
  set,
  onCounterparty,
  suggestions,
  banks,
  categories,
}: {
  kind: Kind
  form: TxForm
  errors: Errors
  set: <K extends keyof TxForm>(key: K, value: TxForm[K]) => void
  /** Digitar ou escolher um nome conhecido preenche categoria e forma de pagamento. */
  onCounterparty: (value: string) => void
  suggestions: string[]
  banks: SelectOption<string>[]
  categories: SelectOption<string>[]
}) {
  const { t } = useI18n()
  const income = kind === 'income'
  return (
    <Group>
      <Row label={income ? t('form.receivedFrom') : t('form.paidTo')} htmlFor="entry-counterparty" error={errors.counterparty}>
        <Autocomplete
          id="entry-counterparty"
          value={form.counterparty}
          maxLength={LIMITS.counterparty}
          invalid={Boolean(errors.counterparty)}
          placeholder={income ? t('form.receivedFromPlaceholder') : t('form.paidToPlaceholder')}
          suggestions={suggestions}
          onChange={onCounterparty}
        />
      </Row>
      <Row label={t('form.category')} htmlFor="entry-category" error={errors.categoryId}>
        <Select
          id="entry-category"
          label={t('form.category')}
          value={form.categoryId}
          options={categories}
          placeholder={t('form.morePlaceholder')}
          invalid={Boolean(errors.categoryId)}
          onChange={(v) => set('categoryId', v)}
        />
      </Row>
      <Row label={income ? t('form.toBank') : t('form.fromBank')} htmlFor="entry-bank" error={errors.bankId}>
        <Select
          id="entry-bank"
          label={t('common.bank')}
          value={form.bankId || undefined}
          options={banks}
          placeholder={t('form.morePlaceholder')}
          invalid={Boolean(errors.bankId)}
          onChange={(v) => set('bankId', v)}
        />
      </Row>
      <EntryDateRow id="entry-date" value={form.date} onChange={(v) => set('date', v)} error={errors.date} />
      {!income && (
        <Row label={t('form.paymentMethod')} stacked>
          <ChoiceChips
            label={t('form.paymentMethod')}
            value={form.paymentMethod}
            onChange={(v) => set('paymentMethod', v)}
            options={PAYMENT_METHODS.map((pm) => ({ value: pm, label: t(`paymentMethods.${pm}`) }))}
          />
        </Row>
      )}
    </Group>
  )
}
