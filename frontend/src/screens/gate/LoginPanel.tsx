// Entrar num cofre com e-mail e senha. "Esqueci a senha" troca a senha com o código de
// recuperação (ou mostra o comando do terminal para quem não tem o código).

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { LuArrowLeft, LuKeyRound } from 'react-icons/lu'
import { ApiError } from '../../api/client'
import { vaultApi, type SessionWithCode, type VaultSummary } from '../../api/vault'
import { lastEmail } from '../../data/prefs'
import { login, openCreated } from '../../data/session'
import { useI18n } from '../../i18n'
import { isValidEmail } from '../../lib/password'
import { Avatar, initialsOf } from '../../ui/Avatar'
import { Field, focusFirstInvalid, PasswordField, passwordError, StrengthMeter } from '../../ui/fields'
import { Button, Spinner } from '../../ui/primitives'
import { toast } from '../../ui/toast'
import { gateError } from './errors'
import { RecoveryCodeCard } from './RecoveryCodeCard'

type Mode = 'login' | 'recover' | 'code'

/** Espera imposta pelo servidor depois de muitas tentativas, com contagem regressiva. */
function useCooldown() {
  const [until, setUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until <= Date.now()) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [until])
  const seconds = Math.max(0, Math.ceil((until - now) / 1000))
  const start = (err: unknown) => {
    if (err instanceof ApiError && err.retryAfter) {
      setNow(Date.now())
      setUntil(Date.now() + err.retryAfter * 1000)
    }
  }
  return { seconds, start }
}

export function LoginPanel({ vault, onBack, onGone }: { vault: VaultSummary; onBack: () => void; onGone: () => void }) {
  const { t } = useI18n()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState(() => lastEmail(vault.id))
  const [recovered, setRecovered] = useState<SessionWithCode | null>(null)
  const owner = `${vault.ownerFirstName} ${vault.ownerLastName}`.trim()

  if (mode === 'code' && recovered) {
    return (
      <section className="fx-pop w-full max-w-[460px] rounded-[26px] bg-surface p-7 shadow-card ring-1 ring-sep/50 sm:p-8" aria-label={t('recovery.title')}>
        <RecoveryCodeCard
          code={recovered.recoveryCode}
          vaultName={recovered.vault.name}
          email={recovered.account.email}
          continueLabel={t('recovery.enter')}
          onContinue={async () => {
            await vaultApi.confirmRecoveryCode().catch(() => undefined)
            await openCreated({ ...recovered, account: { ...recovered.account, recovery: { ...recovered.account.recovery, confirmed: true } } }, email)
            toast(t('account.passwordChanged'))
          }}
        />
      </section>
    )
  }

  return (
    <section className="fx-pop w-full max-w-[420px]" aria-labelledby="login-title">
      <div className="rounded-[26px] bg-surface p-7 shadow-card ring-1 ring-sep/50 sm:p-8">
        <button
          type="button"
          onClick={mode === 'login' ? onBack : () => setMode('login')}
          className="-mt-1 -ml-2 mb-3 flex h-9 items-center gap-1.5 rounded-full px-2.5 text-[14.5px] font-medium text-accent transition-colors hover:bg-fill-2"
        >
          <LuArrowLeft className="size-4" aria-hidden />
          {mode === 'login' ? t('gate.allVaults') : t('create.back')}
        </button>
        <div className="flex flex-col items-center text-center">
          <Avatar
            photo={vault.photo}
            initials={vault.initials || initialsOf(vault.ownerFirstName, vault.ownerLastName)}
            size={mode === 'login' ? 'xl' : 'lg'}
            className="shadow-[0_10px_30px_rgba(10,132,255,0.25)]"
          />
          <h1 id="login-title" className="mt-4 text-[24px] font-bold tracking-[-0.02em] break-words">
            {mode === 'login' ? vault.name : t('gate.forgotTitle')}
          </h1>
          <p className="text-[15px] text-label-2">{mode === 'login' ? owner : vault.name}</p>
          {mode === 'login' && vault.status === 'needs-update' && (
            <p className="mt-2 rounded-full bg-accent/15 px-3 py-0.5 text-[12.5px] font-medium text-accent">{t('gate.status.needs-update')}</p>
          )}
        </div>
        {mode === 'login' ? (
          <LoginForm vault={vault} email={email} setEmail={setEmail} onForgot={() => setMode('recover')} onGone={onGone} />
        ) : (
          <RecoverForm
            vault={vault}
            email={email}
            setEmail={setEmail}
            onGone={onGone}
            onDone={(info) => {
              setRecovered(info)
              setMode('code')
            }}
          />
        )}
      </div>
    </section>
  )
}

function LoginForm({
  vault,
  email,
  setEmail,
  onForgot,
  onGone,
}: {
  vault: VaultSummary
  email: string
  setEmail: (email: string) => void
  onForgot: () => void
  onGone: () => void
}) {
  const { t } = useI18n()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const cooldown = useCooldown()
  const passwordRef = useRef<HTMLInputElement>(null)
  const submitting = useRef(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting.current || cooldown.seconds > 0) return
    if (!email.trim() || !password) {
      setError(t('gate.errors.badCredentials'))
      passwordRef.current?.focus()
      return
    }
    submitting.current = true
    setBusy(true)
    setError(undefined)
    try {
      await login(vault.id, email.trim(), password)
    } catch (err) {
      submitting.current = false
      if (err instanceof ApiError && err.code === 'not-found') {
        toast.error(t('gate.errors.notFound'))
        onGone()
        return
      }
      setPassword('')
      // Com espera imposta, o próprio botão mostra a contagem; a mensagem fica só para o resto.
      setError(err instanceof ApiError && err.code === 'throttled' ? undefined : gateError(err, t))
      cooldown.start(err)
      setBusy(false)
      window.setTimeout(() => passwordRef.current?.focus(), 30)
    }
  }

  return (
    <>
      <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
        <Field
          label={t('gate.email')}
          type="email"
          inputMode="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={vault.emailHint}
          autoFocus={!email}
          maxLength={254}
        />
        <PasswordField
          ref={passwordRef}
          label={t('gate.password')}
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            setError(undefined)
          }}
          autoFocus={Boolean(email)}
          maxLength={200}
          error={error}
        />
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || cooldown.seconds > 0}>
          {busy ? <Spinner /> : <LuKeyRound className="size-4" aria-hidden />}
          {busy ? t('gate.signingIn') : cooldown.seconds > 0 ? t('gate.errors.throttled', { seconds: cooldown.seconds }) : t('gate.signIn')}
        </Button>
      </form>
      <div className="mt-4 text-center">
        <button type="button" onClick={onForgot} className="rounded-full px-3 py-1 text-[14px] font-medium text-accent transition-colors hover:bg-fill-2">
          {t('gate.forgot')}
        </button>
      </div>
    </>
  )
}

function RecoverForm({
  vault,
  email,
  setEmail,
  onDone,
  onGone,
}: {
  vault: VaultSummary
  email: string
  setEmail: (email: string) => void
  onDone: (info: SessionWithCode) => void
  onGone: () => void
}) {
  const { t } = useI18n()
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [busy, setBusy] = useState(false)
  const [noCode, setNoCode] = useState(false)
  const cooldown = useCooldown()
  const formRef = useRef<HTMLFormElement>(null)
  const submitting = useRef(false)
  const clearError = (key: string) => setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting.current || cooldown.seconds > 0) return
    const found: Record<string, string | undefined> = {}
    if (!isValidEmail(email)) found.email = t('create.errors.email')
    if (code.replace(/[^0-9a-z]/gi, '').length !== 20) found.code = t('gate.errors.badRecovery')
    found.password = passwordError(password, t)
    if (!found.password && password !== confirm) found.confirm = t('create.errors.mismatch')
    setErrors(found)
    if (Object.values(found).some(Boolean)) {
      focusFirstInvalid(formRef.current)
      return
    }
    submitting.current = true
    setBusy(true)
    try {
      const info = await vaultApi.recover(vault.id, { email: email.trim(), recoveryCode: code, newPassword: password })
      onDone(info)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'not-found') {
        onGone()
        return
      }
      setErrors({ code: gateError(err, t) })
      cooldown.start(err)
      focusFirstInvalid(formRef.current)
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return (
    <>
      <p className="mt-5 text-center text-[14.5px] text-label-2">{t('gate.recoverBody')}</p>
      <form ref={formRef} onSubmit={submit} className="mt-5 space-y-4" noValidate>
        <Field
          label={t('gate.email')}
          type="email"
          inputMode="email"
          autoComplete="username"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            clearError('email')
          }}
          placeholder={vault.emailHint}
          maxLength={254}
          error={errors.email}
        />
        <Field
          label={t('gate.recoveryCode')}
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase())
            clearError('code')
          }}
          placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          maxLength={40}
          autoFocus
          className="[&_input]:font-mono [&_input]:tracking-wider"
          error={errors.code}
        />
        <div>
          <PasswordField
            label={t('gate.newPassword')}
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              clearError('password')
            }}
            maxLength={200}
            error={errors.password}
          />
          <StrengthMeter password={password} />
        </div>
        <PasswordField
          label={t('gate.confirmPassword')}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value)
            clearError('confirm')
          }}
          maxLength={200}
          error={errors.confirm}
        />
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || cooldown.seconds > 0}>
          {busy && <Spinner />}
          {cooldown.seconds > 0 ? t('gate.errors.throttled', { seconds: cooldown.seconds }) : t('gate.recover')}
        </Button>
      </form>
      <div className="mt-4 text-center">
        <button type="button" onClick={() => setNoCode((v) => !v)} aria-expanded={noCode} className="rounded-full px-3 py-1 text-[14px] font-medium text-accent transition-colors hover:bg-fill-2">
          {t('gate.noCode')}
        </button>
      </div>
      {noCode && (
        <div className="fx-rise mt-3 rounded-2xl bg-fill-2 p-4 text-[13.5px] text-label-2">
          <p>{t('gate.forgotBody')}</p>
          <pre className="mt-2 rounded-xl bg-bg/70 px-3 py-2.5 font-mono text-[12.5px] leading-relaxed break-all whitespace-pre-wrap text-label select-all">
            {`cd backend\nuv run python -m app.cli redefinir-senha --cofre "${vault.name}"`}
          </pre>
          <p className="mt-2">{t('gate.forgotNote')}</p>
        </div>
      )}
    </>
  )
}
