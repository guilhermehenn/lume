// Exclusão de banco. Com lançamentos, é uma junção: eles, o saldo inicial e (se for o caso) o
// posto de principal vão para o banco escolhido, e o saldo total não muda. Sem lançamentos, o
// banco só sai, e o aviso diz se um saldo inicial deixa de contar.

import { useState } from 'react'
import { actions, captureUndoAction, useData } from '../../data/store'
import type { Bank } from '../../data/types'
import { useI18n } from '../../i18n'
import { BankAvatar, MASK, useHidden, useLatest } from '../../ui/display'
import { Select } from '../../ui/inputs'
import { ConfirmDialog } from '../../ui/Sheet'
import { toast } from '../../ui/toast'

export function DeleteBankDialog({
  bank: current,
  count: currentCount,
  onClose,
  onDeleted,
}: {
  bank: Bank | null
  /** Lançamentos e operações de investimento do banco (a tela já tem essa conta). */
  count: number
  onClose: () => void
  onDeleted?: () => void
}) {
  const data = useData()
  // Mantém o conteúdo enquanto o diálogo faz a animação de saída.
  const bank = useLatest(current)
  const count = useLatest<number>(current ? currentCount : null) ?? 0
  const i18n = useI18n()
  const { t } = i18n
  const [picked, setPicked] = useState<string | undefined>()
  const others = data.banks.filter((b) => b.id !== bank?.id).sort((a, b) => a.name.localeCompare(b.name))
  // Sugestão: o principal (se não for o que sai). A pessoa pode trocar antes de confirmar.
  const target = picked ?? others.find((b) => b.isPrimary)?.id
  const targetBank = others.find((b) => b.id === target)
  const moving = count > 0
  const blocked = moving && others.length === 0

  const reset = () => {
    setPicked(undefined)
    onClose()
  }
  const confirm = () => {
    if (!current || !bank) return
    try {
      actions.deleteBank(bank.id, moving ? target : undefined)
      const message =
        moving && targetBank ? t('banks.deletedMoved', { name: bank.name, count, target: targetBank.name }) : t('banks.deleted')
      toast(message, { action: captureUndoAction(t('common.undo')) })
      onDeleted?.()
    } catch {
      toast.error(t('errors.generic'))
    }
    reset()
  }

  const hidden = useHidden()
  const amount = (cents: number) => (hidden ? MASK : i18n.money(cents))
  const notes: string[] = []
  if (bank && moving && !blocked) {
    if (bank.initialBalance !== 0) notes.push(t('banks.movesInitial', { amount: amount(bank.initialBalance) }))
    if (bank.isPrimary) notes.push(targetBank ? t('banks.primaryMoves', { name: targetBank.name }) : t('banks.primaryMovesUnchosen'))
  } else if (bank && !moving && bank.initialBalance !== 0) {
    notes.push(t('banks.dropsInitial', { amount: amount(bank.initialBalance) }))
  }

  return (
    <ConfirmDialog
      open={current !== null}
      onClose={reset}
      onConfirm={confirm}
      title={t('banks.deleteTitle', { name: bank?.name ?? '' })}
      body={blocked ? t('banks.noTarget', { count }) : moving ? t('banks.inUse', { count }) : t('banks.deleteBody')}
      confirmLabel={moving ? t('banks.deleteAndMove') : t('common.delete')}
      cancelLabel={t('common.cancel')}
      confirmDisabled={moving && !targetBank}
    >
      {(notes.length > 0 || (moving && !blocked)) && (
        <div className="space-y-3">
          {moving && !blocked && (
            <div className="rounded-xl bg-fill-2 px-3 py-2 text-[14px]">
              {/* Rótulo em cima: o nome do destino usa a largura toda, sem reticências. */}
              <span className="block text-[12.5px] text-label-2">{t('banks.moveTo')}</span>
              <Select
                className="mr-0 -ml-2 w-[calc(100%+0.5rem)]"
                label={t('banks.moveTo')}
                value={target}
                options={others.map((b) => ({ value: b.id, label: b.name, icon: <BankAvatar name={b.name} color={b.color} size="sm" /> }))}
                placeholder={t('form.morePlaceholder')}
                onChange={setPicked}
              />
            </div>
          )}
          {notes.length > 0 && (
            <ul className="space-y-1 px-1 text-[13.5px] text-label-2">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </ConfirmDialog>
  )
}
