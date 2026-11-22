// Entrada do app: escolher um cofre, entrar com e-mail e senha ou criar um cofre novo.
// Aparece ao abrir o Lume, ao sair, ao trocar de cofre e quando a sessão expira.

import { useCallback, useEffect, useState } from 'react'
import { LuInfo, LuRefreshCw, LuWifiOff } from 'react-icons/lu'
import { vaultApi, type VaultSummary } from '../../api/vault'
import { LumeMark } from '../../app/Layout'
import { APP_VERSION } from '../../app/version'
import { start, useSession, type LockReason } from '../../data/session'
import { updateSettings, useSettings } from '../../data/store'
import type { Language } from '../../data/types'
import { useI18n, type TKey } from '../../i18n'
import { cn } from '../../lib/cn'
import { Button, Spinner } from '../../ui/primitives'
import { CreateWizard } from './CreateWizard'
import { LoginPanel } from './LoginPanel'
import { VaultList } from './VaultList'

export function Gate() {
  const session = useSession()
  return (
    <div
      className="relative flex min-h-dvh flex-col items-center overflow-y-auto px-5 pt-10 pb-6 sm:pt-16"
      data-gate-ready={session.status === 'loading' ? undefined : ''}
    >
      <div
        aria-hidden
        className="pointer-events-none fixed -top-64 left-1/2 size-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,var(--lume-glow),transparent_60%)] blur-2xl"
      />
      <main className="relative w-full max-w-[880px] flex-1">
        {session.status === 'loading' ? (
          <Splash />
        ) : session.status === 'offline' ? (
          <Offline />
        ) : session.status === 'locked' ? (
          <Picker reason={session.reason} lockedVaultId={session.vaultId} />
        ) : null}
      </main>
      {session.status !== 'loading' && <GateFooter />}
    </div>
  )
}

function Brand({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-2.5', className)}>
      <LumeMark className="scale-125" />
      <span className="text-[26px] font-semibold tracking-[-0.02em]">Lume</span>
    </div>
  )
}

/** Só aparece se a abertura demorar (evita um "piscar" quando a resposta é imediata). */
function Splash() {
  const { t } = useI18n()
  return (
    <div className="fx-fade flex min-h-[60dvh] flex-col items-center justify-center gap-6 [animation-delay:350ms]" role="status">
      <LumeMark className="scale-[2.2]" />
      <p className="mt-6 text-[15px] text-label-2">{t('gate.loading')}</p>
    </div>
  )
}

function Offline({ onRetry }: { onRetry?: () => Promise<void> }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  return (
    <div className="fx-rise mx-auto flex max-w-md flex-col items-center pt-[12dvh] text-center">
      <Brand />
      <span className="mt-10 grid size-14 place-items-center rounded-2xl bg-fill text-warn">
        <LuWifiOff className="size-7" aria-hidden />
      </span>
      <h1 className="mt-5 text-[24px] font-semibold tracking-tight">{t('gate.offlineTitle')}</h1>
      <p className="mt-2 text-[15.5px] text-label-2">{t('gate.offlineBody')}</p>
      <Button
        variant="primary"
        size="lg"
        className="mt-7"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          await (onRetry ?? start)()
          setBusy(false)
        }}
      >
        {busy ? <Spinner /> : <LuRefreshCw className="size-4" aria-hidden />}
        {t('gate.retry')}
      </Button>
    </div>
  )
}

const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'pt', label: 'Português' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
]

/** Idioma antes de entrar (fica guardado neste navegador e vai para o cofre ao criá-lo). */
function GateFooter() {
  const { t } = useI18n()
  const { language } = useSettings()
  return (
    <footer className="relative mt-10 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[13px] text-label-3">
      <div role="group" aria-label={t('gate.language')} className="flex items-center gap-1">
        {LANGUAGES.map((l) => (
          <button
            key={l.value}
            type="button"
            lang={l.value}
            onClick={() => updateSettings({ language: l.value })}
            aria-pressed={language === l.value}
            className={cn('rounded-full px-2.5 py-1 transition-colors hover:bg-fill-2 hover:text-label', language === l.value && 'bg-fill-2 font-semibold text-label')}
          >
            {l.label}
          </button>
        ))}
      </div>
      <span aria-hidden>·</span>
      <span>Lume {APP_VERSION}</span>
    </footer>
  )
}

// ---------------------------------------------------------------- escolher

type Mode = { kind: 'list' } | { kind: 'login'; vault: VaultSummary } | { kind: 'create' }

function Picker({ reason, lockedVaultId }: { reason: LockReason; lockedVaultId?: string }) {
  const { t } = useI18n()
  const [vaults, setVaults] = useState<VaultSummary[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [mode, setMode] = useState<Mode>({ kind: 'list' })
  // Ao abrir e ao trocar de cofre não há o que avisar: o título já diz "Escolha um cofre".
  const [notice, setNotice] = useState<LockReason | null>(reason === 'start' || reason === 'switch' ? null : reason)

  const load = useCallback(
    async (pickDefault: boolean) => {
      setFailed(false)
      try {
        const list = await vaultApi.list()
        setVaults(list)
        if (!pickDefault) return
        const usable = list.filter((v) => v.status !== 'error' && v.status !== 'too-new')
        const locked = lockedVaultId ? usable.find((v) => v.id === lockedVaultId) : undefined
        if (list.length === 0) setMode({ kind: 'create' })
        else if (locked && (reason === 'expired' || reason === 'elsewhere' || reason === 'closedElsewhere')) setMode({ kind: 'login', vault: locked })
        // Um cofre só: vai direto para a senha (dá para voltar à lista e criar outro).
        else if (list.length === 1 && usable.length === 1 && reason === 'start') setMode({ kind: 'login', vault: usable[0] })
      } catch {
        setFailed(true)
      }
    },
    [reason, lockedVaultId],
  )

  useEffect(() => {
    void load(true)
  }, [load])

  if (failed) return <Offline onRetry={() => load(true)} />
  if (!vaults) return <Splash />

  const toList = (refresh = false) => {
    setNotice(null)
    setMode({ kind: 'list' })
    if (refresh) void load(false)
  }

  return (
    <div className="flex flex-col items-center">
      <Brand className="fx-fade mb-9" />
      {notice && (
        <p className="fx-rise mb-6 flex max-w-xl items-start gap-2.5 rounded-2xl bg-fill-2 px-4 py-3 text-[14.5px] text-label-2 ring-1 ring-sep/40" role="status">
          <LuInfo className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
          {t(`gate.reasons.${notice}` as TKey)}
        </p>
      )}
      {mode.kind === 'login' ? (
        <LoginPanel key={mode.vault.id} vault={mode.vault} onBack={() => toList()} onGone={() => toList(true)} />
      ) : mode.kind === 'create' ? (
        <CreateWizard first={vaults.length === 0} existingNames={vaults.map((v) => v.name)} onCancel={vaults.length === 0 ? undefined : () => toList()} />
      ) : (
        <VaultList vaults={vaults} onPick={(vault) => setMode({ kind: 'login', vault })} onCreate={() => setMode({ kind: 'create' })} />
      )}
    </div>
  )
}
