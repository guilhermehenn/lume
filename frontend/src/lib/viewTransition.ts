// Animação entre páginas e temas com View Transitions, quando o navegador tem.

interface ViewTransition {
  ready: Promise<void>
  finished: Promise<void>
  updateCallbackDone: Promise<void>
}

type WithTransitions = Document & { startViewTransition?: (update: () => void) => ViewTransition }

/** Navegar de novo no meio de uma animação cancela a anterior: isso não é erro. */
function ignoreSkipped(error: unknown): void {
  if (!(error instanceof DOMException && error.name === 'AbortError')) throw error
}

export function canAnimateViews(): boolean {
  return typeof (document as WithTransitions).startViewTransition === 'function'
}

/**
 * Roda `update` dentro de uma View Transition. Sem o recurso, roda direto. Uma transição
 * interrompida por outra (clicar rápido entre páginas, voltar no navegador) rejeitava as
 * promessas da transição e aparecia como erro não tratado na página.
 */
export function withViewTransition(update: () => void): void {
  const doc = document as WithTransitions
  if (!doc.startViewTransition) {
    update()
    return
  }
  const transition = doc.startViewTransition(update)
  transition.ready.catch(ignoreSkipped)
  transition.finished.catch(ignoreSkipped)
  transition.updateCallbackDone.catch(ignoreSkipped)
}
