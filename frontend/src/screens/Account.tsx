// Minha conta: perfil (nome, sobrenome, e-mail, foto), senha de acesso ao cofre,
// e-mail para envio de relatórios e o próprio cofre (renomear, trocar, sair, excluir).

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { LuCamera, LuLifeBuoy, LuLogOut, LuMail, LuRepeat, LuSend, LuTrash2 } from 'react-icons/lu'
import { ApiError } from '../api/client'
import { vaultApi, type MailProvider, type MailSecurity } from '../api/vault'
import { mailErrorMessage } from '../app/mail'
import { useRoute } from '../app/router'
import { toISODate } from '../lib/dates'
import { resizePhoto } from '../lib/image'
import { isValidEmail } from '../lib/password'
import { leave } from '../app/leave'
import { vaultStats } from '../app/vaultStats'
import { rememberEmail } from '../data/prefs'
import { afterDelete, fullName, refreshAccount, updateAccount, updateVault, useAccount, useVault } from '../data/session'
import { updateSettings, useData, useSettings } from '../data/store'
import { useI18n, type TKey } from '../i18n'
import { cn } from '../lib/cn'
import { Avatar, initialsOf } from '../ui/Avatar'
import { Select } from '../ui/inputs'
import { Button, Group, PageHeader, Row, Spinner, Switch, TextField } from '../ui/primitives'
import { ConfirmDialog, Sheet } from '../ui/Sheet'
import { toast } from '../ui/toast'
import { passwordError, PasswordField, StrengthMeter } from '../ui/fields'
import { RecoveryCodeCard } from './gate/RecoveryCodeCard'

type T = (key: TKey, params?: Record<string, string | number>) => string

function accountError(err: unknown, t: T): string {
  const code = err instanceof ApiError ? err.code : ''
  if (code === 'bad-password') return t('account.errors.badPassword')
  if (code === 'same-password') return t('account.errors.samePassword')
  if (code === 'invalid-email') return t('create.errors.email')
  if (code === 'invalid-first-name') return t('create.errors.firstName')
  if (code === 'invalid-name') return t('create.errors.name')
  if (code === 'name-taken') return t('create.errors.nameTaken')
  if (code === 'invalid-photo') return t('create.errors.photo')
  if (code === 'photo-too-big') return t('create.errors.photoTooBig')
  if (code.startsWith('weak-password')) return t('create.errors.passwordShort')
  if (err instanceof ApiError && err.status === 0) return t('sync.offline')
  return t('errors.generic')
}

export function Account() {
  const { t } = useI18n()
  const route = useRoute()
  const mailRef = useRef<HTMLDivElement>(null)
  const recoveryRef = useRef<HTMLDivElement>(null)
  const section = route.query.get('section')

  useEffect(() => {
    const target = section === 'mail' ? mailRef.current : section === 'recovery' ? recoveryRef.current : null
    if (target) window.setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
  }, [section])

  useEffect(() => {
    void refreshAccount().catch(() => undefined)
  }, [])

  return (
    <div className="max-w-2xl">
      <PageHeader title={t('account.title')} subtitle={t('account.subtitle')} />
      <div className="space-y-8">
        <Profile />
        <Security />
        <div ref={recoveryRef} className="scroll-mt-8">
          <Recovery />
        </div>
        <div ref={mailRef} className="scroll-mt-8">
          <MailSettings />
        </div>
        <VaultSection />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- perfil

function Profile() {
  const account = useAccount()!
  const vault = useVault()!
  const { t } = useI18n()
  const [firstName, setFirstName] = useState(account.firstName)
  const [lastName, setLastName] = useState(account.lastName)
  const [email, setEmail] = useState(account.email)
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [busy, setBusy] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const emailChanged = email.trim().toLowerCase() !== account.email.toLowerCase()
  const dirty = firstName.trim() !== account.firstName || lastName.trim() !== account.lastName || emailChanged

  const save = async (event: FormEvent) => {
    event.preventDefault()
    const next: Record<string, string | undefined> = {}
    if (!firstName.trim()) next.firstName = t('create.errors.firstName')
    if (!isValidEmail(email)) next.email = t('create.errors.email')
    if (emailChanged && !password) next.password = t('account.emailChangeHint')
    setErrors(next)
    if (Object.values(next).some(Boolean)) return
    setBusy(true)
    try {
      const updated = await vaultApi.updateAccount({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        currentPassword: emailChanged ? password : undefined,
      })
      updateAccount(updated)
      // A tela de entrada sugere o último e-mail usado neste cofre: com o e-mail novo, não o antigo.
      if (emailChanged) rememberEmail(vault.id, updated.email)
      setFirstName(updated.firstName)
      setLastName(updated.lastName)
      setEmail(updated.email)
      setPassword('')
      toast(t('account.profileSaved'))
    } catch (err) {
      const message = accountError(err, t)
      if (err instanceof ApiError && err.code === 'bad-password') setErrors({ password: message })
      else if (err instanceof ApiError && err.code === 'invalid-email') setErrors({ email: message })
      else toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  const savePhoto = async (photo: string | null) => {
    setPhotoBusy(true)
    try {
      const updated = await vaultApi.updateAccount({ firstName: account.firstName, lastName: account.lastName, email: account.email, photo })
      updateAccount(updated)
    } catch (err) {
      toast.error(accountError(err, t))
    } finally {
      setPhotoBusy(false)
    }
  }

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return
    try {
      await savePhoto(await resizePhoto(file))
    } catch {
      toast.error(t('create.errors.photo'))
    }
  }

  return (
    <form onSubmit={save} noValidate>
      <Group title={t('account.profile')} className="fx-rise">
        <div className="flex items-center gap-5 px-4 py-5">
          <div className="relative">
            <Avatar photo={account.photo} initials={initialsOf(account.firstName, account.lastName)} size="xl" />
            {photoBusy && (
              <span className="absolute inset-0 grid place-items-center rounded-full bg-black/40">
                <Spinner className="text-white" />
              </span>
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-[20px] font-semibold tracking-tight">{fullName(account)}</p>
            <p className="truncate text-[14.5px] text-label-2">{account.email}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => fileRef.current?.click()} disabled={photoBusy}>
                <LuCamera className="size-4" aria-hidden />
                {account.photo ? t('account.changePhoto') : t('account.addPhoto')}
              </Button>
              {account.photo && (
                <Button size="sm" variant="ghost" className="text-expense" onClick={() => void savePhoto(null)} disabled={photoBusy}>
                  {t('account.removePhoto')}
                </Button>
              )}
            </div>
            {/* A dica da foto fica junto do botão (antes ficava no fim do grupo, depois de "Salvar perfil"). */}
            <p className="mt-2 text-[12.5px] text-label-3">{t('account.photoHint')}</p>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                void pickPhoto(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </div>
        </div>
        <Row label={t('create.firstName')} htmlFor="acc-first" error={errors.firstName}>
          <TextField id="acc-first" value={firstName} maxLength={40} autoComplete="given-name" onChange={(e) => setFirstName(e.target.value)} />
        </Row>
        <Row label={t('create.lastName')} htmlFor="acc-last">
          <TextField id="acc-last" value={lastName} maxLength={60} autoComplete="family-name" onChange={(e) => setLastName(e.target.value)} />
        </Row>
        <Row label={t('create.email')} htmlFor="acc-email" error={errors.email} hint={t('create.emailHint')}>
          <TextField id="acc-email" type="email" inputMode="email" value={email} maxLength={254} autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
        </Row>
        {emailChanged && (
          <Row label={t('account.currentPassword')} htmlFor="acc-pass" error={errors.password} hint={t('account.emailChangeHint')}>
            <TextField id="acc-pass" type="password" value={password} maxLength={200} autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} />
          </Row>
        )}
        <div className="flex justify-end px-4 py-3">
          <Button type="submit" variant="primary" disabled={!dirty || busy}>
            {busy && <Spinner />}
            {t('account.saveProfile')}
          </Button>
        </div>
      </Group>
    </form>
  )
}

// ---------------------------------------------------------------- senha

function Security() {
  const account = useAccount()!
  const i18n = useI18n()
  const { t } = i18n
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const found: Record<string, string | undefined> = {}
    if (!current) found.current = t('account.errors.currentRequired')
    found.next = passwordError(next, t)
    if (!found.next && next !== confirm) found.confirm = t('create.errors.mismatch')
    setErrors(found)
    if (Object.values(found).some(Boolean)) return
    setBusy(true)
    try {
      const { closedSessions } = await vaultApi.changePassword(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      toast(closedSessions > 0 ? t('account.passwordChangedOthers', { count: closedSessions }) : t('account.passwordChanged'))
      void refreshAccount().catch(() => undefined)
    } catch (err) {
      const message = accountError(err, t)
      if (err instanceof ApiError && err.code === 'bad-password') setErrors({ current: message })
      else if (err instanceof ApiError && (err.code === 'same-password' || err.code.startsWith('weak-password'))) setErrors({ next: message })
      else toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  const changed = account.passwordChangedAt ? t('account.lastChanged', { date: i18n.date(toISODate(new Date(account.passwordChangedAt))) }) : ''

  return (
    <form onSubmit={submit} noValidate className="fx-rise" style={{ animationDelay: '40ms' }}>
      <Group title={t('account.security')} footer={[changed, t('account.sessionInfo')].filter(Boolean).join(' · ')}>
        <div className="space-y-4 px-4 py-5">
          <input type="email" autoComplete="username" value={account.email} readOnly hidden />
          <PasswordField label={t('account.currentPassword')} autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} maxLength={200} error={errors.current} />
          <div>
            <PasswordField label={t('account.newPassword')} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} maxLength={200} error={errors.next} />
            <StrengthMeter password={next} />
          </div>
          <PasswordField label={t('account.confirmPassword')} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} maxLength={200} error={errors.confirm} />
        </div>
        <div className="flex justify-end px-4 py-3">
          <Button type="submit" variant="primary" disabled={busy || !current || !next}>
            {busy && <Spinner />}
            {t('account.changePassword')}
          </Button>
        </div>
      </Group>
    </form>
  )
}

// ---------------------------------------------------------------- código de recuperação

function Recovery() {
  const account = useAccount()!
  const vault = useVault()!
  const i18n = useI18n()
  const { t } = i18n
  const [asking, setAsking] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState<string | null>(null)
  const { createdAt, confirmed } = account.recovery

  const close = () => {
    setAsking(false)
    setPassword('')
    setError(undefined)
    setCode(null)
  }

  const generate = async () => {
    if (!password) return
    setBusy(true)
    setError(undefined)
    try {
      const { recoveryCode } = await vaultApi.newRecoveryCode(password)
      setPassword('')
      setCode(recoveryCode)
      updateAccount({ ...account, recovery: { createdAt: new Date().toISOString(), confirmed: false } })
    } catch (err) {
      setError(accountError(err, t))
    } finally {
      setBusy(false)
    }
  }

  const status = !createdAt
    ? t('account.recoveryNone')
    : confirmed
      ? t('account.recoveryCreated', { date: i18n.date(toISODate(new Date(createdAt))) })
      : t('account.recoveryUnconfirmed')

  return (
    <div className="fx-rise" style={{ animationDelay: '60ms' }}>
      <Group title={t('account.recoveryTitle')} footer={t('account.recoveryHint')}>
        <div className="flex flex-wrap items-center gap-3 px-4 py-4">
          <span className={cn('grid size-8 shrink-0 place-items-center rounded-[9px] text-white', createdAt && confirmed ? 'bg-income' : 'bg-warn')}>
            <LuLifeBuoy className="size-4" aria-hidden />
          </span>
          <p className="min-w-0 flex-1 text-[14.5px] text-label-2">{status}</p>
          <Button onClick={() => setAsking(true)}>{t('account.recoveryNew')}</Button>
        </div>
      </Group>
      <Sheet
        open={asking}
        onClose={() => !busy && close()}
        title={code ? t('recovery.title') : t('account.recoveryNew')}
        size="sm"
        closeLabel={t('common.close')}
        onSubmit={
          code
            ? undefined
            : (event) => {
                event.preventDefault()
                void generate()
              }
        }
        footer={
          code ? undefined : (
            <>
              <Button onClick={close} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="primary" disabled={!password || busy}>
                {busy && <Spinner />}
                {t('account.recoveryGenerate')}
              </Button>
            </>
          )
        }
      >
        {code ? (
          <RecoveryCodeCard
            code={code}
            vaultName={vault.name}
            email={account.email}
            continueLabel={t('recovery.done')}
            onContinue={async () => {
              const recovery = await vaultApi.confirmRecoveryCode().catch(() => account.recovery)
              updateAccount({ ...account, recovery })
              close()
            }}
          />
        ) : (
          <div className="space-y-4">
            <p className="text-[14.5px] text-label-2">{t('account.recoveryAsk')}</p>
            <input type="email" autoComplete="username" value={account.email} readOnly hidden />
            <PasswordField label={t('account.currentPassword')} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={200} error={error} autoFocus />
          </div>
        )}
      </Sheet>
    </div>
  )
}

// ---------------------------------------------------------------- e-mail para envio

const PROVIDERS: MailProvider[] = ['gmail', 'outlook', 'office365', 'yahoo', 'icloud', 'custom']
const SECURITIES: MailSecurity[] = ['starttls', 'ssl', 'none']

function guessProvider(email: string): MailProvider {
  const domain = email.split('@')[1]?.toLowerCase() ?? ''
  if (domain === 'gmail.com' || domain === 'googlemail.com') return 'gmail'
  if (/^(outlook|hotmail|live|msn)\./.test(domain)) return 'outlook'
  if (domain.startsWith('yahoo.')) return 'yahoo'
  if (['icloud.com', 'me.com', 'mac.com'].includes(domain)) return 'icloud'
  return 'gmail'
}

function MailSettings() {
  const account = useAccount()!
  const settings = useSettings()
  const { t } = useI18n()
  const mail = account.mail ?? null
  const [provider, setProvider] = useState<MailProvider>(mail?.provider ?? guessProvider(account.email))
  const [host, setHost] = useState(mail?.provider === 'custom' ? mail.host : '')
  const [port, setPort] = useState(mail?.provider === 'custom' ? String(mail.port) : '587')
  const [security, setSecurity] = useState<MailSecurity>(mail?.provider === 'custom' ? mail.security : 'starttls')
  const [username, setUsername] = useState(mail?.username ?? account.email)
  const [password, setPassword] = useState('')
  const [fromName, setFromName] = useState(mail?.fromName ?? '')
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | null>(null)
  const [error, setError] = useState<string>()
  const ready = Boolean(mail?.hasPassword)

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setError(undefined)
    if (!isValidEmail(username)) {
      setError(t('create.errors.email'))
      return
    }
    if (!password && !mail?.hasPassword) {
      setError(t('mail.errors.config'))
      return
    }
    setBusy('save')
    try {
      const info = await vaultApi.setMail({
        provider,
        host: provider === 'custom' ? host.trim() : undefined,
        port: provider === 'custom' ? Number(port) || 0 : undefined,
        security: provider === 'custom' ? security : undefined,
        username: username.trim(),
        fromName: fromName.trim(),
        password: password ? password : undefined,
      })
      updateAccount({ ...account, mail: info })
      setPassword('')
      toast(t('mail.saved'))
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'mail-config' ? t('mail.errors.config') : mailErrorMessage(err, t))
    } finally {
      setBusy(null)
    }
  }

  const test = async () => {
    setError(undefined)
    setBusy('test')
    try {
      const { to } = await vaultApi.testMail()
      toast(t('mail.testSent', { to }))
    } catch (err) {
      setError(mailErrorMessage(err, t))
    } finally {
      setBusy(null)
    }
  }

  const [confirmRemove, setConfirmRemove] = useState(false)
  const remove = async () => {
    setConfirmRemove(false)
    setBusy('remove')
    try {
      await vaultApi.deleteMail()
      updateAccount({ ...account, mail: null })
      if (settings.emailCopies) updateSettings({ emailCopies: false })
      setPassword('')
      toast(t('mail.removed'))
    } catch (err) {
      toast.error(accountError(err, t))
    } finally {
      setBusy(null)
    }
  }

  return (
    <form onSubmit={save} noValidate className="fx-rise" style={{ animationDelay: '80ms' }}>
      <Group title={t('mail.title')}>
        <div className="flex items-start gap-3 px-4 py-4 text-[14px] text-label-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-accent text-white">
            <LuMail className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p>{t('mail.intro', { email: account.email })}</p>
            <p className={ready ? 'mt-1 font-medium text-income' : 'mt-1 font-medium text-label-3'}>
              {ready ? t('mail.configured', { username: mail!.username }) : t('mail.notConfigured')}
            </p>
          </div>
        </div>
        <Row label={t('mail.provider')} htmlFor="mail-provider">
          <Select
            id="mail-provider"
            label={t('mail.provider')}
            value={provider}
            options={PROVIDERS.map((p) => ({ value: p, label: t(`mail.providers.${p}` as TKey) }))}
            placeholder=""
            onChange={(p: MailProvider) => setProvider(p)}
          />
        </Row>
        {provider === 'custom' && (
          <>
            <Row label={t('mail.host')} htmlFor="mail-host">
              <TextField id="mail-host" value={host} maxLength={255} placeholder="smtp.exemplo.com" onChange={(e) => setHost(e.target.value)} />
            </Row>
            <Row label={t('mail.port')} htmlFor="mail-port">
              <TextField id="mail-port" inputMode="numeric" value={port} maxLength={5} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} />
            </Row>
            <Row label={t('mail.security')} htmlFor="mail-security">
              <Select
                id="mail-security"
                label={t('mail.security')}
                value={security}
                options={SECURITIES.map((s) => ({ value: s, label: t(`mail.securities.${s}` as TKey) }))}
                placeholder=""
                onChange={(s: MailSecurity) => setSecurity(s)}
              />
            </Row>
          </>
        )}
        <Row label={t('mail.username')} htmlFor="mail-user" hint={t('mail.usernameHint')}>
          <TextField id="mail-user" type="email" inputMode="email" value={username} maxLength={254} autoComplete="off" onChange={(e) => setUsername(e.target.value)} />
        </Row>
        <Row label={t('mail.appPassword')} htmlFor="mail-pass" hint={t(`mail.help.${provider}` as TKey)}>
          <TextField
            id="mail-pass"
            type="password"
            value={password}
            maxLength={200}
            autoComplete="new-password"
            placeholder={mail?.hasPassword ? t('mail.appPasswordSaved') : '••••••••••••••••'}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Row>
        <Row label={t('mail.fromName')} htmlFor="mail-from">
          <TextField id="mail-from" value={fromName} maxLength={100} placeholder={t('mail.fromNamePlaceholder')} onChange={(e) => setFromName(e.target.value)} />
        </Row>
        {error && (
          <p className="px-4 py-3 text-[14px] font-medium text-expense" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          {mail && (
            <Button variant="ghost" className="text-expense" onClick={() => setConfirmRemove(true)} disabled={busy !== null}>
              {busy === 'remove' && <Spinner />}
              {t('mail.remove')}
            </Button>
          )}
          <span className="flex-1" />
          <Button onClick={() => void test()} disabled={!ready || busy !== null}>
            {busy === 'test' ? <Spinner /> : <LuSend className="size-4" aria-hidden />}
            {t('mail.test')}
          </Button>
          <Button type="submit" variant="primary" disabled={busy !== null}>
            {busy === 'save' && <Spinner />}
            {t('mail.save')}
          </Button>
        </div>
        <Row label={t('mail.copies')} htmlFor="mail-copies" hint={ready ? t('mail.copiesHint', { email: account.email }) : t('mail.copiesNeedsSetup')}>
          <Switch id="mail-copies" label={t('mail.copies')} checked={ready && settings.emailCopies} onChange={(emailCopies) => ready && updateSettings({ emailCopies })} />
        </Row>
      </Group>
      <ConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={() => void remove()}
        title={t('mail.removeTitle')}
        body={t('mail.removeBody')}
        confirmLabel={t('mail.remove')}
        cancelLabel={t('common.cancel')}
      />
    </form>
  )
}

// ---------------------------------------------------------------- cofre

function VaultSection() {
  const vault = useVault()!
  const data = useData()
  const i18n = useI18n()
  const { t } = i18n
  const [name, setName] = useState(vault.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [password, setPassword] = useState('')
  const [deleteError, setDeleteError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const rename = async (value: string) => {
    const clean = value.trim()
    if (!clean) {
      setName(vault.name)
      return
    }
    if (clean === vault.name) return
    try {
      updateVault(await vaultApi.rename(clean))
      toast(t('account.renamed'))
    } catch (err) {
      setName(vault.name)
      toast.error(accountError(err, t))
    }
  }

  const remove = async () => {
    if (!password) return
    setBusy(true)
    setDeleteError(undefined)
    try {
      await vaultApi.remove(password)
      afterDelete()
    } catch (err) {
      setDeleteError(err instanceof ApiError && err.code === 'bad-password' ? t('account.errors.badPassword') : accountError(err, t))
      setBusy(false)
    }
  }

  const details: ReactNode[] = [vaultStats(data, t)]
  if (vault.createdAt) details.unshift(t('account.createdAt', { date: i18n.date(toISODate(new Date(vault.createdAt))) }))

  return (
    <div className="fx-rise" style={{ animationDelay: '120ms' }}>
      <Group title={t('account.vault')} footer={t('account.file', { id: vault.id })}>
        <Row label={t('account.vaultName')} htmlFor="vault-name">
          <TextField
            id="vault-name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onBlur={(e) => void rename(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              // Esc desiste: volta o nome salvo sem gravar nada.
              if (e.key === 'Escape') {
                e.preventDefault()
                setName(vault.name)
                requestAnimationFrame(() => (e.target as HTMLInputElement).blur())
              }
            }}
          />
        </Row>
        <p className="px-4 py-3 text-[14px] text-label-2">{details.join(' · ')}</p>
        <div className="flex flex-wrap gap-2 px-4 py-3">
          <Button onClick={() => void leave('switch')}>
            <LuRepeat className="size-4" aria-hidden />
            {t('account.switch')}
          </Button>
          <Button onClick={() => void leave('logout')}>
            <LuLogOut className="size-4" aria-hidden />
            {t('account.signOut')}
          </Button>
          <span className="flex-1" />
          <Button
            variant="ghost"
            className="text-expense"
            onClick={() => {
              setPassword('')
              setDeleteError(undefined)
              setConfirmDelete(true)
            }}
          >
            <LuTrash2 className="size-4" aria-hidden />
            {t('account.delete')}
          </Button>
        </div>
      </Group>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => !busy && setConfirmDelete(false)}
        onConfirm={() => void remove()}
        title={t('account.deleteTitle', { name: vault.name })}
        body={t('account.deleteBody')}
        confirmLabel={t('account.deleteConfirm')}
        cancelLabel={t('common.cancel')}
        confirmDisabled={!password || busy}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void remove()
          }}
        >
          <PasswordField label={t('gate.password')} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={200} error={deleteError} autoFocus />
        </form>
      </ConfirmDialog>
    </div>
  )
}
