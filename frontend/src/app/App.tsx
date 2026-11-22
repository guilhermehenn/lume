// Raiz do app: tema, idioma, atalhos de teclado, rotas, folha de lançamento e avisos.

import { useEffect } from 'react'
import { start, useSession } from '../data/session'
import { getSettings, onStoreError, updateSettings, useSettings } from '../data/store'
import type { Theme } from '../data/types'
import { useI18n } from '../i18n'
import { Account } from '../screens/Account'
import { Banks } from '../screens/banks/Banks'
import { Categories } from '../screens/categories/Categories'
import { EntrySheet } from '../screens/entry/EntrySheet'
import { Export } from '../screens/Export'
import { Home } from '../screens/home/Home'
import { Investments } from '../screens/investments/Investments'
import { Print } from '../screens/Print'
import { Reports } from '../screens/reports/Reports'
import { Settings } from '../screens/Settings'
import { Gate } from '../screens/gate/Gate'
import { focusTransactionsSearch, Transactions } from '../screens/transactions/Transactions'
import { EmptyState } from '../ui/primitives'
import { Toaster, toast } from '../ui/toast'
import { openNewEntry } from './entrySheet'
import { Layout } from './Layout'
import { navigate, useRoute } from './router'
import { canAnimateViews, withViewTransition } from '../lib/viewTransition'

const darkQuery = () => window.matchMedia?.('(prefers-color-scheme: dark)')

export function resolveTheme(theme: Theme): 'dark' | 'light' {
  if (theme === 'system') return darkQuery()?.matches === false ? 'light' : 'dark'
  return theme
}

export function applyTheme(theme: Theme, animate = false): void {
  const resolved = resolveTheme(theme)
  const root = document.documentElement
  const update = () => {
    root.classList.toggle('dark', resolved === 'dark')
    root.classList.toggle('light', resolved === 'light')
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#000000' : '#f2f2f7')
  }
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (animate && canAnimateViews() && !reduced && root.classList.contains(resolved === 'dark' ? 'light' : 'dark')) {
    withViewTransition(update)
  } else {
    update()
  }
}

function useTheme(theme: Theme) {
  useEffect(() => {
    applyTheme(theme, true)
    if (theme !== 'system') return
    const query = darkQuery()
    const onChange = () => applyTheme('system', true)
    query?.addEventListener('change', onChange)
    return () => query?.removeEventListener('change', onChange)
  }, [theme])
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  // Campo de uma folha que está fechando (salvou e já apertou N): o foco ainda está nele, mas não
  // é mais digitação.
  if (el?.closest?.('[data-leave]')) return false
  return Boolean(el?.closest?.('input, textarea, select, [contenteditable="true"], [role="listbox"], [role="menu"]'))
}

/** Há diálogo aberto? Os que estão fechando (animação de saída, data-leave) não contam. */
function hasOpenDialog(): boolean {
  return [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some((d) => !d.querySelector('[data-leave]'))
}

function useShortcuts() {
  const route = useRoute()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return
      if (hasOpenDialog()) return
      const key = e.key.toLowerCase()
      if (key === 'n') {
        e.preventDefault()
        openNewEntry()
      } else if (key === '/') {
        e.preventDefault()
        if (route.path !== '/transactions') navigate('/transactions')
        focusTransactionsSearch()
      } else if (key === 'h') {
        e.preventDefault()
        updateSettings({ hideValues: !getSettings().hideValues })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [route.path])
}

function Screen({ path }: { path: string }) {
  const { t } = useI18n()
  switch (path) {
    case '/':
      return <Home />
    case '/transactions':
      return <Transactions />
    case '/investments':
      return <Investments />
    case '/banks':
      return <Banks />
    case '/categories':
      return <Categories />
    case '/reports':
      return <Reports />
    case '/export':
      return <Export />
    case '/settings':
      return <Settings />
    case '/account':
      return <Account />
    case '/print':
      return <Print />
    default:
      return <EmptyState title={t('errors.pageNotFound')} action={<a className="font-semibold text-accent" href="#/">{t('nav.home')}</a>} />
  }
}

/** O app com um cofre aberto: barra lateral, telas, atalhos e a folha de lançamento. */
function Shell() {
  const route = useRoute()
  useShortcuts()
  return (
    <>
      <Layout>
        <div key={route.path}>
          <Screen path={route.path} />
        </div>
      </Layout>
      <EntrySheet />
    </>
  )
}

export function App() {
  const settings = useSettings()
  const session = useSession()
  const i18n = useI18n()
  const { t } = i18n

  useTheme(settings.theme)

  useEffect(() => {
    void start()
  }, [])

  useEffect(() => {
    document.documentElement.lang = i18n.locale
  }, [i18n.locale])

  useEffect(
    () =>
      onStoreError((code) => {
        if (code === 'offline') toast.error(t('sync.offlineToast'), { duration: 8000 })
        else if (code === 'online') toast(t('sync.online'))
        else if (code === 'conflict') toast.info(t('sync.conflict'))
        else toast.error(t('sync.saveFailed'), { duration: 8000 })
      }),
    [t],
  )

  return (
    <>
      {session.status === 'open' ? <Shell /> : <Gate />}
      <Toaster closeLabel={t('common.close')} />
    </>
  )
}
