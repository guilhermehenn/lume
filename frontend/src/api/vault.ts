// Chamadas dos cofres: escolher, criar, entrar, dados, Minha conta e envio de e-mail.

import type { DataState, Language, Theme } from '../data/types'
import type { Currency } from '../lib/money'
import { apiRequest } from './client'

export type VaultStatus = 'ok' | 'needs-update' | 'too-new' | 'error'

export interface VaultSummary {
  id: string
  name: string
  ownerFirstName: string
  ownerLastName: string
  initials: string
  emailHint: string
  photo: string | null
  createdAt: string | null
  lastOpenedAt: string | null
  entries: number
  status: VaultStatus
}

export interface MailInfo {
  provider: MailProvider
  host: string
  port: number
  security: MailSecurity
  username: string
  fromName: string
  hasPassword: boolean
  updatedAt: string
}

export interface Account {
  id: string
  firstName: string
  lastName: string
  email: string
  photo: string | null
  createdAt: string
  passwordChangedAt: string | null
  /** Código de recuperação: quando foi gerado (null = não há) e se o dono confirmou que guardou. */
  recovery: { createdAt: string | null; confirmed: boolean }
  mail?: MailInfo | null
}

export interface VaultSettings {
  language: Language
  currency: Currency
  theme: Theme
  hideValues: boolean
  onboardingDone: boolean
  emailCopies: boolean
}

export interface SessionInfo {
  vault: VaultSummary
  account: Account
  settings: VaultSettings
  revision: number
}

/** Criar o cofre ou trocar a senha com o código devolvem um código de recuperação novo (só agora). */
export interface SessionWithCode extends SessionInfo {
  recoveryCode: string
}

export type Collection = 'banks' | 'categories' | 'transactions' | 'investments' | 'reports'

export interface ChangesPayload {
  baseRevision: number
  upserts: Partial<Record<Collection, unknown[]>>
  deletes: Partial<Record<Collection, string[]>>
  /** Dados que já existiam (backup, "Desfazer"): sem as regras dos formulários. */
  restore?: boolean
  /** Troca de tudo de uma vez: o servidor guarda uma cópia do cofre antes (veja `Pending.checkpoint`). */
  checkpoint?: 'before-restore' | 'before-sample' | 'before-reset'
}

export interface VaultBackups {
  count: number
  /** O mais recente: data e hora locais (AAAA-MM-DDTHH:MM:SS) e o motivo (auto, before-restore…). */
  latest: { createdAt: string; reason: string } | null
}

export type MailProvider = 'gmail' | 'outlook' | 'office365' | 'yahoo' | 'icloud' | 'custom'
export type MailSecurity = 'starttls' | 'ssl' | 'none'

export interface MailInput {
  provider: MailProvider
  host?: string
  port?: number
  security?: MailSecurity
  username: string
  fromName?: string
  /** undefined mantém a senha guardada; '' apaga. */
  password?: string
}

export interface MailAttachment {
  filename: string
  contentType: string
  /** Conteúdo em base64. */
  data: string
}

export const vaultApi = {
  list: () => apiRequest<VaultSummary[]>('GET', '/vaults'),
  create: (body: {
    name: string
    firstName: string
    lastName: string
    email: string
    password: string
    data: DataState
    settings: Partial<VaultSettings>
  }) => apiRequest<SessionWithCode>('POST', '/vaults', body),
  recover: (vaultId: string, body: { email: string; recoveryCode: string; newPassword: string }) =>
    apiRequest<SessionWithCode>('POST', `/vaults/${encodeURIComponent(vaultId)}/recover`, body),
  login: (vaultId: string, email: string, password: string) =>
    apiRequest<SessionInfo>('POST', `/vaults/${encodeURIComponent(vaultId)}/session`, { email, password }),
  session: () => apiRequest<SessionInfo>('GET', '/session', undefined, { quietAuth: true }),
  logout: () => apiRequest<void>('DELETE', '/session', undefined, { quietAuth: true }),

  data: () => apiRequest<{ revision: number; data: DataState }>('GET', '/vault/data'),
  changes: (payload: ChangesPayload, keepalive = false) => apiRequest<{ revision: number }>('POST', '/vault/changes', payload, { keepalive }),
  settings: (patch: Partial<VaultSettings>) => apiRequest<VaultSettings>('PUT', '/vault/settings', patch),
  backups: () => apiRequest<VaultBackups>('GET', '/vault/backups'),
  rename: (name: string) => apiRequest<VaultSummary>('PATCH', '/vault', { name }),
  remove: (password: string) => apiRequest<void>('POST', '/vault/delete', { password }),

  account: () => apiRequest<Account>('GET', '/account'),
  /** Sem `photo`, a foto atual fica; `photo: null` remove. */
  updateAccount: (body: { firstName: string; lastName: string; email: string; photo?: string | null; currentPassword?: string }) =>
    apiRequest<Account>('PUT', '/account', body),
  changePassword: (currentPassword: string, newPassword: string) =>
    apiRequest<{ closedSessions: number }>('POST', '/account/password', { currentPassword, newPassword }),
  newRecoveryCode: (currentPassword: string) => apiRequest<{ recoveryCode: string }>('POST', '/account/recovery-code', { currentPassword }),
  confirmRecoveryCode: () => apiRequest<Account['recovery']>('POST', '/account/recovery-code/confirm'),

  setMail: (body: MailInput) => apiRequest<MailInfo>('PUT', '/account/mail', body),
  deleteMail: () => apiRequest<void>('DELETE', '/account/mail'),
  testMail: () => apiRequest<{ to: string }>('POST', '/account/mail/test'),
  send: (body: { subject: string; text: string; html?: string; attachments: MailAttachment[] }) =>
    apiRequest<{ to: string }>('POST', '/mail/send', body),
}
