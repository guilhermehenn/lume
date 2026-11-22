// Campos do investimento: tipo, instituição, data e os detalhes que o tipo pede (com o código
// sugerido da ficha Bens e Direitos do IRPF).

import { useMemo } from 'react'
import { LuInfo } from 'react-icons/lu'
import { INVESTMENT_TYPE_MAP, INVESTMENT_TYPES, irpfCode, positionKey, type InvestmentField } from '../../data/investments'
import { LIMITS, resolveAsset } from '../../data/model'
import { heldQuantity } from '../../data/selectors'
import type { CryptoClass, DataState, EarningKind, FundClass, Indexer, PensionPlan, TreasuryTitle } from '../../data/types'
import { useI18n } from '../../i18n'
import { CategoryIcon } from '../../ui/display'
import { Icon } from '../../ui/icons'
import { Autocomplete, CnpjField, DateField, DecimalField, MoneyField, Select, type SelectOption } from '../../ui/inputs'
import { Badge, Button, Group, Row, Segmented, Switch, TextField } from '../../ui/primitives'
import { computedTotal, type InvForm } from './investmentForm'
import { EntryDateRow } from './EntryDateRow'

export type Errors = Partial<Record<string, string>>

export function InvestmentFields({
  data,
  form,
  errors,
  set,
  banks,
  date,
  setDate,
  onUseComputed,
  amount,
  editingId,
}: {
  data: DataState
  form: InvForm
  errors: Errors
  set: <K extends keyof InvForm>(key: K, value: InvForm[K]) => void
  banks: SelectOption<string>[]
  date: string
  setDate: (value: string) => void
  onUseComputed: (value: number) => void
  amount: number
  /** Operação em edição: não conta na quantidade em carteira. */
  editingId?: string
}) {
  const i18n = useI18n()
  const { t } = i18n
  const meta = INVESTMENT_TYPE_MAP[form.type]
  const earning = form.operation === 'earning'
  const has = (field: InvestmentField) => meta.fields.includes(field) && !(earning && (field === 'quantity' || field === 'unitPrice' || field === 'fees'))

  const typeOptions = INVESTMENT_TYPES.map((x) => ({
    value: x.id,
    label: t(`investmentTypes.${x.id}`),
    hint: t(`tax.${x.tax}`),
    icon: <CategoryIcon icon={x.icon} color={x.color} size="sm" />,
  }))
  const assetSuggestions = useMemo(() => {
    const set = new Set<string>()
    for (const i of data.investments) if (i.type === form.type) set.add(i.asset)
    return [...set].sort()
  }, [data.investments, form.type])

  // Venda de ativo com quantidade: quanto havia em carteira na data (sem a própria operação).
  const held = useMemo(() => {
    if (form.operation !== 'redemption' || !meta.quantityBased || !form.bankId) return null
    const bank = data.banks.find((b) => b.id === form.bankId)
    const asset = resolveAsset({ ...form, asset: form.asset ?? '' }, bank?.name ?? '')
    if (!asset) return null
    return heldQuantity(data, positionKey({ type: form.type, asset, bankId: form.bankId }), date, editingId)
  }, [data, form, meta.quantityBased, date, editingId])
  const oversold = held !== null && form.quantity !== undefined && form.quantity > held
  const heldHint =
    held === null ? undefined : (
      <span className={oversold ? 'font-medium text-warn' : undefined}>
        {oversold ? t('form.heldExceeded', { quantity: i18n.number(held, 8) }) : t('form.held', { quantity: i18n.number(held, 8) })}
      </span>
    )

  const computed = computedTotal(form)
  const code = irpfCode(form)
  const cnpjLabel = form.type === 'pension' ? t('form.cnpjInsurer') : ['fund', 'fii', 'fiagro'].includes(form.type) ? t('form.cnpjFund') : t('form.cnpjIssuer')
  const quantityLabel = form.type === 'gold' ? t('form.quantityGrams') : form.type === 'fund' ? t('form.quantityShares') : t('form.quantity')
  const err = (field: string) => errors[field]

  return (
    <>
      <Group>
        <Row label={t('form.investmentType')} htmlFor="inv-type">
          <Select id="inv-type" label={t('form.investmentType')} value={form.type} options={typeOptions} placeholder={t('form.morePlaceholder')} onChange={(v) => set('type', v)} />
        </Row>
        <Row label={t('form.institution')} htmlFor="inv-bank" error={err('bankId')}>
          <Select id="inv-bank" label={t('form.institution')} value={form.bankId} options={banks} placeholder={t('form.morePlaceholder')} onChange={(v) => set('bankId', v)} />
        </Row>
        <EntryDateRow id="inv-date" value={date} onChange={setDate} error={err('date')} />
      </Group>

      {(meta.fields.length > 0 || earning) && (
        <Group title={t('form.details')}>
          {has('treasuryTitle') && (
            <Row label={t('form.treasuryTitle')} htmlFor="inv-treasury" error={err('treasuryTitle')}>
              <Select
                id="inv-treasury"
                label={t('form.treasuryTitle')}
                value={form.treasuryTitle}
                invalid={Boolean(err('treasuryTitle'))}
                options={(['selic', 'ipca', 'prefixed', 'renda', 'educa'] as TreasuryTitle[]).map((x) => ({ value: x, label: t(`treasuryTitles.${x}`) }))}
                placeholder={t('form.morePlaceholder')}
                onChange={(v) => set('treasuryTitle', v)}
              />
            </Row>
          )}
          {has('asset') && (
            <Row label={t(`form.assetLabels.${meta.assetLabel}`)} htmlFor="inv-asset" error={err('asset')}>
              <Autocomplete
                id="inv-asset"
                value={form.asset}
                onChange={(v) => set('asset', v)}
                suggestions={assetSuggestions}
                placeholder={t(`form.assetPlaceholders.${meta.assetLabel}`)}
                maxLength={LIMITS.asset}
                uppercase={meta.assetLabel === 'ticker' || meta.assetLabel === 'crypto'}
                invalid={Boolean(err('asset'))}
              />
            </Row>
          )}
          {has('issuer') && (
            <Row label={t('form.issuer')} htmlFor="inv-issuer">
              <TextField id="inv-issuer" value={form.issuer} maxLength={LIMITS.asset} placeholder={t('form.issuerPlaceholder')} onChange={(e) => set('issuer', e.target.value)} />
            </Row>
          )}
          {has('issuerCnpj') && (
            <Row label={cnpjLabel} htmlFor="inv-cnpj" error={err('issuerCnpj')}>
              <CnpjField id="inv-cnpj" value={form.issuerCnpj} invalid={Boolean(err('issuerCnpj'))} onChange={(v) => set('issuerCnpj', v)} />
            </Row>
          )}
          {has('indexer') && (
            <Row label={t('form.indexer')} htmlFor="inv-indexer">
              <Select
                id="inv-indexer"
                label={t('form.indexer')}
                value={form.indexer}
                options={(['cdi', 'ipca', 'prefixed', 'selic', 'other'] as Indexer[]).map((x) => ({ value: x, label: t(`indexers.${x}`) }))}
                placeholder={t('form.morePlaceholder')}
                onChange={(v) => set('indexer', v)}
              />
            </Row>
          )}
          {has('rate') && (
            <Row label={t('form.rate')} htmlFor="inv-rate">
              <TextField id="inv-rate" value={form.rate} maxLength={30} placeholder={t('form.ratePlaceholder')} onChange={(e) => set('rate', e.target.value)} />
            </Row>
          )}
          {has('maturity') && (
            <Row label={t('form.maturity')} htmlFor="inv-maturity" error={err('maturity')}>
              <DateField id="inv-maturity" value={form.maturity} onChange={(v) => set('maturity', v)} />
            </Row>
          )}
          {has('fundClass') && (
            <Row label={t('form.fundClass')} htmlFor="inv-fundclass">
              <Select
                id="inv-fundclass"
                label={t('form.fundClass')}
                value={form.fundClass}
                options={(['fixed', 'multi', 'equity'] as FundClass[]).map((x) => ({ value: x, label: t(`fundClasses.${x}`) }))}
                placeholder={t('form.morePlaceholder')}
                onChange={(v) => set('fundClass', v)}
              />
            </Row>
          )}
          {has('plan') && (
            <Row label={t('form.plan')}>
              <Segmented
                size="sm"
                className="w-40"
                label={t('form.plan')}
                value={form.plan ?? ('' as PensionPlan)}
                options={(['pgbl', 'vgbl'] as PensionPlan[]).map((x) => ({ value: x, label: t(`plans.${x}`) }))}
                onChange={(v) => set('plan', v)}
              />
            </Row>
          )}
          {has('cryptoClass') && (
            <Row label={t('form.cryptoClass')} htmlFor="inv-crypto">
              <Select
                id="inv-crypto"
                label={t('form.cryptoClass')}
                value={form.cryptoClass}
                options={(['bitcoin', 'altcoin', 'stablecoin'] as CryptoClass[]).map((x) => ({ value: x, label: t(`cryptoClasses.${x}`) }))}
                placeholder={t('form.morePlaceholder')}
                onChange={(v) => set('cryptoClass', v)}
              />
            </Row>
          )}
          {has('quantity') && (
            <Row label={quantityLabel} htmlFor="inv-qty" error={err('quantity')} hint={heldHint}>
              <DecimalField
                id="inv-qty"
                value={form.quantity}
                invalid={Boolean(err('quantity'))}
                onChange={(v) => set('quantity', v)}
                format={(v) => i18n.number(v, 8)}
              />
            </Row>
          )}
          {has('unitPrice') && (
            <Row label={t('form.unitPrice')} htmlFor="inv-price">
              <MoneyField id="inv-price" value={form.unitPrice} onChange={(v) => set('unitPrice', v)} format={(v) => i18n.money(v)} />
            </Row>
          )}
          {has('fees') && (
            <Row label={t('form.fees')} htmlFor="inv-fees" error={err('fees')}>
              <MoneyField id="inv-fees" value={form.fees} onChange={(v) => set('fees', v)} format={(v) => i18n.money(v)} />
            </Row>
          )}
          {has('dailyLiquidity') && (
            <Row label={t('form.dailyLiquidity')} htmlFor="inv-liquidity">
              <Switch id="inv-liquidity" label={t('form.dailyLiquidity')} checked={form.dailyLiquidity} onChange={(v) => set('dailyLiquidity', v)} />
            </Row>
          )}
          {has('incentivized') && (
            <Row label={t('form.incentivized')} htmlFor="inv-incentivized">
              <Switch id="inv-incentivized" label={t('form.incentivized')} checked={form.incentivized} onChange={(v) => set('incentivized', v)} />
            </Row>
          )}
          {has('fixedIncomeEtf') && (
            <Row label={t('form.fixedIncomeEtf')} htmlFor="inv-etf">
              <Switch id="inv-etf" label={t('form.fixedIncomeEtf')} checked={form.fixedIncomeEtf} onChange={(v) => set('fixedIncomeEtf', v)} />
            </Row>
          )}
          {earning && (
            <>
              <Row label={t('form.earningKind')} htmlFor="inv-earning">
                <Select
                  id="inv-earning"
                  label={t('form.earningKind')}
                  value={form.earningKind}
                  options={(['dividend', 'jcp', 'interest', 'fii_income', 'other'] as EarningKind[]).map((x) => ({ value: x, label: t(`earningKinds.${x}`) }))}
                  placeholder={t('form.morePlaceholder')}
                  onChange={(v) => set('earningKind', v)}
                />
              </Row>
              <Row label={t('form.taxWithheld')} htmlFor="inv-tax" error={err('taxWithheld')}>
                <MoneyField id="inv-tax" value={form.taxWithheld} onChange={(v) => set('taxWithheld', v)} format={(v) => i18n.money(v)} />
              </Row>
            </>
          )}
        </Group>
      )}

      {computed > 0 && computed !== amount && (
        <div className="fx-fade -mt-2 flex items-center justify-between gap-3 rounded-xl bg-fill-2 px-4 py-2.5 text-[13.5px]">
          <span className="tabular text-label-2">{t('form.computedTotal', { value: i18n.money(computed) })}</span>
          <Button size="sm" variant="tinted" onClick={() => onUseComputed(computed)}>
            {t('form.useComputed')}
          </Button>
        </div>
      )}

      <div className="flex items-start gap-3 rounded-xl bg-invest/[0.08] px-4 py-3 ring-1 ring-invest/20">
        <span className="mt-0.5 text-invest">
          <Icon name={meta.icon} className="size-4" />
        </span>
        <div className="min-w-0 flex-1 text-[13.5px]">
          <p className="font-semibold text-label">
            {code === null ? t('form.irpfNone') : t('form.irpf', { group: code.group, code: code.code })}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-label-2">
            <LuInfo className="size-3" aria-hidden />
            {t('form.irpfHint')}
          </p>
        </div>
        <Badge className="bg-invest/15 text-invest">{t(`tax.${meta.tax}`)}</Badge>
      </div>
    </>
  )
}
