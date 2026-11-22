// Sair e trocar de cofre (menu da conta e Minha conta): grava antes o que falta; se o Lume não
// responder, pergunta antes de descartar. Antes, sair apagava da memória o que ainda não tinha
// sido gravado, sem aviso.

import { useSyncExternalStore } from 'react'
import { signOut } from '../data/session'
import { useI18n } from '../i18n'
import { ConfirmDialog } from '../ui/Sheet'
import { useLatest } from '../ui/display'

type Reason = 'logout' | 'switch'

let asking: Reason | null = null
let busy = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const getAsking = () => asking

/** Sai do cofre (ou troca de cofre). Cliques repetidos enquanto grava não fazem nada. */
export async function leave(reason: Reason): Promise<void> {
  if (busy) return
  busy = true
  try {
    if ((await signOut(reason)) === 'unsaved') {
      asking = reason
      emit()
    }
  } finally {
    busy = false
  }
}

/** O aviso de alterações não salvas. Fica uma vez só, no app aberto. */
export function LeaveDialog() {
  const { t } = useI18n()
  const current = useSyncExternalStore(subscribe, getAsking, getAsking)
  const shown = useLatest(current)
  const close = () => {
    asking = null
    emit()
  }
  return (
    <ConfirmDialog
      open={current !== null}
      onClose={close}
      onConfirm={() => {
        const reason = asking
        close()
        if (reason) void signOut(reason, { force: true })
      }}
      title={t('leave.title')}
      body={t('leave.body')}
      confirmLabel={shown === 'switch' ? t('leave.switchAnyway') : t('leave.signOutAnyway')}
      cancelLabel={t('leave.stay')}
    />
  )
}
