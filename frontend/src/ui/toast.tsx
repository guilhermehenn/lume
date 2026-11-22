// Avisos rápidos no rodapé ("Despesa salva", "Banco excluído · Desfazer").
//
// Ficam num portal direto no <body>, fora da árvore do app: com uma folha aberta, o Headless UI
// deixa a árvore do app inerte (sem clique e escondida dos leitores de tela). Assim o "Desfazer"
// funciona mesmo com o formulário aberto ("Salvar e criar outro"), o aviso é lido em voz alta e o
// clique no aviso não conta como "clique fora" (a folha não fecha).

import { useEffect, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { LuCircleAlert, LuCircleCheck, LuInfo, LuX } from 'react-icons/lu'
import { cn } from '../lib/cn'

export type ToastTone = 'success' | 'error' | 'info'

export interface ToastItem {
  id: number
  tone: ToastTone
  message: string
  action?: { label: string; onClick: () => void }
  leaving?: boolean
}

let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const timers = new Map<number, number>()

function remove(id: number) {
  items = items.map((t) => (t.id === id ? { ...t, leaving: true } : t))
  emit()
  window.setTimeout(() => {
    items = items.filter((t) => t.id !== id)
    emit()
  }, 220)
  window.clearTimeout(timers.get(id))
  timers.delete(id)
}

export function toast(message: string, options: { tone?: ToastTone; action?: ToastItem['action']; duration?: number } = {}): number {
  const id = nextId++
  const item: ToastItem = { id, tone: options.tone ?? 'success', message, action: options.action }
  items = [...items.slice(-2), item]
  emit()
  const duration = options.duration ?? (options.action ? 7000 : options.tone === 'error' ? 6000 : 3200)
  timers.set(id, window.setTimeout(() => remove(id), duration))
  return id
}

type ToastOptions = { action?: ToastItem['action']; duration?: number }
toast.error = (message: string, options: ToastOptions = {}) => toast(message, { ...options, tone: 'error' })
toast.info = (message: string, options: ToastOptions = {}) => toast(message, { ...options, tone: 'info' })
toast.dismiss = remove

function useToasts() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => items,
    () => items,
  )
}

const TONE_ICON = { success: LuCircleCheck, error: LuCircleAlert, info: LuInfo }
const TONE_COLOR = { success: 'text-income', error: 'text-expense', info: 'text-accent' }

export function Toaster({ closeLabel }: { closeLabel: string }) {
  const list = useToasts()
  useEffect(() => () => timers.forEach((t) => window.clearTimeout(t)), [])
  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex flex-col items-center gap-2 px-4 max-sm:top-3 max-sm:bottom-auto"
      aria-live="polite"
      role="status"
      data-toaster=""
    >
      {list.map((item) => {
        const Icon = TONE_ICON[item.tone]
        return (
          <div
            key={item.id}
            className={cn(
              'glass pointer-events-auto flex max-w-[min(32rem,100%)] items-center gap-3 rounded-full py-2.5 pr-2.5 pl-4 text-[14px] shadow-card ring-1 ring-sep/60',
              item.leaving ? 'opacity-0 transition-all duration-200 ease-out translate-y-2 scale-95' : 'fx-toast',
            )}
            role={item.tone === 'error' ? 'alert' : undefined}
          >
            <Icon className={cn('size-4 shrink-0', TONE_COLOR[item.tone])} aria-hidden />
            <span className="min-w-0 flex-1 font-medium">{item.message}</span>
            {item.action && (
              <button
                type="button"
                className="rounded-full bg-fill px-3 py-1 font-semibold text-accent transition-colors hover:bg-fill-2 active:scale-95"
                onClick={() => {
                  item.action!.onClick()
                  remove(item.id)
                }}
              >
                {item.action.label}
              </button>
            )}
            <button
              type="button"
              className="grid size-6 place-items-center rounded-full text-label-3 transition-colors hover:bg-fill hover:text-label"
              onClick={() => remove(item.id)}
              aria-label={closeLabel}
            >
              <LuX className="size-3.5" aria-hidden />
            </button>
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
