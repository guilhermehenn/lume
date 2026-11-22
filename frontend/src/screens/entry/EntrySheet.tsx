// Folha de lançamento: despesa, receita ou investimento (novo ou edição).
//
// Regras que valem para os três tipos:
// - um envio por vez: Enter repetido, clique duplo ou Ctrl/⌘ + Enter durante a animação de saída
//   não criam o mesmo lançamento duas vezes;
// - fechar com algo preenchido pede confirmação;
// - todo salvamento oferece "Desfazer" (novo: exclui; edição: volta os valores de antes);
// - "Salvar e criar outro" mantém tipo, banco e data e limpa o resto.

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { LuTrash2 } from 'react-icons/lu'
import { closeEntry, isEntryOpen, useEntrySheet, type EntryKind, type EntryRequest } from '../../app/entrySheet'
import { navigate } from '../../app/router'
import { cn } from '../../lib/cn'
import { todayISO } from '../../lib/dates'
import { DataError, LIMITS, primaryBank } from '../../data/model'
import { counterpartyMemory } from '../../data/selectors'
import { actions, undo, useData } from '../../data/store'
import type { DataState, Investment, Kind, Transaction } from '../../data/types'
import { INVESTMENT_OPERATIONS } from '../../data/types'
import { useI18n } from '../../i18n'
import { AmountInput } from '../../ui/inputs'
import { Button, Group, Row, Segmented } from '../../ui/primitives'
import { ConfirmDialog, Sheet } from '../../ui/Sheet'
import { toast } from '../../ui/toast'
import { InvestmentFields, type Errors } from './InvestmentFields'
import { computedTotal, initialInvestment, TOTAL_FIELDS, toInvestmentInput, type InvForm } from './investmentForm'
import { bankOptions, categoryOptions } from './options'
import { TransactionFields, type TxForm } from './TransactionFields'

type Mode = 'close' | 'new'

interface FormState {
  kind: EntryKind
  amount: number
  note: string
  tx: TxForm
  inv: InvForm
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)
const SAVE_KEYS = IS_MAC ? '⌘ + Enter' : 'Ctrl + Enter'
const SAVE_NEW_KEYS = IS_MAC ? '⇧⌘ + Enter' : 'Ctrl + Shift + Enter'
/** Depois de "Salvar e criar outro", ignora envios por um instante (clique duplo, Enter segurado). */
const SAVE_NEW_COOLDOWN_MS = 400

function initialForm(data: DataState, request: EntryRequest, tx?: Transaction, inv?: Investment): FormState {
  const invForm = initialInvestment(data, inv, request.preset)
  const presetAmount = request.preset?.amount ?? 0
  return {
    kind: tx?.kind ?? request.kind,
    amount: tx?.amount ?? inv?.amount ?? (computedTotal(invForm) || presetAmount),
    note: tx?.note ?? inv?.note ?? '',
    tx: {
      counterparty: tx?.counterparty ?? '',
      categoryId: tx?.categoryId,
      bankId: tx?.bankId ?? primaryBank(data)?.id ?? data.banks[0]?.id ?? '',
      date: tx?.date ?? inv?.date ?? todayISO(),
      paymentMethod: tx?.paymentMethod,
    },
    inv: invForm,
  }
}

const same = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Tem algo preenchido? Só conta o que a pessoa vê no tipo escolhido: trocar de Despesa para
 * Investimento num formulário vazio não pede confirmação ao fechar. Na edição, trocar o tipo conta.
 */
function isDirty(form: FormState, base: FormState, editing: boolean): boolean {
  if (form.amount !== base.amount || form.note !== base.note || form.tx.date !== base.tx.date) return true
  if (editing && form.kind !== base.kind) return true
  return form.kind === 'investment' ? !same(form.inv, base.inv) : !same(form.tx, base.tx)
}

export function EntrySheet() {
  const sheet = useEntrySheet()
  if (!sheet.request) return null
  return <EntryForm key={sheet.seq} request={sheet.request} open={sheet.open} />
}

function EntryForm({ request, open }: { request: EntryRequest; open: boolean }) {
  const data = useData()
  const i18n = useI18n()
  const { t } = i18n

  const editingTx = request.id && request.kind !== 'investment' ? data.transactions.find((x) => x.id === request.id) : undefined
  const editingInv = request.id && request.kind === 'investment' ? data.investments.find((x) => x.id === request.id) : undefined
  const editing = Boolean(request.id)
  const missing = editing && !editingTx && !editingInv

  const [form, setForm] = useState<FormState>(() => initialForm(data, request, editingTx, editingInv))
  /** Como a folha abriu (ou ficou depois de "criar outro"): base para saber se há algo a perder. */
  const [baseline, setBaseline] = useState(form)
  const [amountTouched, setAmountTouched] = useState(editing)
  const [errors, setErrors] = useState<Errors>({})
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  /** Muda a cada "Salvar e criar outro": os campos remontam limpos (a busca do "Pago a" guarda texto próprio). */
  const [round, setRound] = useState(0)
  /** Até quando novos envios são ignorados (Infinity: a folha já está fechando). */
  const lockUntil = useRef(0)
  /** Campos que a pessoa escolheu à mão: o preenchimento automático não mexe neles. */
  const manual = useRef({ category: editing, payment: editing })
  const bodyRef = useRef<HTMLDivElement>(null)
  /** O campo do valor muda de elemento a cada "criar outro"; a busca pelo id acha sempre o atual. */
  const amountField = useMemo(() => ({ get current() { return document.getElementById('entry-amount') } }), [])

  const { kind, amount, note, tx, inv } = form
  const txKind: Kind = kind === 'income' ? 'income' : 'expense'
  const banks = useMemo(() => bankOptions(data), [data])
  const categories = useMemo(() => categoryOptions(data, txKind, i18n), [data, txKind, i18n])
  const memory = useMemo(() => counterpartyMemory(data, txKind), [data, txKind])
  const dirty = isDirty(form, baseline, editing)
  const blocked = !editing && (data.banks.length === 0 ? 'bank' : kind !== 'investment' && categories.length === 0 ? 'category' : null)

  // Excluído em outra aba (ou nunca existiu): avisa e fecha.
  useEffect(() => {
    if (!missing || !open || lockUntil.current === Infinity) return
    lockUntil.current = Infinity
    toast.error(t('errors.notFound'))
    closeEntry()
  }, [missing, open, t])

  const finish = () => {
    lockUntil.current = Infinity
    closeEntry()
  }

  const requestClose = () => {
    if (lockUntil.current === Infinity) return
    if (dirty) setConfirmDiscard(true)
    else finish()
  }

  const clearError = (...fields: string[]) =>
    setErrors((e) => (fields.some((f) => e[f]) ? { ...e, ...Object.fromEntries(fields.map((f) => [f, undefined])) } : e))

  const focusAmount = () => requestAnimationFrame(() => document.getElementById('entry-amount')?.focus())

  const focusFirstInvalid = () =>
    requestAnimationFrame(() => {
      const row = bodyRef.current?.querySelector('[data-invalid]')
      const target = row?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea') ?? row?.querySelector<HTMLElement>('button')
      target?.focus()
    })

  // Receita ↔ despesa: a categoria do outro tipo não serve e sai (o investimento não usa categoria).
  const changeKind = (next: EntryKind) => {
    const category = data.categories.find((c) => c.id === tx.categoryId)
    const clear = next !== 'investment' && category !== undefined && category.kind !== next
    setForm((prev) => ({ ...prev, kind: next, tx: clear ? { ...prev.tx, categoryId: undefined } : prev.tx }))
    if (clear) manual.current.category = false
    setErrors({})
    // Na hora (não no próximo quadro): quem clica no tipo e já digita o valor não perde nada.
    if (amount === 0) document.getElementById('entry-amount')?.focus()
  }

  const setAmount = (value: number) => {
    setForm((prev) => ({ ...prev, amount: value }))
    setAmountTouched(true)
    clearError('amount')
  }

  const setTxField = <K extends keyof TxForm>(key: K, value: TxForm[K]) => {
    if (key === 'categoryId') manual.current.category = true
    if (key === 'paymentMethod') manual.current.payment = true
    setForm((prev) => ({ ...prev, tx: { ...prev.tx, [key]: value } }))
    clearError(key)
  }

  // Nome conhecido: traz a categoria e a forma de pagamento do último lançamento com ele,
  // sem passar por cima do que a pessoa escolheu.
  const onCounterparty = (value: string) => {
    const recall = memory.recall(value)
    setForm((prev) => {
      const next = { ...prev.tx, counterparty: value }
      if (recall && !manual.current.category) next.categoryId = recall.categoryId
      if (recall && !manual.current.payment && txKind === 'expense') next.paymentMethod = recall.paymentMethod
      return { ...prev, tx: next }
    })
    clearError('counterparty', ...(recall && !manual.current.category ? ['categoryId'] : []))
  }

  // Quantidade × preço preenche o valor sozinho até a pessoa digitar o valor à mão.
  const setInvField = <K extends keyof InvForm>(key: K, value: InvForm[K]) => {
    setForm((prev) => {
      const nextInv = { ...prev.inv, [key]: value }
      const total = !amountTouched && TOTAL_FIELDS.includes(key) ? computedTotal(nextInv) : 0
      return { ...prev, inv: nextInv, amount: total > 0 ? total : prev.amount }
    })
    clearError(key)
  }

  const errorText = (field: string) => {
    const key = `form.errors.${field}`
    const text = i18n.tx(key)
    return text === key ? t('form.errors.generic') : text
  }

  const validate = (): Errors => {
    const found: Errors = {}
    if (amount <= 0) found.amount = errorText('amount')
    if (kind === 'investment') {
      if (!inv.bankId) found.bankId = errorText('bankId')
    } else {
      if (!tx.counterparty.trim()) found.counterparty = errorText('counterparty')
      if (!tx.categoryId) found.categoryId = errorText('categoryId')
      if (!tx.bankId) found.bankId = errorText('bankId')
    }
    return found
  }

  /** Grava e devolve como desfazer: novo some; edição volta ao que era. */
  const save = (): { message: string; revert: () => void } => {
    if (kind === 'investment') {
      const saved = actions.saveInvestment({ id: editingInv?.id, ...toInvestmentInput(inv, { amount, date: tx.date, note }) })
      const before = editingInv
      return {
        message: editing ? t('transactions.updated') : t('transactions.savedInvestment'),
        revert: before ? () => actions.saveInvestment(before) : () => actions.deleteInvestment(saved.id),
      }
    }
    const saved = actions.saveTransaction({
      id: editingTx?.id,
      kind: txKind,
      amount,
      date: tx.date,
      bankId: tx.bankId,
      categoryId: tx.categoryId!,
      counterparty: tx.counterparty,
      paymentMethod: txKind === 'expense' ? tx.paymentMethod : undefined,
      note,
    })
    const before = editingTx
    return {
      message: editing ? t('transactions.updated') : txKind === 'income' ? t('transactions.savedIncome') : t('transactions.savedExpense'),
      revert: before ? () => actions.saveTransaction(before) : () => actions.deleteTransaction(saved.id),
    }
  }

  const revert = (fn: () => void) => {
    try {
      fn()
      toast(t('transactions.undone'))
      // Desfeito com a folha ainda aberta ("criar outro"): o foco volta para o valor.
      if (isEntryOpen()) focusAmount()
    } catch {
      toast.error(t('transactions.undoFailed'))
    }
  }

  /** Mantém tipo, banco e data; limpa o resto e volta para o valor. */
  const startAnother = () => {
    const fresh = initialForm(data, { kind })
    const next: FormState = {
      ...fresh,
      tx: { ...fresh.tx, bankId: tx.bankId, date: tx.date },
      inv: initialInvestment(data, undefined, { operation: inv.operation, type: inv.type, bankId: inv.bankId }),
    }
    next.amount = 0
    setForm(next)
    setBaseline(next)
    setAmountTouched(false)
    setErrors({})
    manual.current = { category: false, payment: false }
    setRound((r) => r + 1)
    focusAmount()
  }

  const submit = (mode: Mode) => {
    if (blocked || performance.now() < lockUntil.current) return
    const found = validate()
    if (Object.keys(found).length) {
      setErrors(found)
      focusFirstInvalid()
      return
    }
    lockUntil.current = Infinity
    try {
      const { message, revert: fn } = save()
      toast(message, { action: { label: t('common.undo'), onClick: () => revert(fn) } })
    } catch (err) {
      if (err instanceof DataError && err.code === 'not-found') {
        toast.error(t('errors.notFound'))
        closeEntry()
        return
      }
      lockUntil.current = 0
      if (err instanceof DataError && err.field) {
        setErrors({ [err.field]: errorText(err.field) })
        focusFirstInvalid()
      } else toast.error(t('form.errors.generic'))
      return
    }
    if (mode === 'new' && !editing) {
      lockUntil.current = performance.now() + SAVE_NEW_COOLDOWN_MS
      startAnother()
    } else closeEntry()
  }

  const remove = () => {
    lockUntil.current = Infinity
    try {
      if (editingInv) actions.deleteInvestment(editingInv.id)
      else if (editingTx) actions.deleteTransaction(editingTx.id)
      toast(t('transactions.deleted'), { action: { label: t('common.undo'), onClick: () => undo() } })
    } catch {
      toast.error(t('errors.notFound'))
    }
    setConfirmDelete(false)
    closeEntry()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Tecla segurada repete o evento: só a primeira vale.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.repeat) {
      e.preventDefault()
      submit(e.shiftKey ? 'new' : 'close')
    }
  }

  const titleKey = `form.${editing ? 'edit' : 'new'}${kind === 'investment' ? 'Investment' : kind === 'income' ? 'Income' : 'Expense'}` as const
  const kindOptions = [
    { value: 'expense' as const, label: t('kinds.expense'), tone: 'text-expense' },
    { value: 'income' as const, label: t('kinds.income'), tone: 'text-income' },
    ...(editing ? [] : [{ value: 'investment' as const, label: t('kinds.investment'), tone: 'text-invest' }]),
  ]
  const amountTone = kind === 'income' ? 'text-income' : kind === 'investment' ? 'text-invest' : 'text-label'

  return (
    <>
      <Sheet
        open={open}
        onClose={requestClose}
        title={t(titleKey)}
        closeLabel={t('common.close')}
        initialFocus={amountField}
        onSubmit={(e) => {
          e.preventDefault()
          submit('close')
        }}
        footer={
          blocked ? (
            <>
              <span className="flex-1" />
              <Button onClick={requestClose}>{t('common.close')}</Button>
            </>
          ) : (
            <>
              {editing && (
                <Button variant="ghost" className="text-expense" onClick={() => setConfirmDelete(true)}>
                  <LuTrash2 className="size-4" aria-hidden />
                  {t('common.delete')}
                </Button>
              )}
              <span className="flex-1" />
              <kbd className="mr-1 hidden font-sans text-[12.5px] text-label-3 md:inline">{SAVE_KEYS}</kbd>
              <Button onClick={requestClose} className="max-sm:hidden">
                {t('common.cancel')}
              </Button>
              {!editing && (
                <Button
                  // O segundo clique de um clique duplo (detail 2) nunca é um novo envio, por mais
                  // lento que o computador esteja; a pausa de SAVE_NEW_COOLDOWN_MS cobre o resto.
                  onClick={(e) => e.detail <= 1 && submit('new')}
                  title={t('form.saveAndNewHint', { keys: SAVE_NEW_KEYS })}
                >
                  {t('form.saveAndNew')}
                </Button>
              )}
              <Button type="submit" variant="primary">
                {editing ? t('common.saveChanges') : t('common.save')}
              </Button>
            </>
          )
        }
      >
        <div ref={bodyRef} className="space-y-5" onKeyDown={onKeyDown}>
          {!(editing && kind === 'investment') && <Segmented label={t('common.type')} value={kind} options={kindOptions} onChange={changeKind} />}

          {blocked ? (
            <MissingSetup what={blocked} kind={txKind} onGo={finish} />
          ) : (
            <Fragment key={round}>
              {kind === 'investment' && (
                <Segmented
                  size="sm"
                  label={t('form.operation')}
                  value={inv.operation}
                  options={INVESTMENT_OPERATIONS.map((op) => ({ value: op, label: t(`operations.${op}`) }))}
                  onChange={(op) => setInvField('operation', op)}
                />
              )}

              <div className={cn('rounded-2xl px-2 pt-3 pb-2', errors.amount && 'fx-shake')} data-invalid={errors.amount ? '' : undefined}>
                <label htmlFor="entry-amount" className="mb-1 block text-center text-[13px] font-medium text-label-2">
                  {t('form.amount')}
                </label>
                <AmountInput
                  id="entry-amount"
                  label={t('form.amount')}
                  value={amount}
                  onChange={setAmount}
                  format={(v) => i18n.money(v)}
                  autoFocus
                  tone={amountTone}
                  invalid={Boolean(errors.amount)}
                />
                {errors.amount && (
                  <p className="mt-1 text-center text-[13px] font-medium text-expense" role="alert">
                    {errors.amount}
                  </p>
                )}
              </div>

              {kind === 'investment' ? (
                <InvestmentFields
                  data={data}
                  form={inv}
                  errors={errors}
                  set={setInvField}
                  banks={banks}
                  date={tx.date}
                  setDate={(v) => setTxField('date', v)}
                  onUseComputed={setAmount}
                  amount={amount}
                  editingId={editingInv?.id}
                />
              ) : (
                <TransactionFields
                  kind={txKind}
                  form={tx}
                  errors={errors}
                  set={setTxField}
                  onCounterparty={onCounterparty}
                  suggestions={memory.suggestions}
                  banks={banks}
                  categories={categories}
                />
              )}

              <Group>
                <Row label={t('common.note')} htmlFor="entry-note" stacked>
                  <textarea
                    id="entry-note"
                    value={note}
                    maxLength={LIMITS.note}
                    rows={2}
                    placeholder={t('common.notePlaceholder')}
                    onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
                    className="w-full resize-none bg-transparent text-[15px] text-label outline-none placeholder:text-label-3 focus-visible:outline-none"
                  />
                </Row>
              </Group>
            </Fragment>
          )}
        </div>
      </Sheet>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        title={t('transactions.deleteTitle')}
        body={t('transactions.deleteBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
      />
      <ConfirmDialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setConfirmDiscard(false)
          finish()
        }}
        title={editing ? t('form.discardEditTitle') : t('form.discardTitle')}
        body={t('form.discardBody')}
        confirmLabel={t('form.discard')}
        cancelLabel={t('form.keepEditing')}
      />
    </>
  )
}

/** Sem banco (ou sem categoria do tipo) não dá para lançar: explica e leva para o cadastro. */
function MissingSetup({ what, kind, onGo }: { what: 'bank' | 'category'; kind: Kind; onGo: () => void }) {
  const { t } = useI18n()
  const bank = what === 'bank'
  return (
    <div className="fx-fade rounded-2xl bg-fill-2 px-6 py-8 text-center">
      <p className="text-[16px] font-semibold text-label">{bank ? t('form.needBankTitle') : t(kind === 'income' ? 'form.needCategoryIncome' : 'form.needCategoryExpense')}</p>
      <p className="mx-auto mt-1 max-w-sm text-[14px] text-label-2">{bank ? t('form.needBankBody') : t('form.needCategoryBody')}</p>
      <Button
        variant="primary"
        className="mt-5"
        onClick={() => {
          onGo()
          navigate(bank ? '/banks' : '/categories')
        }}
      >
        {bank ? t('form.addBank') : t('form.addCategory')}
      </Button>
    </div>
  )
}
