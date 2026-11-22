// Estrutura: barra lateral translúcida (desktop) ou barra superior com gaveta (telas estreitas).

import { Dialog, DialogBackdrop, DialogPanel, Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { useState, type ReactNode } from 'react'
import {
  LuArrowLeftRight,
  LuChartColumn,
  LuChevronsUpDown,
  LuCircleUser,
  LuCloudOff,
  LuLogOut,
  LuRepeat,
  LuChartNoAxesCombined,
  LuDownload,
  LuEye,
  LuEyeOff,
  LuHouse,
  LuLandmark,
  LuMenu,
  LuMinus,
  LuPlus,
  LuSettings,
  LuShapes,
  LuTrendingUp,
  LuX,
} from 'react-icons/lu'
import { cn } from '../lib/cn'
import { fullName, useAccount, useVault } from '../data/session'
import { updateSettings, useSettings, useSyncStatus } from '../data/store'
import { useI18n, type TKey } from '../i18n'
import { Avatar, initialsOf } from '../ui/Avatar'
import { openNewEntry, type EntryKind } from './entrySheet'
import { leave, LeaveDialog } from './leave'
import { href, navigate, useRoute } from './router'

const NAV: { path: string; key: TKey; icon: typeof LuHouse }[] = [
  { path: '/', key: 'nav.home', icon: LuHouse },
  { path: '/transactions', key: 'nav.transactions', icon: LuArrowLeftRight },
  { path: '/investments', key: 'nav.investments', icon: LuChartNoAxesCombined },
  { path: '/banks', key: 'nav.banks', icon: LuLandmark },
  { path: '/categories', key: 'nav.categories', icon: LuShapes },
  { path: '/reports', key: 'nav.reports', icon: LuChartColumn },
  { path: '/export', key: 'nav.export', icon: LuDownload },
  { path: '/settings', key: 'nav.settings', icon: LuSettings },
]

export function LumeMark({ className }: { className?: string }) {
  return (
    <span className={cn('relative grid size-8 place-items-center', className)} aria-hidden>
      <span className="fx-glow absolute inset-[-6px] rounded-full bg-[radial-gradient(circle,rgba(255,214,10,0.45),transparent_65%)]" />
      <span className="relative size-5 rounded-full bg-[radial-gradient(circle_at_38%_34%,#FFF6D6_0%,#FFD60A_35%,#FF9F0A_75%,#FF6B00_100%)] shadow-[0_0_14px_rgba(255,159,10,0.55)]" />
      <span className="absolute inset-0 rounded-full ring-[1.5px] ring-gold/30" />
    </span>
  )
}

function NewMenu({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n()
  const items: { kind: EntryKind; label: string; icon: ReactNode }[] = [
    { kind: 'expense', label: t('nav.newExpense'), icon: <LuMinus className="size-3.5" /> },
    { kind: 'income', label: t('nav.newIncome'), icon: <LuPlus className="size-3.5" /> },
    { kind: 'investment', label: t('nav.newInvestment'), icon: <LuTrendingUp className="size-3.5" /> },
  ]
  const tones: Record<EntryKind, string> = { expense: 'bg-expense', income: 'bg-income', investment: 'bg-invest' }
  return (
    <Menu>
      <MenuButton
        className={cn(
          'flex cursor-pointer items-center gap-2.5 rounded-xl bg-accent font-semibold text-white shadow-[0_1px_0_rgba(255,255,255,0.2)_inset,0_6px_18px_color-mix(in_oklab,var(--lume-accent)_35%,transparent)] transition-[filter,transform] duration-150 hover:brightness-110 active:scale-[0.97] data-open:brightness-110',
          compact ? 'size-10 justify-center' : 'h-11 w-full justify-start px-3.5 text-[15.5px]',
        )}
        aria-label={t('nav.new')}
      >
        <LuPlus className="size-[18px] shrink-0" strokeWidth={2.4} aria-hidden />
        {!compact && (
          <>
            <span>{t('nav.new')}</span>
            <kbd className="ml-auto rounded-md bg-white/20 px-1.5 py-px font-sans text-[12px] font-semibold">N</kbd>
          </>
        )}
      </MenuButton>
      <MenuItems
        anchor={compact ? 'bottom end' : 'bottom start'}
        transition
        className="glass z-[70] w-(--button-width) min-w-52 rounded-xl p-1 shadow-[0_16px_48px_rgba(0,0,0,0.35)] ring-1 ring-sep/60 [--anchor-gap:8px] origin-top transition duration-200 ease-apple outline-none data-closed:scale-95 data-closed:opacity-0"
      >
        {items.map((item) => (
          <MenuItem key={item.kind}>
            <button
              type="button"
              onClick={() => openNewEntry(item.kind)}
              className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[15.5px] font-medium data-focus:bg-accent data-focus:text-white"
            >
              <span className={cn('grid size-7 place-items-center rounded-full text-white', tones[item.kind])}>{item.icon}</span>
              {item.label}
            </button>
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  )
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n()
  const route = useRoute()
  return (
    <nav aria-label={t('nav.menu')} className="flex flex-col gap-1">
      {NAV.map((item, i) => {
        const active = route.path === item.path
        const Icon = item.icon
        return (
          <a
            key={item.path}
            href={href(item.path)}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'fx-slide group flex h-10 items-center gap-3 rounded-[10px] px-3 text-[15.5px] font-medium transition-colors duration-150',
              active ? 'bg-fill text-label' : 'text-label-2 hover:bg-fill-2 hover:text-label',
            )}
            style={{ animationDelay: `${60 + i * 25}ms` }}
          >
            <Icon className={cn('size-5 shrink-0 transition-colors', active ? 'text-accent' : 'text-label-3 group-hover:text-label-2')} aria-hidden />
            {t(item.key)}
          </a>
        )
      })}
    </nav>
  )
}

function PrivacyToggle({ withLabel = true }: { withLabel?: boolean }) {
  const { t } = useI18n()
  const { hideValues } = useSettings()
  const Icon = hideValues ? LuEyeOff : LuEye
  const label = hideValues ? t('nav.showValues') : t('nav.hideValues')
  return (
    <button
      type="button"
      onClick={() => updateSettings({ hideValues: !hideValues })}
      aria-label={label}
      title={`${label} (H)`}
      className={cn(
        'flex h-10 items-center gap-3 rounded-[10px] px-3 text-[15px] font-medium text-label-2 transition-colors hover:bg-fill-2 hover:text-label',
        !withLabel && 'size-10 justify-center px-0',
      )}
    >
      <Icon className="size-5" aria-hidden />
      {withLabel && label}
    </button>
  )
}

function SyncIndicator() {
  const { t } = useI18n()
  const sync = useSyncStatus()
  return (
    <p className="flex h-6 items-center gap-2 px-2.5 text-[12.5px] text-label-3" role="status" aria-live="polite">
      {sync === 'offline' ? (
        <>
          <LuCloudOff className="size-3.5 text-warn" aria-hidden />
          <span className="text-warn">{t('sync.offline')}</span>
        </>
      ) : (
        <>
          <span className={cn('size-1.5 rounded-full transition-colors duration-300', sync === 'saving' ? 'animate-pulse bg-accent' : 'bg-income')} aria-hidden />
          {sync === 'saving' ? t('sync.saving') : t('sync.saved')}
        </>
      )}
    </p>
  )
}

/** Dono e cofre na base da barra lateral, com o menu Minha conta · Trocar de cofre · Sair. */
function AccountMenu({ onNavigate, compact = false }: { onNavigate?: () => void; compact?: boolean }) {
  const { t } = useI18n()
  const account = useAccount()
  const vault = useVault()
  const route = useRoute()
  if (!account || !vault) return null
  const initials = initialsOf(account.firstName, account.lastName)
  const itemClass = 'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-medium data-focus:bg-accent data-focus:text-white'
  return (
    <Menu>
      <MenuButton
        aria-label={t('nav.accountMenu')}
        className={cn(
          'group flex items-center gap-3 rounded-xl text-left transition-colors duration-150 hover:bg-fill-2 data-open:bg-fill-2',
          compact ? 'size-10 justify-center' : 'w-full px-2 py-2',
          route.path === '/account' && !compact && 'bg-fill',
        )}
      >
        <Avatar photo={account.photo} initials={initials} size={compact ? 'sm' : 'md'} />
        {!compact && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold">{fullName(account)}</span>
              <span className="block truncate text-[12.5px] text-label-2">{vault.name}</span>
            </span>
            <LuChevronsUpDown className="size-4 shrink-0 text-label-3 group-hover:text-label-2" aria-hidden />
          </>
        )}
      </MenuButton>
      <MenuItems
        anchor={compact ? 'bottom end' : 'top start'}
        transition
        className="glass z-[70] w-(--button-width) min-w-60 rounded-xl p-1 shadow-[0_16px_48px_rgba(0,0,0,0.35)] ring-1 ring-sep/60 [--anchor-gap:8px] transition duration-200 ease-apple outline-none data-closed:scale-95 data-closed:opacity-0"
      >
        <div className="px-3 pt-2 pb-2.5">
          <p className="truncate text-[14px] font-semibold">{fullName(account)}</p>
          <p className="truncate text-[12.5px] text-label-2">{account.email}</p>
          {/* No celular, o nome do cofre só aparece aqui. */}
          <p className="mt-0.5 truncate text-[12.5px] text-label-3">{t('nav.currentVault', { name: vault.name })}</p>
        </div>
        <div className="my-1 h-px bg-sep/60" />
        <MenuItem>
          <button
            type="button"
            className={itemClass}
            onClick={() => {
              onNavigate?.()
              navigate('/account')
            }}
          >
            <LuCircleUser className="size-[18px]" aria-hidden />
            {t('nav.account')}
          </button>
        </MenuItem>
        <MenuItem>
          <button type="button" className={itemClass} onClick={() => void leave('switch')}>
            <LuRepeat className="size-[18px]" aria-hidden />
            {t('nav.switchVault')}
          </button>
        </MenuItem>
        <MenuItem>
          <button type="button" className={itemClass} onClick={() => void leave('logout')}>
            <LuLogOut className="size-[18px]" aria-hidden />
            {t('nav.signOut')}
          </button>
        </MenuItem>
      </MenuItems>
    </Menu>
  )
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-4 pt-6 pb-4">
      <a href={href('/')} onClick={onNavigate} className="flex items-center gap-2.5 px-2">
        <LumeMark />
        <span className="text-[23px] font-semibold tracking-[-0.02em]">Lume</span>
      </a>
      <NewMenu />
      <NavList onNavigate={onNavigate} />
      <div className="mt-auto flex flex-col gap-1.5">
        <PrivacyToggle />
        <SyncIndicator />
        <div className="mt-1 border-t border-sep/50 pt-2.5">
          <AccountMenu onNavigate={onNavigate} />
        </div>
      </div>
    </div>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const [drawer, setDrawer] = useState(false)
  return (
    <div className="flex h-dvh overflow-hidden">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[80] focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-white">
        {t('nav.skipToContent')}
      </a>
      <div
        aria-hidden
        className="pointer-events-none fixed -top-56 left-[18%] -z-0 size-[720px] rounded-full bg-[radial-gradient(circle,var(--lume-glow),transparent_62%)] blur-2xl"
      />
      <aside className="glass relative z-10 hidden w-[276px] shrink-0 border-r border-sep/50 lg:block">
        <SidebarContent />
      </aside>

      <div className="relative z-[1] flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-sep/50 px-3 lg:hidden">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label={t('nav.menu')}
            className="grid size-9 place-items-center rounded-lg text-label-2 hover:bg-fill-2 hover:text-label"
          >
            <LuMenu className="size-5" aria-hidden />
          </button>
          <a href={href('/')} className="flex items-center gap-2">
            <LumeMark className="scale-90" />
            <span className="text-[18.5px] font-semibold tracking-tight">Lume</span>
          </a>
          <div className="ml-auto flex items-center gap-1">
            <PrivacyToggle withLabel={false} />
            <NewMenu compact />
            <AccountMenu compact />
          </div>
        </header>

        <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
          <div className="mx-auto w-full max-w-[1320px] px-4 pt-6 pb-24 sm:px-6 lg:px-12 lg:pt-10">{children}</div>
        </main>
      </div>

      <LeaveDialog />
      <Dialog open={drawer} onClose={setDrawer} className="relative z-50 lg:hidden">
        <DialogBackdrop transition className="fixed inset-0 bg-black/45 transition-opacity duration-300 data-closed:opacity-0" />
        <DialogPanel
          transition
          className="glass fixed inset-y-0 left-0 w-[290px] border-r border-sep/50 shadow-2xl transition duration-300 ease-apple data-closed:-translate-x-full"
        >
          <button
            type="button"
            onClick={() => setDrawer(false)}
            aria-label={t('common.close')}
            className="absolute top-4 right-3 grid size-8 place-items-center rounded-full text-label-2 hover:bg-fill-2"
          >
            <LuX className="size-4" aria-hidden />
          </button>
          <SidebarContent onNavigate={() => setDrawer(false)} />
        </DialogPanel>
      </Dialog>
    </div>
  )
}
