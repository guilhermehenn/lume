// Rotas por hash (#/lancamentos): funcionam servidas pelo FastAPI sem configuração extra.

import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { canAnimateViews, withViewTransition } from '../lib/viewTransition'

export const ROUTES = ['/', '/transactions', '/investments', '/banks', '/categories', '/reports', '/export', '/settings', '/account', '/print'] as const
export type RoutePath = (typeof ROUTES)[number]

export interface Route {
  path: string
  query: URLSearchParams
  key: string
}

function parse(): Route {
  const raw = typeof location === 'undefined' ? '' : location.hash.replace(/^#/, '')
  const [path, qs] = (raw || '/').split('?')
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : '/'
  return { path: clean || '/', query: new URLSearchParams(qs ?? ''), key: raw || '/' }
}

let current = parse()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function reducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

function apply(next: Route) {
  const pathChanged = next.path !== current.path
  const update = () => {
    current = next
    emit()
  }
  if (pathChanged && canAnimateViews() && !reducedMotion()) {
    withViewTransition(() => flushSync(update))
  } else {
    update()
  }
  if (pathChanged) document.getElementById('main')?.scrollTo({ top: 0 })
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => apply(parse()))
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
    () => current,
  )
}

function build(path: string, query?: Record<string, string | undefined | null>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') qs.set(k, v)
  const s = qs.toString()
  return `#${path}${s ? `?${s}` : ''}`
}

export function href(path: string, query?: Record<string, string | undefined | null>): string {
  return build(path, query)
}

export function navigate(path: string, query?: Record<string, string | undefined | null>): void {
  location.hash = build(path, query)
}

/** Atualiza a query sem criar uma entrada nova no histórico. */
export function replaceQuery(patch: Record<string, string | undefined | null>): void {
  const merged: Record<string, string | undefined | null> = Object.fromEntries(current.query.entries())
  Object.assign(merged, patch)
  const url = build(current.path, merged)
  history.replaceState(history.state, '', url)
  apply(parse())
}
