// Mostra o código de recuperação uma única vez: copiar, baixar e confirmar que guardou.

import { useState } from 'react'
import { LuCheck, LuCopy, LuDownload, LuLifeBuoy } from 'react-icons/lu'
import { useI18n } from '../../i18n'
import { downloadText } from '../../lib/download'
import { cn } from '../../lib/cn'
import { Button, Spinner } from '../../ui/primitives'
import { toast } from '../../ui/toast'

export function RecoveryCodeCard({
  code,
  vaultName,
  email,
  continueLabel,
  onContinue,
}: {
  code: string
  vaultName: string
  email: string
  continueLabel: string
  /** Chamado depois de o dono marcar que guardou o código. */
  onContinue: () => Promise<void> | void
}) {
  const i18n = useI18n()
  const { t } = i18n
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      toast(t('recovery.copied'))
    } catch {
      // Sem acesso à área de transferência: o código fica selecionável na tela.
      window.getSelection()?.selectAllChildren(document.getElementById('recovery-code')!)
    }
  }

  const download = () => {
    const date = i18n.date(new Date().toISOString().slice(0, 10))
    downloadText(
      `${t('recovery.fileTitle')}\r\n\r\n${t('recovery.fileBody', { vault: vaultName, email, code, date }).replace(/\n/g, '\r\n')}\r\n`,
      `lume-codigo-de-recuperacao-${vaultName.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}.txt`,
      'text/plain;charset=utf-8',
    )
  }

  return (
    <div className="fx-rise">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-income/15 text-income">
          <LuLifeBuoy className="size-6" aria-hidden />
        </span>
        <div>
          <h2 className="text-[21px] font-bold tracking-[-0.02em]">{t('recovery.title')}</h2>
          <p className="mt-1 text-[14.5px] text-label-2">{t('recovery.body')}</p>
        </div>
      </div>
      <p
        id="recovery-code"
        className="mt-5 flex flex-wrap justify-center rounded-2xl bg-fill-2 px-4 py-4 font-mono text-[20px] font-semibold tracking-[0.08em] text-label ring-1 ring-sep/50 select-all sm:text-[22px]"
        aria-label={t('recovery.codeLabel')}
      >
        {/* Quebra de linha só entre os grupos, nunca no meio de um. */}
        {code.split('-').map((group, i) => (
          <span key={i} className="whitespace-nowrap">
            {i > 0 && <span className="px-1 text-label-3">-</span>}
            {group}
          </span>
        ))}
      </p>
      <p className="mt-2 text-center text-[13px] font-medium text-warn">{t('recovery.once')}</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button onClick={() => void copy()}>
          {copied ? <LuCheck className="size-4 text-income" aria-hidden /> : <LuCopy className="size-4" aria-hidden />}
          {t('recovery.copy')}
        </Button>
        <Button onClick={download}>
          <LuDownload className="size-4" aria-hidden />
          {t('recovery.download')}
        </Button>
      </div>
      <label className={cn('mt-5 flex cursor-pointer items-start gap-3 rounded-2xl p-3.5 ring-1 transition-colors', saved ? 'bg-income/10 ring-income/50' : 'bg-fill-2 ring-sep/50 hover:bg-fill')}>
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--color-accent)]" />
        <span className="text-[15px] font-medium">{t('recovery.confirm')}</span>
      </label>
      <Button
        variant="primary"
        size="lg"
        className="mt-5 w-full"
        disabled={!saved || busy}
        onClick={async () => {
          setBusy(true)
          try {
            await onContinue()
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy && <Spinner />}
        {continueLabel}
      </Button>
    </div>
  )
}
