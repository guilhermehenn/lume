// Criar cofre em 3 passos (cofre e dono → senha → como começar) e, no fim, o código de
// recuperação, que só aparece uma vez.

import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { LuCheck, LuDatabase, LuInfo, LuPlus, LuSparkles, LuTriangleAlert } from 'react-icons/lu'
import { ApiError } from '../../api/client'
import { vaultApi, type SessionWithCode } from '../../api/vault'
import { createSeedData } from '../../data/model'
import { markLegacyImported, readLegacy, type LegacyData } from '../../data/prefs'
import { createSampleData } from '../../data/sample'
import { openCreated } from '../../data/session'
import { getSettings } from '../../data/store'
import { useI18n } from '../../i18n'
import { cn } from '../../lib/cn'
import { isValidEmail, suggestEmail } from '../../lib/password'
import { Field, focusFirstInvalid, PasswordField, passwordError, StrengthMeter } from '../../ui/fields'
import { Button, Spinner } from '../../ui/primitives'
import { toast } from '../../ui/toast'
import { gateError } from './errors'
import { RecoveryCodeCard } from './RecoveryCodeCard'

type StartWith = 'legacy' | 'sample' | 'empty'
type Errors = Partial<Record<'name' | 'firstName' | 'email' | 'password' | 'confirm', string>>

/** Mesma comparação do servidor: sem diferenciar maiúsculas, acentos e espaços extras. */
export function foldName(name: string): string {
  return name.normalize('NFKD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

export function CreateWizard({ first, existingNames, onCancel }: { first: boolean; existingNames: string[]; onCancel?: () => void }) {
  const { t } = useI18n()
  const legacy = useMemo<LegacyData | null>(() => readLegacy(), [])
  const [legacyFirst, ...legacyRest] = (legacy?.settings.name ?? '').trim().split(/\s+/)
  const [step, setStep] = useState(1)
  const [name, setName] = useState(() => (existingNames.length === 0 ? t('create.vaultNameDefault') : ''))
  const [firstName, setFirstName] = useState(legacyFirst ?? '')
  const [lastName, setLastName] = useState(legacyRest.join(' '))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [startWith, setStartWith] = useState<StartWith>(legacy && legacy.entries > 0 && !legacy.importedTo ? 'legacy' : 'empty')
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [created, setCreated] = useState<SessionWithCode | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  // Trava síncrona contra clique duplo (o estado "busy" só muda na próxima renderização).
  const submitting = useRef(false)
  const taken = useMemo(() => new Set(existingNames.map(foldName)), [existingNames])
  const suggestion = email && isValidEmail(email) ? suggestEmail(email) : null
  /** Ao corrigir um campo, o erro dele some (e a dica volta a aparecer). */
  const clearError = (key: keyof Errors) => setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current))

  const validate = (which: number): boolean => {
    const next: Errors = {}
    if (which === 1) {
      if (!name.trim()) next.name = t('create.errors.name')
      else if (taken.has(foldName(name))) next.name = t('create.errors.nameTaken')
      if (!firstName.trim()) next.firstName = t('create.errors.firstName')
      if (!isValidEmail(email)) next.email = t('create.errors.email')
    } else if (which === 2) {
      next.password = passwordError(password, t)
      if (!next.password && confirm !== password) next.confirm = t('create.errors.mismatch')
    }
    setErrors(next)
    const ok = Object.values(next).every((v) => !v)
    if (!ok) focusFirstInvalid(formRef.current)
    return ok
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting.current) return
    if (step < 3) {
      if (validate(step)) {
        setErrors({})
        setStep(step + 1)
      }
      return
    }
    submitting.current = true
    setBusy(true)
    setFailure(undefined)
    const prefs = getSettings()
    const fromLegacy = startWith === 'legacy' && legacy
    const data = fromLegacy ? legacy.data : startWith === 'sample' ? createSampleData() : createSeedData()
    const legacySettings = fromLegacy ? legacy.settings : {}
    try {
      const info = await vaultApi.create({
        name: name.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        password,
        data,
        settings: {
          language: prefs.language,
          theme: prefs.theme,
          currency: legacySettings.currency ?? prefs.currency,
          hideValues: legacySettings.hideValues ?? false,
          // Com dados importados ou de exemplo, as boas-vindas (banco principal e saldo) não fazem sentido.
          onboardingDone: startWith !== 'empty',
        },
      })
      if (fromLegacy) markLegacyImported(info.vault.id)
      // A senha não fica na memória da tela depois de criar.
      setPassword('')
      setConfirm('')
      setCreated(info)
    } catch (err) {
      const code = err instanceof ApiError ? err.code : ''
      if (code === 'name-taken' || code === 'invalid-name') {
        setErrors({ name: code === 'name-taken' ? t('create.errors.nameTaken') : t('create.errors.name') })
        setStep(1)
      } else if (code === 'invalid-email' || code === 'invalid-first-name') {
        setErrors(code === 'invalid-email' ? { email: t('create.errors.email') } : { firstName: t('create.errors.firstName') })
        setStep(1)
      } else if (code.startsWith('weak-password')) {
        setErrors({ password: t('create.errors.passwordShort') })
        setStep(2)
      } else {
        setFailure(gateError(err, t))
      }
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  if (created) {
    return (
      <section className="fx-pop w-full max-w-[480px] rounded-[26px] bg-surface p-7 shadow-card ring-1 ring-sep/50 sm:p-8" aria-label={t('recovery.title')}>
        <RecoveryCodeCard
          code={created.recoveryCode}
          vaultName={created.vault.name}
          email={created.account.email}
          continueLabel={t('recovery.enter')}
          onContinue={async () => {
            const recovery = await vaultApi.confirmRecoveryCode().catch(() => created.account.recovery)
            await openCreated({ ...created, account: { ...created.account, recovery } }, created.account.email)
            toast(t('create.created', { name: created.vault.name }))
          }}
        />
      </section>
    )
  }

  const steps = [t('create.stepVault'), t('create.stepPassword'), t('create.stepData')]

  return (
    <section className="fx-pop w-full max-w-[520px]" aria-labelledby="create-title">
      {first && (
        <header className="mb-7 text-center">
          <h1 className="text-[32px] font-bold tracking-[-0.025em]">{t('gate.welcomeTitle')}</h1>
          <p className="mx-auto mt-2 max-w-md text-[16px] text-label-2">{t('gate.welcomeBody')}</p>
        </header>
      )}
      <form ref={formRef} onSubmit={submit} noValidate className="rounded-[26px] bg-surface p-7 shadow-card ring-1 ring-sep/50 sm:p-8">
        <div className="mb-6">
          <p className="text-[13px] font-medium tracking-wide text-label-3 uppercase">{t('create.step', { step, total: 3 })}</p>
          <h2 id="create-title" className="mt-1 text-[23px] font-bold tracking-[-0.02em]">
            {steps[step - 1]}
          </h2>
          <div className="mt-4 flex gap-1.5" aria-hidden>
            {[1, 2, 3].map((s) => (
              <span key={s} className={cn('h-1 flex-1 rounded-full transition-colors duration-500 ease-apple', s <= step ? 'bg-accent' : 'bg-fill')} />
            ))}
          </div>
        </div>

        {step === 1 && (
          <div key="s1" className="fx-rise space-y-4">
            <Field
              label={t('create.vaultName')}
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                clearError('name')
              }}
              placeholder={t('create.vaultNamePlaceholder')}
              maxLength={60}
              error={errors.name}
              autoFocus={!name}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t('create.firstName')}
                value={firstName}
                onChange={(e) => {
                setFirstName(e.target.value)
                clearError('firstName')
              }}
                maxLength={40}
                autoComplete="given-name"
                autoCapitalize="words"
                error={errors.firstName}
                autoFocus={Boolean(name) && !firstName}
              />
              <Field label={t('create.lastName')} value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={60} autoComplete="family-name" autoCapitalize="words" />
            </div>
            <Field
              label={t('create.email')}
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                clearError('email')
              }}
              maxLength={254}
              autoFocus={Boolean(name) && Boolean(firstName)}
              hint={
                suggestion ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEmail(suggestion)
                      clearError('email')
                    }}
                    className="font-medium text-accent hover:underline"
                  >
                    {t('create.emailSuggestion', { email: suggestion })}
                  </button>
                ) : (
                  t('create.emailHint')
                )
              }
              error={errors.email}
            />
          </div>
        )}

        {step === 2 && (
          <div key="s2" className="fx-rise space-y-4">
            {/* Para o gerenciador de senhas guardar a senha junto do e-mail certo. */}
            <input type="email" autoComplete="username" value={email} readOnly hidden />
            <div>
              <PasswordField label={t('create.password')} autoComplete="new-password" value={password} onChange={(e) => {
                setPassword(e.target.value)
                clearError('password')
              }} maxLength={200} error={errors.password} hint={t('create.passwordHint')} autoFocus />
              <StrengthMeter password={password} />
            </div>
            <PasswordField label={t('create.confirm')} autoComplete="new-password" value={confirm} onChange={(e) => {
                setConfirm(e.target.value)
                clearError('confirm')
              }} maxLength={200} error={errors.confirm} />
            <p className="flex gap-2 rounded-2xl bg-fill-2 px-4 py-3 text-[13.5px] text-label-2">
              <LuInfo className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
              <span>{t('create.privacyNote')}</span>
            </p>
          </div>
        )}

        {step === 3 && (
          <fieldset key="s3" className="fx-rise space-y-2.5">
            <legend className="sr-only">{t('create.stepData')}</legend>
            {legacy && legacy.entries + legacy.data.banks.length > 0 && (
              <StartOption
                value="legacy"
                current={startWith}
                onChange={setStartWith}
                icon={<LuDatabase />}
                tint="bg-warn"
                title={t('create.legacy')}
                description={`${t('create.legacyDesc', { entries: legacy.entries, banks: legacy.data.banks.length, categories: legacy.data.categories.length })}${legacy.importedTo ? ` ${t('create.legacyDone')}` : ''}`}
              />
            )}
            <StartOption value="empty" current={startWith} onChange={setStartWith} icon={<LuPlus />} tint="bg-accent" title={t('create.empty')} description={t('create.emptyDesc')} />
            <StartOption value="sample" current={startWith} onChange={setStartWith} icon={<LuSparkles />} tint="bg-invest" title={t('create.sample')} description={t('create.sampleDesc')} />
          </fieldset>
        )}

        {failure && (
          <p className="mt-4 flex items-center gap-2 text-[14px] font-medium text-expense" role="alert">
            <LuTriangleAlert className="size-4 shrink-0" aria-hidden />
            {failure}
          </p>
        )}

        <div className="mt-7 flex items-center gap-2">
          {step > 1 ? (
            <Button size="lg" onClick={() => setStep(step - 1)} disabled={busy}>
              {t('create.back')}
            </Button>
          ) : onCancel ? (
            <Button size="lg" variant="ghost" onClick={onCancel}>
              {t('create.cancel')}
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button type="submit" variant="primary" size="lg" disabled={busy} className="min-w-36">
            {busy ? <Spinner /> : step === 3 ? <LuCheck className="size-4" aria-hidden /> : null}
            {busy ? t('create.creating') : step === 3 ? t('create.submit') : t('create.next')}
          </Button>
        </div>
      </form>
    </section>
  )
}

function StartOption({
  value,
  current,
  onChange,
  icon,
  tint,
  title,
  description,
}: {
  value: StartWith
  current: StartWith
  onChange: (value: StartWith) => void
  icon: ReactNode
  tint: string
  title: string
  description: string
}) {
  const checked = value === current
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3.5 rounded-2xl p-4 ring-1 transition-[background-color,box-shadow] duration-200 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent',
        checked ? 'bg-accent/10 ring-2 ring-accent' : 'bg-fill-2 ring-sep/50 hover:bg-fill',
      )}
    >
      <input type="radio" name="start-with" value={value} checked={checked} onChange={() => onChange(value)} className="sr-only" />
      <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl text-white [&>svg]:size-5', tint)} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-semibold tracking-tight">{title}</span>
        <span className="mt-0.5 block text-[14px] text-label-2">{description}</span>
      </span>
      <span className={cn('mt-1 grid size-[22px] shrink-0 place-items-center rounded-full ring-[1.5px] transition-colors', checked ? 'bg-accent text-white ring-accent' : 'ring-label-3')} aria-hidden>
        {checked && <LuCheck className="size-3.5" strokeWidth={3} />}
      </span>
    </label>
  )
}
