// Estado do cofre aberto. Os dados ficam no SQLite do cofre (no back-end); aqui fica uma cópia em
// memória que a tela lê com useData()/useSettings(). Cada ação usa as regras puras de model.ts,
// atualiza a tela na hora e manda ao servidor só o que mudou (sync.ts), em ordem.

import { useSyncExternalStore } from 'react'
import { ApiError, setVaultHeader } from '../api/client'
import { vaultApi, type VaultSettings } from '../api/vault'
import * as model from './model'
import { readBackup, type ParsedBackup } from './backup'
import { readPrefs, writePrefs } from './prefs'
import { createSampleData } from './sample'
import { diff, emptyPending, fitsKeepalive, isEmpty, merge, rebase, toPayload, type Checkpoint, type Pending } from './sync'
import type { DataState, ID, Settings } from './types'

export function defaultSettings(): Settings {
  const prefs = readPrefs()
  return { language: prefs.language, currency: 'BRL', theme: prefs.theme, hideValues: false, onboardingDone: false, emailCopies: false }
}

/** idle: tudo salvo · saving: gravando · offline: sem resposta do Lume, tentando de novo. */
export type SyncStatus = 'idle' | 'saving' | 'offline'

export interface Snapshot {
  data: DataState
  settings: Settings
  vaultId: string | null
  sync: SyncStatus
}

/** conflict: outra janela mudou os dados e as suas alterações foram aplicadas por cima.
 *  save-failed: o servidor recusou uma alteração; os dados voltaram ao que está salvo. */
export type StoreErrorCode = 'save-failed' | 'conflict' | 'offline' | 'online'

let snapshot: Snapshot = { data: model.emptyState(), settings: defaultSettings(), vaultId: null, sync: 'idle' }
let revision = 0
let pending: Pending = emptyPending()
let pendingSettings: Partial<VaultSettings> = {}
let flushing = false
/** Sessão perdida: guarda as alterações até entrar de novo no mesmo cofre. */
let paused = false
let retryTimer: ReturnType<typeof setTimeout> | undefined
let retryDelay = 0
let conflictsInARow = 0
let undoState: DataState | null = null
/** Configurações de antes da última restauração de backup, para o "Desfazer". */
let undoSettings: Partial<Settings> | null = null
let undoToken = 0

/** Invalida os avisos de desfazer ligados a um estado anterior. */
function clearUndo(): void {
  undoState = null
  undoSettings = null
  undoToken++
}

/** Versão usada pelos avisos para detectar alterações no cofre. */
export const getUndoToken = (): number => undoToken

const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

const errorListeners = new Set<(code: StoreErrorCode) => void>()
export function onStoreError(listener: (code: StoreErrorCode) => void): () => void {
  errorListeners.add(listener)
  return () => errorListeners.delete(listener)
}
const notify = (code: StoreErrorCode) => errorListeners.forEach((l) => l(code))

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const getData = (): DataState => snapshot.data
export const getSettings = (): Settings => snapshot.settings
const getSync = (): SyncStatus => snapshot.sync

export function useData(): DataState {
  return useSyncExternalStore(subscribe, getData, getData)
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, getSettings)
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribe, getSync, getSync)
}

/** Há algo ainda não confirmado pelo servidor? */
export function hasUnsaved(): boolean {
  return flushing || !isEmpty(pending) || Object.keys(pendingSettings).length > 0
}

function setSync(sync: SyncStatus) {
  if (snapshot.sync === sync) return
  snapshot = { ...snapshot, sync }
  emit()
}

// ---------------------------------------------------------------- outras abas

type Message = { type: 'changed'; vaultId: string; revision: number } | { type: 'settings'; vaultId: string; settings: Settings }

// Só no navegador (nos testes em Node um canal aberto impediria o processo de terminar).
const channel: BroadcastChannel | null = typeof window === 'undefined' || typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('lume.vault')
function broadcast(message: Message) {
  try {
    channel?.postMessage(message)
  } catch {
    /* canal fechado */
  }
}

channel?.addEventListener('message', (event: MessageEvent<Message>) => {
  const message = event.data
  if (!message || message.vaultId !== snapshot.vaultId) return
  if (message.type === 'settings') {
    snapshot = { ...snapshot, settings: { ...message.settings } }
    writePrefs({ language: message.settings.language, theme: message.settings.theme })
    emit()
  } else if (message.type === 'changed' && message.revision > revision && !hasUnsaved()) {
    void reloadData()
  }
})

// ---------------------------------------------------------------- abrir e fechar o cofre

function fromServerSettings(s: VaultSettings): Settings {
  return { ...defaultSettings(), ...s }
}

/** Abre um cofre com os dados vindos do servidor (descarta o que havia na memória). */
export function hydrate(vaultId: string, data: DataState, rev: number, settings: VaultSettings): void {
  clearTimeout(retryTimer)
  revision = rev
  pending = emptyPending()
  pendingSettings = {}
  paused = false
  retryDelay = 0
  conflictsInARow = 0
  clearUndo()
  setVaultHeader(vaultId)
  snapshot = { data, settings: fromServerSettings(settings), vaultId, sync: 'idle' }
  writePrefs({ language: snapshot.settings.language, theme: snapshot.settings.theme })
  emit()
}

/**
 * Voltou a entrar no mesmo cofre depois de a sessão expirar: aplica por cima dos dados do
 * servidor o que ainda não tinha sido salvo e continua gravando.
 */
export function resume(vaultId: string, data: DataState, rev: number, settings: VaultSettings): void {
  if (vaultId !== snapshot.vaultId || !hasUnsaved()) {
    hydrate(vaultId, data, rev, settings)
    return
  }
  const keptSettings = pendingSettings
  revision = rev
  paused = false
  setVaultHeader(vaultId)
  clearUndo()
  snapshot = { ...snapshot, data: rebase(data, pending), settings: { ...fromServerSettings(settings), ...keptSettings } }
  emit()
  schedule()
}

/** Fecha o cofre na memória (sair, trocar de cofre, excluir). */
export function clearVault(): void {
  clearTimeout(retryTimer)
  revision = 0
  pending = emptyPending()
  pendingSettings = {}
  paused = false
  clearUndo()
  setVaultHeader(null)
  const prefs = readPrefs()
  snapshot = { data: model.emptyState(), settings: { ...defaultSettings(), language: prefs.language, theme: prefs.theme }, vaultId: null, sync: 'idle' }
  emit()
}

/**
 * Grava agora o que ainda falta (antes de sair ou trocar de cofre). Resolve `true` com tudo salvo;
 * `false` se o Lume não respondeu, se a sessão caiu ou se passou de `timeoutMs`: nesse caso o que
 * falta continua guardado aqui, e quem chamou decide (perguntar antes de descartar).
 */
export async function saveNow(timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (hasUnsaved()) {
    if (paused || !snapshot.vaultId || snapshot.sync === 'offline' || Date.now() > deadline) return false
    if (flushing) {
      await new Promise((resolve) => setTimeout(resolve, 40))
    } else {
      clearTimeout(retryTimer)
      await flush()
    }
  }
  return true
}

/** A sessão caiu: para de gravar, mas guarda o que falta salvar. */
export function pause(): void {
  paused = true
  clearTimeout(retryTimer)
}

async function reloadData(): Promise<void> {
  const vaultId = snapshot.vaultId
  try {
    const result = await vaultApi.data()
    if (snapshot.vaultId !== vaultId) return
    revision = result.revision
    clearUndo()
    snapshot = { ...snapshot, data: isEmpty(pending) ? result.data : rebase(result.data, pending) }
    emit()
  } catch {
    /* tenta de novo na próxima mudança */
  }
}

// ---------------------------------------------------------------- gravação

function schedule(delay = 0) {
  if (paused || !snapshot.vaultId) return
  clearTimeout(retryTimer)
  retryTimer = setTimeout(() => void flush(), delay)
}

async function flush(): Promise<void> {
  if (flushing || paused || !snapshot.vaultId) return
  const vaultId = snapshot.vaultId
  const settingsBatch = pendingSettings
  const hasSettings = Object.keys(settingsBatch).length > 0
  if (isEmpty(pending) && !hasSettings) {
    setSync('idle')
    return
  }
  flushing = true
  setSync(snapshot.sync === 'offline' ? 'offline' : 'saving')
  const batch = pending
  pending = emptyPending()
  pendingSettings = {}
  let again = 0
  try {
    if (hasSettings) {
      try {
        await vaultApi.settings(settingsBatch)
      } catch (err) {
        if (err instanceof ApiError && err.status === 422) notify('save-failed')
        else {
          pendingSettings = { ...settingsBatch, ...pendingSettings }
          throw err
        }
      }
    }
    if (!isEmpty(batch)) {
      const result = await vaultApi.changes(toPayload(batch, revision))
      if (snapshot.vaultId === vaultId) {
        revision = result.revision
        broadcast({ type: 'changed', vaultId, revision })
      }
    }
    conflictsInARow = 0
    if (snapshot.sync === 'offline') notify('online')
    retryDelay = 0
  } catch (err) {
    const sameVault = snapshot.vaultId === vaultId
    if (sameVault) pending = merge(batch, pending)
    if (!sameVault) {
      // Trocou de cofre no meio da gravação: o que faltava pertencia ao outro cofre.
    } else if (!(err instanceof ApiError) || err.status === 0) {
      // O Lume não respondeu (fechado ou reiniciando): tenta de novo, cada vez mais devagar.
      if (snapshot.sync !== 'offline') notify('offline')
      setSync('offline')
      retryDelay = Math.min(15_000, retryDelay ? retryDelay * 2 : 1000)
      again = retryDelay
    } else if (err.code === 'conflict' && conflictsInARow < 3) {
      // Outra janela gravou antes: pega o que está salvo, aplica as suas alterações por cima e tenta de novo.
      conflictsInARow++
      try {
        const server = await vaultApi.data()
        revision = server.revision
        snapshot = { ...snapshot, data: rebase(server.data, pending) }
        clearUndo()
        emit()
        notify('conflict')
      } catch {
        again = 1000
      }
    } else if (err.status === 401 || err.code === 'vault-changed') {
      paused = true // a tela de entrada aparece; ao entrar de novo, resume() continua daqui
    } else {
      // Recusado (dados inválidos, conflito repetido): volta ao que está salvo no cofre.
      pending = emptyPending()
      clearUndo()
      notify('save-failed')
      await reloadData()
    }
  } finally {
    flushing = false
    if (!paused && snapshot.vaultId) {
      if (!isEmpty(pending) || Object.keys(pendingSettings).length) schedule(again)
      else if (snapshot.sync !== 'offline' || again === 0) setSync('idle')
    }
  }
}

/** `restore`: os dados já existiam (backup, "Desfazer"); veja `Pending.restore`.
 *  `checkpoint`: troca de tudo de uma vez; o servidor guarda uma cópia do cofre antes. */
function commit(next: DataState, undoable = false, restore = false, checkpoint: Checkpoint | null = null): void {
  const changes = diff(snapshot.data, next)
  changes.restore = restore
  changes.checkpoint = checkpoint
  undoToken++
  undoState = undoable ? snapshot.data : null
  undoSettings = null
  snapshot = { ...snapshot, data: next }
  if (!isEmpty(changes)) {
    merge(pending, changes)
    if (snapshot.sync !== 'offline') setSync('saving')
    schedule(snapshot.sync === 'offline' ? retryDelay : 0)
  }
  emit()
}

/** Desfaz a última exclusão (o aviso na tela oferece "Desfazer"). */
export function undo(): boolean {
  if (!undoState) return false
  const previous = undoState
  const settings = undoSettings
  undoState = null
  commit(previous, false, true)
  // Restaurar um backup também troca idioma, tema, moeda...: desfazer volta tudo.
  if (settings) updateSettings(settings)
  return true
}

/** Vincula o aviso à operação atual, sem permitir desfazer outra alteração mais recente. */
export function captureUndoAction(label: string) {
  const token = undoToken
  const isValid = () => undoState !== null && token === undoToken
  return {
    label,
    isValid,
    onClick: () => { if (isValid()) undo() },
  }
}

export function updateSettings(patch: Partial<Settings>): void {
  snapshot = { ...snapshot, settings: { ...snapshot.settings, ...patch } }
  writePrefs({ language: snapshot.settings.language, theme: snapshot.settings.theme })
  if (snapshot.vaultId) {
    pendingSettings = { ...pendingSettings, ...patch }
    broadcast({ type: 'settings', vaultId: snapshot.vaultId, settings: snapshot.settings })
    schedule()
  }
  emit()
}

// Ao fechar a aba com algo ainda não salvo: tenta uma última gravação e pede confirmação.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (!snapshot.vaultId || !hasUnsaved()) return
    if (!flushing && !paused && !isEmpty(pending)) {
      const payload = toPayload(pending, revision)
      if (fitsKeepalive(payload)) void vaultApi.changes(payload, true).catch(() => undefined)
    }
    event.preventDefault()
  })
}

// ---------------------------------------------------------------- ações

export const actions = {
  saveBank(input: model.BankInput & { id?: ID }) {
    const [next, bank] = model.saveBank(snapshot.data, input)
    commit(next)
    return bank
  },
  setPrimaryBank(id: ID | null) {
    commit(model.setPrimaryBank(snapshot.data, id))
  },
  deleteBank(id: ID, reassignTo?: ID) {
    commit(model.deleteBank(snapshot.data, id, reassignTo), true)
  },
  saveCategory(input: model.CategoryInput & { id?: ID }) {
    const [next, category] = model.saveCategory(snapshot.data, input)
    commit(next)
    return category
  },
  deleteCategory(id: ID, reassignTo?: ID) {
    commit(model.deleteCategory(snapshot.data, id, reassignTo), true)
  },
  saveTransaction(input: model.TransactionInput & { id?: ID }) {
    const [next, tx] = model.saveTransaction(snapshot.data, input)
    commit(next)
    return tx
  },
  deleteTransaction(id: ID) {
    commit(model.deleteTransaction(snapshot.data, id), true)
  },
  saveInvestment(input: model.InvestmentInput & { id?: ID }) {
    const [next, inv] = model.saveInvestment(snapshot.data, input)
    commit(next)
    return inv
  },
  deleteInvestment(id: ID) {
    commit(model.deleteInvestment(snapshot.data, id), true)
  },
  saveReport(input: Parameters<typeof model.saveReport>[1]) {
    const [next, report] = model.saveReport(snapshot.data, input)
    commit(next)
    return report
  },
  deleteReport(id: ID) {
    commit(model.deleteReport(snapshot.data, id), true)
  },
  /** Troca tudo pelo conteúdo de um backup (.json, em texto ou já lido por readBackup).
   *  Lança BackupError se o arquivo for inválido. */
  importBackup(input: string | ParsedBackup) {
    const backup = typeof input === 'string' ? readBackup(input) : input
    const before = snapshot.settings
    commit(backup.data, true, true, 'before-restore')
    if (backup.settings) {
      const patch = { ...backup.settings, onboardingDone: true }
      updateSettings(patch)
      undoSettings = Object.fromEntries(Object.keys(patch).map((key) => [key, before[key as keyof Settings]])) as Partial<Settings>
    }
    return backup
  },
  loadSample() {
    commit(createSampleData(), true, false, 'before-sample')
  },
  /** Apaga lançamentos e investimentos e volta os cadastros ao padrão. */
  resetAll() {
    commit(model.createSeedData(), true, false, 'before-reset')
  },
}
