// Acesso à API local (FastAPI em 127.0.0.1): cofres, dados, Minha conta, e-mail, cotações e notícias.

import { useCallback, useEffect, useRef, useState } from 'react'

export interface Quote {
  id: 'USD' | 'EUR' | 'BTC' | 'ETH' | string
  value: number
  change_pct: number
  currency: string
  as_of: string | null
  stale?: boolean
}

export interface Indicator {
  id: 'SELIC' | 'CDI' | 'IPCA12M' | string
  value: number
  unit: string
  as_of: string | null
  stale?: boolean
}

export interface MarketResponse {
  updated_at: string | null
  stale: boolean
  quotes: Quote[]
  indicators: Indicator[]
  sources: string[]
  errors: string[]
}

export interface NewsItem {
  title: string
  link: string
  source: string
  published_at: string | null
}

export interface NewsResponse {
  updated_at: string | null
  stale: boolean
  items: NewsItem[]
  errors: string[]
}

/** Erro devolvido pela API. `code` vem do back-end (ex.: 'bad-credentials', 'conflict'). */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string = status === 0 ? 'network' : `http-${status}`,
    public retryAfter?: number,
    public revision?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Cofre aberto nesta aba. Vai em cada chamada para o servidor recusar se outra aba trocou de cofre. */
let vaultHeader: string | null = null
export function setVaultHeader(vaultId: string | null): void {
  vaultHeader = vaultId
}

const authListeners = new Set<(error: ApiError) => void>()
/** Avisa quando a sessão do cofre acabou (401) ou outra aba trocou de cofre (409 vault-changed). */
export function onAuthLost(listener: (error: ApiError) => void): () => void {
  authListeners.add(listener)
  return () => authListeners.delete(listener)
}

async function toApiError(response: Response): Promise<ApiError> {
  let detail: { code?: string; message?: string; retryAfter?: number; revision?: number } = {}
  try {
    const body = (await response.json()) as { detail?: unknown }
    if (body && typeof body.detail === 'object' && body.detail) detail = body.detail as typeof detail
    else if (body && typeof body.detail === 'string') detail = { message: body.detail }
  } catch {
    /* corpo vazio ou não JSON */
  }
  const header = Number(response.headers.get('retry-after'))
  return new ApiError(
    response.status,
    detail.message ?? `HTTP ${response.status}`,
    detail.code ?? `http-${response.status}`,
    detail.retryAfter ?? (Number.isFinite(header) && header > 0 ? header : undefined),
    detail.revision,
  )
}

export interface RequestOptions {
  signal?: AbortSignal
  /** Mantém a chamada viva ao fechar a aba (gravação final). */
  keepalive?: boolean
  /** Não avisa os ouvintes de sessão (ex.: conferir se há sessão ao abrir o app). */
  quietAuth?: boolean
}

export async function apiRequest<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-App-Request': '1' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (vaultHeader) headers['X-Vault-Id'] = vaultHeader
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options.signal,
      keepalive: options.keepalive,
      cache: 'no-store',
      credentials: 'same-origin',
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(0, 'network')
  }
  if (!response.ok) {
    const error = await toApiError(response)
    const lost = error.status === 401 || error.code === 'vault-changed'
    if (lost && !options.quietAuth) authListeners.forEach((l) => l(error))
    throw error
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return apiRequest<T>('GET', path, undefined, { signal })
}

export interface RemoteState<T> {
  data: T | null
  error: boolean
  loading: boolean
  refreshing: boolean
  refresh: () => void
}

/** Última resposta de cada endereço: voltar ao Início mostra o que já veio, sem piscar. */
const remembered = new Map<string, { data: unknown; at: number }>()

/**
 * Busca um endpoint e repete a cada `intervalMs` enquanto a aba está visível.
 * Falhas mantêm o último dado (com `error: true`) em vez de esvaziar a tela.
 * Ao abrir de novo a tela (ou voltar para a aba), só busca se a última resposta tiver mais de
 * 30 s (ou de `intervalMs`, se for menor).
 */
export function usePolling<T>(path: string, intervalMs: number): RemoteState<T> {
  const [data, setData] = useState<T | null>(() => (remembered.get(path)?.data as T | undefined) ?? null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(() => !remembered.has(path))
  const [refreshing, setRefreshing] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const revalidateMs = Math.min(intervalMs, 30_000)

  const load = useCallback(
    async (force: boolean) => {
      controller.current?.abort()
      const ac = new AbortController()
      controller.current = ac
      if (force) setRefreshing(true)
      try {
        const result = await apiGet<T>(`${path}${force ? '?refresh=true' : ''}`, ac.signal)
        if (ac.signal.aborted) return
        remembered.set(path, { data: result, at: Date.now() })
        setData(result)
        setError(false)
      } catch (err) {
        if (ac.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return
        setError(true)
      } finally {
        if (!ac.signal.aborted) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [path],
  )

  useEffect(() => {
    const due = () => Date.now() - (remembered.get(path)?.at ?? 0) >= revalidateMs
    if (due()) void load(false)
    let timer: number | undefined
    const schedule = () => {
      window.clearInterval(timer)
      timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') void load(false)
      }, intervalMs)
    }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (due()) void load(false)
      schedule()
    }
    schedule()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      controller.current?.abort()
    }
  }, [load, path, intervalMs, revalidateMs])

  const refresh = useCallback(() => void load(true), [load])
  return { data, error, loading, refreshing, refresh }
}

export const useMarket = () => usePolling<MarketResponse>('/market', 60_000)
export const useNews = () => usePolling<NewsResponse>('/news', 15 * 60_000)
