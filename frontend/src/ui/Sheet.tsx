// Folha (sheet) central para formulários e diálogo de confirmação.
// Headless UI cuida do foco preso, Esc para fechar e leitores de tela.

import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import type { FormEvent, ReactNode } from 'react'
import { LuX } from 'react-icons/lu'
import { cn } from '../lib/cn'
import { Button } from './primitives'

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  onSubmit,
  size = 'md',
  closeLabel,
  headerExtra,
  initialFocus,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void
  size?: 'sm' | 'md' | 'lg'
  closeLabel: string
  headerExtra?: ReactNode
  /**
   * Campo que recebe o foco ao abrir. Sem isso, abrir uma folha enquanto a anterior ainda faz a
   * animação de saída (salvar e logo apertar N) deixava o foco no painel, e o que se digitava sumia.
   */
  initialFocus?: { readonly current: HTMLElement | null }
}) {
  const body = (
    <>
      <div className="flex items-center gap-3 border-b border-sep/50 px-6 pt-5 pb-4">
        <DialogTitle className="min-w-0 flex-1 truncate text-[18.5px] font-semibold tracking-tight">{title}</DialogTitle>
        {headerExtra}
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="grid size-8 place-items-center rounded-full bg-fill-2 text-label-2 transition-colors hover:bg-fill hover:text-label"
        >
          <LuX className="size-4" aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6">{children}</div>
      {footer && <div className="flex items-center gap-2 border-t border-sep/50 bg-surface/80 px-6 py-4">{footer}</div>}
    </>
  )
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50" initialFocus={initialFocus as { current: HTMLElement | null } | undefined}>
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-black/45 backdrop-blur-[3px] transition-opacity duration-300 ease-out data-closed:opacity-0 dark:bg-black/60"
      />
      <div className="fixed inset-0 flex items-end justify-center p-0 sm:items-center sm:p-6">
        <DialogPanel
          transition
          className={cn(
            'flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[22px] bg-surface shadow-[0_24px_80px_rgba(0,0,0,0.45)] ring-1 ring-sep/60 sm:max-h-[min(860px,92dvh)] sm:rounded-[22px]',
            'transition duration-300 ease-apple data-closed:translate-y-6 data-closed:scale-[0.98] data-closed:opacity-0 sm:data-closed:translate-y-3',
            size === 'sm' ? 'sm:max-w-lg' : size === 'lg' ? 'sm:max-w-4xl' : 'sm:max-w-2xl',
          )}
        >
          {onSubmit ? (
            <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
              {body}
            </form>
          ) : (
            body
          )}
        </DialogPanel>
      </div>
    </Dialog>
  )
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive = true,
  children,
  confirmDisabled,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: ReactNode
  body?: ReactNode
  confirmLabel: string
  cancelLabel: string
  destructive?: boolean
  children?: ReactNode
  confirmDisabled?: boolean
}) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-[55]" role="alertdialog">
      <DialogBackdrop transition className="fixed inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity duration-200 data-closed:opacity-0" />
      <div className="fixed inset-0 grid place-items-center p-6">
        <DialogPanel
          transition
          className="glass w-full max-w-[380px] rounded-[22px] p-6 text-center shadow-[0_24px_70px_rgba(0,0,0,0.45)] ring-1 ring-sep/60 transition duration-250 ease-spring data-closed:scale-90 data-closed:opacity-0"
        >
          <DialogTitle className="text-[17.5px] font-semibold tracking-tight">{title}</DialogTitle>
          {body && <div className="mt-1.5 text-[14px] text-label-2">{body}</div>}
          {children && <div className="mt-4 text-left">{children}</div>}
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button onClick={onClose} size="lg">
              {cancelLabel}
            </Button>
            <Button
              variant={destructive ? 'danger' : 'primary'}
              size="lg"
              disabled={confirmDisabled}
              onClick={() => {
                onConfirm()
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
