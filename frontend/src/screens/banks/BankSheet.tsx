// Folha de cadastro e edição de banco: nome (sem repetir outro), tipo, código COMPE, saldo
// inicial, principal e cor. Fechar com algo preenchido pergunta antes de descartar.

import { useMemo, useState, type FormEvent } from 'react'
import { LuTrash2 } from 'react-icons/lu'
import { PALETTE } from '../../data/catalog'
import { BANK_KINDS, DataError, LIMITS, type BankInput } from '../../data/model'
import { actions, useData } from '../../data/store'
import type { Bank } from '../../data/types'
import { useI18n } from '../../i18n'
import { BankAvatar } from '../../ui/display'
import { MoneyField, Select } from '../../ui/inputs'
import { ColorPicker } from '../../ui/pickers'
import { Button, Group, Row, Switch, TextField } from '../../ui/primitives'
import { ConfirmDialog, Sheet } from '../../ui/Sheet'
import { toast } from '../../ui/toast'

export function BankSheet({ bank, onClose, onDelete }: { bank?: Bank; onClose: () => void; onDelete: (bank: Bank) => void }) {
  const data = useData()
  const i18n = useI18n()
  const { t } = i18n
  const [open, setOpen] = useState(true)
  const [initial] = useState<BankInput>(() => ({
    name: bank?.name ?? '',
    code: bank?.code ?? '',
    kind: bank?.kind ?? 'checking',
    color: bank?.color ?? PALETTE[data.banks.length % PALETTE.length],
    initialBalance: bank?.initialBalance ?? 0,
    isPrimary: bank?.isPrimary ?? data.banks.length === 0,
  }))
  const [form, setForm] = useState<BankInput>(initial)
  const [error, setError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const nameField = useMemo(() => ({ get current() { return document.getElementById('bank-name') } }), [])
  const dirty = (Object.keys(initial) as (keyof BankInput)[]).some((k) => form[k] !== initial[k])
  const cash = form.kind === 'cash'

  const close = () => {
    setOpen(false)
    window.setTimeout(onClose, 280)
  }
  const requestClose = () => (dirty ? setConfirmDiscard(true) : close())
  const set = <K extends keyof BankInput>(key: K, value: BankInput[K]) => setForm((f) => ({ ...f, [key]: value }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    try {
      actions.saveBank({ ...form, id: bank?.id })
      toast(t('banks.saved'))
      close()
    } catch (err) {
      if (err instanceof DataError && err.code === 'duplicate') setError(t('banks.duplicate'))
      else if (err instanceof DataError && err.field === 'name') setError(t('form.errors.name'))
      else if (err instanceof DataError && err.code === 'limit') toast.error(t('banks.limit', { max: LIMITS.banks }))
      else toast.error(t('form.errors.generic'))
      if (err instanceof DataError && err.field === 'name') document.getElementById('bank-name')?.focus()
    }
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={requestClose}
        size="sm"
        title={bank ? t('banks.editTitle') : t('banks.newTitle')}
        closeLabel={t('common.close')}
        onSubmit={submit}
        initialFocus={bank ? undefined : nameField}
        footer={
          <>
            {bank && (
              <Button variant="ghost" className="text-expense" onClick={() => onDelete(bank)}>
                <LuTrash2 className="size-4" aria-hidden />
                {t('common.delete')}
              </Button>
            )}
            <span className="flex-1" />
            <Button onClick={requestClose}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary">
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="flex justify-center py-2" aria-hidden>
            <div className="fx-pop">
              <BankAvatar name={form.name || '?'} color={form.color} size="lg" />
            </div>
          </div>
          <Group>
            <Row label={t('common.name')} htmlFor="bank-name" error={error ?? undefined}>
              <TextField
                id="bank-name"
                value={form.name}
                maxLength={LIMITS.name}
                placeholder={t('banks.namePlaceholder')}
                aria-invalid={error ? true : undefined}
                onChange={(e) => {
                  set('name', e.target.value)
                  setError(null)
                }}
              />
            </Row>
            <Row label={t('banks.kind')} htmlFor="bank-kind">
              <Select
                id="bank-kind"
                label={t('banks.kind')}
                value={form.kind}
                options={BANK_KINDS.map((k) => ({ value: k, label: t(`bankKinds.${k}`) }))}
                placeholder={t('form.morePlaceholder')}
                onChange={(v) => set('kind', v)}
              />
            </Row>
            {/* Dinheiro em espécie não tem código de banco. */}
            {!cash && (
              <Row label={t('banks.code')} htmlFor="bank-code" hint={t('banks.codeHint')}>
                <TextField
                  id="bank-code"
                  inputMode="numeric"
                  value={form.code ?? ''}
                  maxLength={3}
                  placeholder="000"
                  onChange={(e) => set('code', e.target.value.replace(/\D/g, ''))}
                  onBlur={() => form.code && set('code', form.code.padStart(3, '0'))}
                  className="tabular"
                />
              </Row>
            )}
          </Group>
          <Group footer={t('banks.initialBalanceHint')}>
            <Row label={t('banks.initialBalance')} htmlFor="bank-initial">
              <MoneyField id="bank-initial" value={form.initialBalance} allowNegative onChange={(v) => set('initialBalance', v)} format={(v) => i18n.money(v)} />
            </Row>
          </Group>
          <Group footer={t('banks.primaryHint')}>
            <Row label={t('banks.primary')} htmlFor="bank-primary">
              <Switch id="bank-primary" label={t('banks.primary')} checked={form.isPrimary} onChange={(v) => set('isPrimary', v)} />
            </Row>
          </Group>
          <Group>
            <Row label={t('common.color')} stacked>
              <ColorPicker label={t('common.color')} value={form.color} onChange={(c) => set('color', c)} />
            </Row>
          </Group>
        </div>
      </Sheet>
      <ConfirmDialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setConfirmDiscard(false)
          close()
        }}
        title={bank ? t('form.discardEditTitle') : t('banks.discardNewTitle')}
        body={t('form.discardBody')}
        confirmLabel={t('form.discard')}
        cancelLabel={t('form.keepEditing')}
      />
    </>
  )
}
