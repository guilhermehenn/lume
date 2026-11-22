// Gravação por diferenças: compara o estado antes/depois de cada ação e junta as mudanças
// pendentes até o servidor confirmar. Funções puras, testadas em tests/unit/sync.test.ts.

import type { ChangesPayload, Collection } from '../api/vault'
import type { DataState, ID } from './types'

export const COLLECTIONS: Collection[] = ['banks', 'categories', 'transactions', 'investments', 'reports']

type Entity = { id: ID }

export interface Pending {
  upserts: Record<Collection, Map<ID, Entity>>
  deletes: Record<Collection, Set<ID>>
  /**
   * O lote traz dados que já existiam (backup restaurado, "Desfazer"), não algo digitado agora.
   * O servidor confere a integridade de sempre, mas não as regras dos formulários, que mudam de uma
   * versão para outra: um backup de versão anterior precisa voltar como era.
   */
  restore: boolean
  /** Troca de tudo de uma vez: o servidor guarda uma cópia do cofre com este motivo antes de gravar. */
  checkpoint: Checkpoint | null
}

export type Checkpoint = 'before-restore' | 'before-sample' | 'before-reset'

export function emptyPending(): Pending {
  return {
    upserts: { banks: new Map(), categories: new Map(), transactions: new Map(), investments: new Map(), reports: new Map() },
    deletes: { banks: new Set(), categories: new Set(), transactions: new Set(), investments: new Set(), reports: new Set() },
    restore: false,
    checkpoint: null,
  }
}

export function isEmpty(pending: Pending): boolean {
  return COLLECTIONS.every((c) => pending.upserts[c].size === 0 && pending.deletes[c].size === 0)
}

export function pendingCount(pending: Pending): number {
  return COLLECTIONS.reduce((n, c) => n + pending.upserts[c].size + pending.deletes[c].size, 0)
}

function list(state: DataState, collection: Collection): Entity[] {
  return state[collection] as Entity[]
}

/** O que mudou de `prev` para `next`. Objetos iguais por referência são considerados iguais. */
export function diff(prev: DataState, next: DataState): Pending {
  const out = emptyPending()
  for (const c of COLLECTIONS) {
    const before = list(prev, c)
    const after = list(next, c)
    if (before === after) continue
    const old = new Map(before.map((e) => [e.id, e]))
    for (const entity of after) {
      const previous = old.get(entity.id)
      if (previous !== entity && (previous === undefined || JSON.stringify(previous) !== JSON.stringify(entity))) {
        out.upserts[c].set(entity.id, entity)
      }
      old.delete(entity.id)
    }
    for (const id of old.keys()) out.deletes[c].add(id)
  }
  return out
}

/** Junta `later` em `into` (o mais recente vence). Altera e devolve `into`. */
export function merge(into: Pending, later: Pending): Pending {
  into.restore = into.restore || later.restore
  // Uma cópia basta: a do primeiro pedido guarda o estado de antes de tudo o que vem junto.
  into.checkpoint ??= later.checkpoint
  for (const c of COLLECTIONS) {
    for (const id of later.deletes[c]) {
      into.upserts[c].delete(id)
      into.deletes[c].add(id)
    }
    for (const [id, entity] of later.upserts[c]) {
      into.deletes[c].delete(id)
      into.upserts[c].set(id, entity)
    }
  }
  return into
}

export function toPayload(pending: Pending, baseRevision: number): ChangesPayload {
  const payload: ChangesPayload = { baseRevision, upserts: {}, deletes: {} }
  for (const c of COLLECTIONS) {
    if (pending.upserts[c].size) payload.upserts[c] = [...pending.upserts[c].values()]
    if (pending.deletes[c].size) payload.deletes[c] = [...pending.deletes[c]]
  }
  if (pending.restore) payload.restore = true
  if (pending.checkpoint) payload.checkpoint = pending.checkpoint
  return payload
}

/**
 * Aplica as mudanças pendentes sobre os dados vindos do servidor (ex.: depois de outra janela
 * gravar). Itens alterados ficam na mesma posição; novos vão para o fim, como no servidor.
 */
export function rebase(server: DataState, pending: Pending): DataState {
  const next: DataState = { ...server }
  for (const c of COLLECTIONS) {
    const ups = pending.upserts[c]
    const dels = pending.deletes[c]
    if (!ups.size && !dels.size) continue
    const seen = new Set<ID>()
    const items: Entity[] = []
    for (const entity of list(server, c)) {
      if (dels.has(entity.id)) continue
      seen.add(entity.id)
      items.push(ups.get(entity.id) ?? entity)
    }
    for (const [id, entity] of ups) if (!seen.has(id)) items.push(entity)
    ;(next as unknown as Record<Collection, Entity[]>)[c] = items
  }
  return next
}

/** Mudanças grandes demais para uma gravação ao fechar a aba (limite do navegador: 64 KB). */
export function fitsKeepalive(payload: ChangesPayload): boolean {
  return JSON.stringify(payload).length < 60_000
}
