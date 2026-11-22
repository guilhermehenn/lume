// Configurações: idioma, moeda, tema, privacidade e dados do cofre (backup, restauração, exemplo, apagar).
// Nome, foto, e-mail e senha ficam em Minha conta.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { LuChevronRight, LuDatabase, LuDownload, LuExternalLink, LuMonitor, LuMoon, LuSparkles, LuSun, LuTrash2, LuUpload } from 'react-icons/lu'
import { vaultApi, type VaultBackups } from '../api/vault'
import { useMail } from '../app/mail'
import { href } from '../app/router'
import { APP_VERSION, REPOSITORY_URL } from '../app/version'
import { vaultStats } from '../app/vaultStats'
import { LumeMark } from '../app/Layout'
import { todayISO } from '../lib/dates'
import { formatFileSize } from '../lib/download'
import { CURRENCIES } from '../lib/money'
import { cn } from '../lib/cn'
import { BACKUP_MAX_BYTES, BackupError, backupFilename, createBackup, readBackup, type ParsedBackup } from '../data/backup'
import { fullName, useAccount, useVault } from '../data/session'
import { actions, undo, updateSettings, useData, useSettings, useSyncStatus } from '../data/store'
import type { DataState, Language, Theme } from '../data/types'
import { LANGUAGES, useI18n } from '../i18n'
import { Select } from '../ui/inputs'
import { Avatar, initialsOf } from '../ui/Avatar'
import { useLatest } from '../ui/display'
import { Button, Group, PageHeader, Row, Segmented, Spinner, Switch } from '../ui/primitives'
import { ConfirmDialog } from '../ui/Sheet'
import { toast } from '../ui/toast'

type Change = { kind: 'restore'; backup: ParsedBackup } | { kind: 'sample' } | { kind: 'reset' }
interface DialogText {
  title: string
  body: string
  confirm: string
  destructive: boolean
  /** Apagar com dados no cofre: o aviso oferece baixar um backup antes. */
  offerBackup: boolean
}
/** O texto do aviso é montado ao abrir: enquanto ele some, depois de confirmar, não muda. */
type Pending = (Change & { text: DialogText }) | null

/** No Mac o atalho de salvar é ⌘ + Enter; nos outros, Ctrl + Enter (o app aceita os dois). */
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/** Uma linha que é um botão: ícone, título e o que acontece. */
function ActionRow({
  icon,
  tint,
  title,
  description,
  onClick,
  danger,
  busy,
}: {
  icon: ReactNode
  tint: string
  title: string
  description: string
  onClick: () => void
  danger?: boolean
  busy?: boolean
}) {
  const id = useId()
  // O nome do botão é o título; a frase de baixo é a descrição (leitores de tela leem os dois, separados).
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-busy={busy || undefined}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-desc`}
      className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-fill-2 focus-visible:bg-fill-2 focus-visible:outline-none disabled:opacity-70"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-[9px] text-white [&>svg]:size-4" style={{ background: tint }}>
        {busy ? <Spinner /> : icon}
      </span>
      <span className="min-w-0 flex-1">
        <span id={`${id}-title`} className={cn('block text-[15px] font-medium', danger && 'text-expense')}>
          {title}
        </span>
        <span id={`${id}-desc`} className="block text-[13px] text-label-2">
          {description}
        </span>
      </span>
      <LuChevronRight className="size-4 shrink-0 text-label-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </button>
  )
}

/** Cópias do cofre feitas pelo Lume (todo dia ao abrir e antes das trocas de tudo). Atualiza quando termina de salvar. */
function useVaultBackups(): VaultBackups | null {
  const sync = useSyncStatus()
  const [info, setInfo] = useState<VaultBackups | null>(null)
  useEffect(() => {
    if (sync !== 'idle') return
    let alive = true
    vaultApi
      .backups()
      .then((next) => alive && setInfo(next))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [sync])
  return info
}

export function Settings() {
  const data = useData()
  const settings = useSettings()
  const i18n = useI18n()
  const { t } = i18n
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<Pending>(null)
  const [reading, setReading] = useState(false)
  const account = useAccount()
  const vault = useVault()
  const mail = useMail()
  const copies = useVaultBackups()

  const backup = () =>
    void mail.deliver({
      blob: new Blob([createBackup(data, settings)], { type: 'application/json' }),
      filename: backupFilename(todayISO()),
      label: t('mail.labels.backup'),
    })

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > BACKUP_MAX_BYTES) {
      toast.error(t('errors.backupTooBig', { size: formatFileSize(file.size, i18n.locale), max: formatFileSize(BACKUP_MAX_BYTES, i18n.locale) }))
      return
    }
    // Um backup grande leva um ou dois segundos para ler e conferir: o botão mostra que está lendo.
    setReading(true)
    try {
      const text = await file.text()
      // Guarda o arquivo já lido e conferido: confirmar não lê nem valida tudo de novo.
      open({ kind: 'restore', backup: readBackup(text) })
    } catch (err) {
      const code = err instanceof BackupError ? err.message : ''
      toast.error(code === 'json' ? t('errors.backupJson') : code === 'not-lume' ? t('errors.backupNotLume') : t('errors.backupInvalid'))
    } finally {
      setReading(false)
    }
  }

  const confirm = () => {
    if (!pending) return
    const undoAction = { label: t('common.undo'), onClick: () => undo() }
    try {
      if (pending.kind === 'restore') {
        actions.importBackup(pending.backup)
        toast(t('settings.restored'), { action: undoAction })
      } else if (pending.kind === 'sample') {
        actions.loadSample()
        toast(t('settings.sampleLoaded'), { action: undoAction })
      } else {
        actions.resetAll()
        toast(t('settings.resetDone'), { action: undoAction })
      }
    } catch {
      toast.error(pending.kind === 'restore' ? t('errors.backupInvalid') : t('errors.generic'))
    }
    setPending(null)
  }

  const count = {
    transactions: (n: number) => t('export.countTransactions', { count: n }),
    investments: (n: number) => t('export.countInvestments', { count: n }),
    reports: (n: number) => t('settings.countReports', { count: n }),
  }
  const summary = (s: Pick<DataState, 'transactions' | 'investments'>) =>
    t('settings.summary', { transactions: count.transactions(s.transactions.length), investments: count.investments(s.investments.length) })
  const hasEntries = data.transactions.length + data.investments.length + data.reports.length > 0

  const themeOptions: { value: Theme; label: ReactNode }[] = [
    { value: 'dark', label: <><LuMoon className="size-3.5" aria-hidden />{t('settings.themes.dark')}</> },
    { value: 'light', label: <><LuSun className="size-3.5" aria-hidden />{t('settings.themes.light')}</> },
    { value: 'system', label: <><LuMonitor className="size-3.5" aria-hidden />{t('settings.themes.system')}</> },
  ]
  const shown = useLatest(pending)
  const dialog = shown?.text
  const open = (change: Change) => setPending({ ...change, text: dialogText(change) })

  /** Título, texto e botão do aviso: cada troca diz o que vai sair e o que vai entrar. */
  function dialogText(p: Change): DialogText {
    if (p.kind === 'restore') {
      const when = p.backup.exportedAt ? i18n.dateTime(p.backup.exportedAt) : ''
      return {
        title: t('settings.restoreTitle'),
        body: t('settings.restoreBody', { current: summary(data), date: when || '—', incoming: summary(p.backup.data) }),
        confirm: t('settings.restore'),
        destructive: false,
        offerBackup: false,
      }
    }
    if (p.kind === 'sample') {
      return {
        title: t('settings.sampleTitle'),
        body: hasEntries ? t('settings.sampleBody', { current: summary(data) }) : t('settings.sampleBodyEmpty'),
        confirm: t('settings.sample'),
        destructive: hasEntries,
        offerBackup: false,
      }
    }
    return {
      title: t('settings.resetTitle'),
      body: hasEntries
        ? t('settings.resetBody', {
            transactions: count.transactions(data.transactions.length),
            investments: count.investments(data.investments.length),
            reports: count.reports(data.reports.length),
          })
        : t('settings.resetBodyEmpty'),
      confirm: t('settings.reset'),
      destructive: true,
      offerBackup: hasEntries,
    }
  }

  const shortcuts: [string, string][] = [
    ['N', t('settings.shortcutNew')],
    ['/', t('settings.shortcutSearch')],
    ['H', t('settings.shortcutHide')],
    [IS_MAC ? '⌘ Enter' : 'Ctrl + Enter', t('settings.shortcutSave')],
  ]

  return (
    <div className="max-w-2xl">
      <PageHeader title={t('settings.title')} />
      <div className="space-y-7">
        {account && (
          <Group className="fx-rise">
            <a href={href('/account')} className="group flex items-center gap-4 px-4 py-4 transition-colors hover:bg-fill-2">
              <Avatar photo={account.photo} initials={initialsOf(account.firstName, account.lastName)} size="lg" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[17px] font-semibold tracking-tight">{fullName(account)}</span>
                <span className="block text-[14px] text-label-2">
                  {t('settings.account')} · {t('settings.accountHint')}
                </span>
              </span>
              <LuChevronRight className="size-5 shrink-0 text-label-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </a>
          </Group>
        )}

        <Group title={t('settings.general')} className="fx-rise">
          <Row label={t('settings.language')} htmlFor="set-language">
            <Select
              id="set-language"
              label={t('settings.language')}
              value={settings.language}
              options={LANGUAGES.map((l) => ({ value: l, label: t(`languages.${l}`) }))}
              placeholder=""
              onChange={(language: Language) => updateSettings({ language })}
            />
          </Row>
          <Row label={t('settings.currency')} htmlFor="set-currency" hint={t('settings.currencyHint')}>
            <Select
              id="set-currency"
              label={t('settings.currency')}
              value={settings.currency}
              options={CURRENCIES.map((c) => ({ value: c, label: t(`currencies.${c}`) }))}
              placeholder=""
              onChange={(currency) => updateSettings({ currency })}
            />
          </Row>
        </Group>

        <Group title={t('settings.appearance')} className="fx-rise">
          <Row label={t('settings.theme')} stackOnMobile>
            <Segmented className="w-full sm:max-w-80" label={t('settings.theme')} value={settings.theme} options={themeOptions} onChange={(theme) => updateSettings({ theme })} />
          </Row>
        </Group>

        <Group title={t('settings.privacy')} footer={t('settings.hideValuesHint')} className="fx-rise">
          <Row label={t('settings.hideValues')} htmlFor="set-hide">
            <Switch id="set-hide" label={t('settings.hideValues')} checked={settings.hideValues} onChange={(hideValues) => updateSettings({ hideValues })} />
          </Row>
        </Group>

        <Group
          title={t('settings.data')}
          footer={
            <>
              <span className="block">{t('settings.storageInfo', { name: vault?.name ?? '' })}</span>
              {copies && (
                <span className="mt-1 block" data-testid="vault-copies">
                  {copies.latest ? t('settings.lastCopy', { when: i18n.dateTime(copies.latest.createdAt), count: copies.count }) : t('settings.noCopy')}
                </span>
              )}
            </>
          }
          className="fx-rise"
        >
          <div className="flex items-center gap-3 px-4 py-3 text-[14px]">
            <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-fill-2 text-label-2">
              <LuDatabase className="size-4" aria-hidden />
            </span>
            <span className="tabular text-label-2">
              {vaultStats(data, t)}
            </span>
          </div>
          <ActionRow icon={<LuDownload />} tint="#30A14E" title={t('settings.backup')} description={t('settings.backupDesc')} onClick={backup} />
          <ActionRow
            icon={<LuUpload />}
            tint="#0A84FF"
            title={reading ? t('settings.reading') : t('settings.restore')}
            description={t('settings.restoreDesc')}
            onClick={() => fileRef.current?.click()}
            busy={reading}
          />
          <ActionRow icon={<LuSparkles />} tint="#5E5CE6" title={t('settings.sample')} description={t('settings.sampleDesc')} onClick={() => open({ kind: 'sample' })} />
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              void pickFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </Group>

        <Group title={t('settings.danger')} className="fx-rise">
          <ActionRow icon={<LuTrash2 />} tint="#FF453A" title={t('settings.reset')} description={t('settings.resetDesc')} onClick={() => open({ kind: 'reset' })} danger />
        </Group>

        <Group title={t('settings.shortcuts')} className="fx-rise">
          {shortcuts.map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[15px]">
              <span>{label}</span>
              <kbd className="shrink-0 rounded-md bg-fill px-2 py-0.5 text-[13px] font-semibold text-label-2">{key}</kbd>
            </div>
          ))}
        </Group>

        <Group title={t('settings.about')} className="fx-rise">
          <div className="flex items-start gap-3 px-4 py-4">
            <LumeMark className="mt-1" />
            <div className="text-[14px]">
              <p className="font-semibold">
                Lume <span className="font-normal text-label-2">· {t('app.version', { version: APP_VERSION })}</span>
              </p>
              <p className="mt-0.5 text-label-2">{t('settings.aboutBody')}</p>
              <p className="mt-2 text-[13px] text-label-3">{t('settings.dataSources')}</p>
              <a
                href={REPOSITORY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline"
              >
                {t('settings.sourceCode')}
                <LuExternalLink className="size-3.5" aria-hidden />
              </a>
            </div>
          </div>
        </Group>
      </div>

      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={confirm}
        destructive={dialog?.destructive ?? false}
        title={dialog?.title ?? ''}
        body={dialog?.body ?? ''}
        confirmLabel={dialog?.confirm ?? ''}
        cancelLabel={t('common.cancel')}
      >
        {dialog?.offerBackup && (
          <Button className="w-full" onClick={backup}>
            <LuDownload className="size-4" aria-hidden />
            {t('settings.backup')}
          </Button>
        )}
      </ConfirmDialog>
    </div>
  )
}
