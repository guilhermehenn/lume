// Sessão do cofre: qual cofre está aberto nesta aba e quem é o dono (Minha conta).
// O cookie de sessão (HttpOnly) é do servidor; aqui só fica o resultado.

import { useSyncExternalStore } from 'react'
import { ApiError, onAuthLost } from '../api/client'
import { vaultApi, type Account, type SessionInfo, type VaultSummary } from '../api/vault'
import { rememberEmail } from './prefs'
import { clearVault, hydrate, pause, resume, saveNow } from './store'

/** Por que a tela de entrada apareceu. */
export type LockReason = 'start' | 'expired' | 'logout' | 'switch' | 'deleted' | 'elsewhere' | 'closedElsewhere'

export type SessionState =
  | { status: 'loading' }
  | { status: 'offline' }
  | { status: 'locked'; reason: LockReason; vaultId?: string }
  | { status: 'open'; vault: VaultSummary; account: Account }

let state: SessionState = { status: 'loading' }
const listeners = new Set<() => void>()

function set(next: SessionState) {
  state = next
  listeners.forEach((l) => l())
}

export const getSession = (): SessionState => state

export function useSession(): SessionState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    getSession,
    getSession,
  )
}

/** Dono do cofre aberto (ou null fora de um cofre). */
export function useAccount(): Account | null {
  const session = useSession()
  return session.status === 'open' ? session.account : null
}

export function useVault(): VaultSummary | null {
  const session = useSession()
  return session.status === 'open' ? session.vault : null
}

export function fullName(account: Pick<Account, 'firstName' | 'lastName'> | null | undefined): string {
  if (!account) return ''
  return `${account.firstName} ${account.lastName}`.trim()
}

/** Nome do dono para a saudação e os arquivos exportados. */
export function useOwnerName(): { first: string; full: string } {
  const account = useAccount()
  return { first: account?.firstName ?? '', full: fullName(account) }
}

// ---------------------------------------------------------------- outras abas

/** `closed`: esta aba saiu do cofre (ou o excluiu) e o cookie de sessão acabou para todas. */
type Message = { type: 'opened'; vaultId: string } | { type: 'closed'; vaultId?: string; deleted?: boolean }
// Só no navegador (nos testes em Node um canal aberto impediria o processo de terminar).
const channel: BroadcastChannel | null = typeof window === 'undefined' || typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('lume.session')
function broadcast(message: Message) {
  try {
    channel?.postMessage(message)
  } catch {
    /* canal fechado */
  }
}

channel?.addEventListener('message', (event: MessageEvent<Message>) => {
  const message = event.data
  if (!message) return
  if (message.type === 'closed') {
    // Saiu (ou trocou de cofre) em outra aba: o aviso diz isso, e não "outra janela abriu outro cofre".
    if (state.status === 'open') lockHere(message.deleted ? 'deleted' : 'closedElsewhere', message.deleted ? undefined : state.vault.id)
  } else if (state.status === 'open' && state.vault.id !== message.vaultId) {
    // O cookie é um só: outra aba abriu outro cofre. Esta não pode continuar gravando no antigo.
    lockHere('elsewhere', state.vault.id)
  } else if (state.status === 'locked' && state.vaultId === message.vaultId) {
    // Entrou de novo neste cofre em outra aba: esta continua de onde parou.
    void resumeFromCookie(message.vaultId)
  }
})

function lockHere(reason: LockReason, vaultId?: string) {
  pause()
  set({ status: 'locked', reason, vaultId })
}

// Qualquer chamada que receba 401 (sessão expirada) ou vault-changed tranca esta aba.
onAuthLost((error) => {
  if (state.status !== 'open') return
  lockHere(error.code === 'vault-changed' ? 'elsewhere' : 'expired', state.vault.id)
})

// ---------------------------------------------------------------- abrir

async function open(info: SessionInfo, mode: 'fresh' | 'resume'): Promise<void> {
  const [{ data, revision }, account] = await Promise.all([vaultApi.data(), vaultApi.account()])
  if (mode === 'resume') resume(info.vault.id, data, revision, info.settings)
  else hydrate(info.vault.id, data, revision, info.settings)
  set({ status: 'open', vault: info.vault, account })
}

/** Ao abrir o app: usa a sessão do cookie, se houver; senão mostra a escolha de cofre. */
export async function start(): Promise<void> {
  set({ status: 'loading' })
  try {
    await open(await vaultApi.session(), 'fresh')
  } catch (err) {
    if (err instanceof ApiError && err.status === 0) {
      set({ status: 'offline' })
    } else {
      clearVault()
      set({ status: 'locked', reason: 'start' })
    }
  }
}

async function resumeFromCookie(vaultId: string): Promise<void> {
  try {
    const info = await vaultApi.session()
    if (info.vault.id !== vaultId || state.status !== 'locked' || state.vaultId !== vaultId) return
    await open(info, 'resume')
  } catch {
    /* continua na tela de entrada */
  }
}

/** Entrar com e-mail e senha. Lança ApiError (bad-credentials, throttled...). */
export async function login(vaultId: string, email: string, password: string): Promise<void> {
  const info = await vaultApi.login(vaultId, email, password)
  rememberEmail(vaultId, email.trim())
  // Se a sessão tinha expirado com alterações ainda não salvas neste cofre, elas seguem (resume decide).
  await open(info, 'resume')
  broadcast({ type: 'opened', vaultId })
}

/**
 * Depois de criar um cofre ou de trocar a senha com o código de recuperação: o servidor já
 * abriu a sessão; aqui o app carrega o cofre e mostra as telas.
 */
export async function openCreated(info: SessionInfo, email: string): Promise<void> {
  rememberEmail(info.vault.id, email.trim())
  await open(info, 'fresh')
  broadcast({ type: 'opened', vaultId: info.vault.id })
}

/**
 * Sair do cofre (ou só trocar de cofre: a tela de escolha aparece).
 * Antes, grava o que falta. Se não der (o Lume não respondeu), não sai e devolve 'unsaved', para a
 * tela perguntar; com `force`, sai mesmo assim e o que faltava salvar se perde.
 */
export async function signOut(reason: 'logout' | 'switch' = 'logout', options: { force?: boolean } = {}): Promise<'done' | 'unsaved'> {
  if (!options.force && !(await saveNow())) return 'unsaved'
  const vaultId = state.status === 'open' ? state.vault.id : undefined
  try {
    await vaultApi.logout()
  } catch {
    /* o servidor pode já ter fechado; a tela tranca do mesmo jeito */
  }
  clearVault()
  set({ status: 'locked', reason })
  broadcast({ type: 'closed', vaultId })
  return 'done'
}

/** O cofre foi excluído nesta aba. */
export function afterDelete(): void {
  const vaultId = state.status === 'open' ? state.vault.id : undefined
  clearVault()
  set({ status: 'locked', reason: 'deleted' })
  broadcast({ type: 'closed', vaultId, deleted: true })
}

export function updateAccount(account: Account): void {
  if (state.status === 'open') set({ ...state, account: { ...state.account, ...account } })
}

export function updateVault(vault: VaultSummary): void {
  if (state.status === 'open') set({ ...state, vault })
}

/** Recarrega Minha conta (ex.: depois de configurar o e-mail). */
export async function refreshAccount(): Promise<Account | null> {
  if (state.status !== 'open') return null
  const account = await vaultApi.account()
  updateAccount(account)
  return account
}
