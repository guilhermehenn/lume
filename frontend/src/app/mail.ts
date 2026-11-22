// Envio de arquivos por e-mail para o próprio dono do cofre (Minha conta → E-mail para envio).
// deliver(): baixa o arquivo e, se "mandar cópia por e-mail" estiver ligado, envia também.
// email(): só envia.

import { useCallback, useState } from 'react'
import { ApiError } from '../api/client'
import { vaultApi } from '../api/vault'
import { todayISO } from '../lib/dates'
import { downloadBlob, formatFileSize } from '../lib/download'
import { useAccount } from '../data/session'
import { getSettings } from '../data/store'
import { useI18n, type I18n } from '../i18n'
import { toast } from '../ui/toast'
import { navigate } from './router'

export interface OutgoingFile {
  blob: Blob
  filename: string
  /** O que é, para o assunto e o texto do e-mail (ex.: "Lançamentos de 2026 (CSV)"). */
  label: string
  /** Corpo do e-mail em HTML (opcional; ex.: o relatório anual). */
  html?: string
}

/** Limite de anexos por e-mail (o mesmo de MAX_ATTACHMENTS_BYTES em backend/app/services/mailer.py).
 *  Codificado para o e-mail o arquivo cresce cerca de 37%: 15 MB viram uns 20 MB, abaixo dos 25 MB
 *  por mensagem do Gmail e do Yahoo. Acima disso o arquivo nem sai do computador. */
export const MAIL_MAX_BYTES = 15 * 1024 * 1024

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < buffer.length; i += chunk) binary += String.fromCharCode(...buffer.subarray(i, i + chunk))
  return btoa(binary)
}

export function mailErrorMessage(err: unknown, t: I18n['t']): string {
  const code = err instanceof ApiError ? err.code : 'network'
  switch (code) {
    case 'mail-auth':
      return t('mail.errors.auth')
    case 'mail-connect':
    case 'network':
      return t('mail.errors.connect')
    case 'mail-tls':
      return t('mail.errors.tls')
    case 'mail-timeout':
      return t('mail.errors.timeout')
    case 'mail-rejected':
      return t('mail.errors.rejected')
    case 'mail-too-big':
      return t('mail.errors.tooBig')
    case 'mail-limit':
      return t('mail.errors.limit')
    case 'mail-not-configured':
    case 'mail-password-lost':
      return t('mail.errors.notConfigured')
    case 'mail-config':
    case 'invalid-mail':
      return t('mail.errors.config')
    default:
      return t('mail.errors.other')
  }
}

export function useMail() {
  const account = useAccount()
  const i18n = useI18n()
  const { t } = i18n
  const [sending, setSending] = useState(false)
  const ready = Boolean(account?.mail?.hasPassword)

  const send = useCallback(
    async (file: OutgoingFile, quietSuccess = false): Promise<boolean> => {
      if (!ready) {
        toast.info(t('mail.notReady'), { action: { label: t('mail.setUp'), onClick: () => navigate('/account', { section: 'mail' }) } })
        return false
      }
      if (file.blob.size > MAIL_MAX_BYTES) {
        toast.error(t('mail.errors.tooBigSize', { size: formatFileSize(file.blob.size, i18n.locale), max: formatFileSize(MAIL_MAX_BYTES, i18n.locale) }), {
          duration: 8000,
        })
        return false
      }
      setSending(true)
      try {
        // Data de hoje no fuso do computador (toISOString daria a data de Greenwich, já "amanhã" à noite).
        const date = i18n.date(todayISO())
        const result = await vaultApi.send({
          subject: t('mail.subject', { label: file.label }),
          text: t('mail.body', { label: file.label, file: file.filename, date }),
          html: file.html,
          attachments: [{ filename: file.filename, contentType: file.blob.type || 'application/octet-stream', data: await blobToBase64(file.blob) }],
        })
        toast(quietSuccess ? t('mail.copySent', { to: result.to }) : t('mail.sent', { to: result.to }))
        return true
      } catch (err) {
        toast.error(mailErrorMessage(err, t), { duration: 8000 })
        return false
      } finally {
        setSending(false)
      }
    },
    [ready, i18n, t],
  )

  /** Baixa e, se a cópia por e-mail estiver ligada, envia também. */
  const deliver = useCallback(
    async (file: OutgoingFile) => {
      downloadBlob(file.blob, file.filename)
      toast(t('export.done'))
      if (getSettings().emailCopies && ready) await send(file, true)
    },
    [ready, send, t],
  )

  return { ready, sending, email: send, deliver, to: account?.email ?? '' }
}
