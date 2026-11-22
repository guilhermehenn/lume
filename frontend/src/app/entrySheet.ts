// Abre a folha de lançamento de qualquer lugar (botão Novo, atalho N, clique numa linha).

import { useSyncExternalStore } from 'react'
import type { InvestmentInput } from '../data/model'
import type { ID } from '../data/types'

export type EntryKind = 'expense' | 'income' | 'investment'

export interface EntryRequest {
  kind: EntryKind
  /** Editar um lançamento existente. */
  id?: ID
  /** Valores iniciais para uma nova operação (ex.: resgate de um ativo da carteira). */
  preset?: Partial<InvestmentInput>
}

interface State {
  open: boolean
  request: EntryRequest | null
  /** Muda a cada abertura para o formulário começar limpo. */
  seq: number
}

let state: State = { open: false, request: null, seq: 0 }
let lastKind: EntryKind = 'expense'
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function openEntry(request: EntryRequest): void {
  if (!request.id) lastKind = request.kind
  state = { open: true, request, seq: state.seq + 1 }
  emit()
}

export function openNewEntry(kind?: EntryKind): void {
  openEntry({ kind: kind ?? lastKind })
}

/** A folha está aberta (não conta a que está fechando)? */
export function isEntryOpen(): boolean {
  return state.open
}

export function closeEntry(): void {
  state = { ...state, open: false }
  emit()
}

export function useEntrySheet(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
    () => state,
  )
}
