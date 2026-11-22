// Backup e restauração dos dados do cofre (arquivo .json).
// Tudo que entra é validado: um arquivo errado nunca substitui os dados atuais.

import { z } from 'zod'
import { isEntryDate, type ISODate } from '../lib/dates'
import { CURRENCIES } from '../lib/money'
import type { DataState, Settings } from './types'

const id = z.string().min(1).max(64)
// Mesmas regras do servidor: um arquivo que ele recusaria é recusado já na leitura, com
// mensagem clara, em vez de falhar depois ao gravar.
const isoDate = z.string().refine(isEntryDate, 'data inválida')
const cents = z.number().int().nonnegative().max(99_999_999_999_99)
const signedCents = z.number().int().min(-99_999_999_999_99).max(99_999_999_999_99)
const STAMP_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?$/
/** Data e hora de criação/alteração. Valor estragado num backup antigo não impede a restauração. */
const stamp = z
  .string()
  .max(40)
  .catch('1970-01-01T00:00:00.000Z')
  .transform((v) => (STAMP_RE.test(v) && !Number.isNaN(Date.parse(v)) ? v : '1970-01-01T00:00:00.000Z'))
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const kind = z.enum(['expense', 'income'])

const bank = z.object({
  id,
  // Como no servidor: espaços nas pontas não contam, e o código só tem dígitos.
  name: z.string().max(60).refine((v) => v.trim().length > 0),
  code: z.string().regex(/^\d{0,3}$/).optional(),
  kind: z.enum(['checking', 'digital', 'savings', 'broker', 'cash', 'other']),
  color,
  initialBalance: signedCents,
  isPrimary: z.boolean(),
  createdAt: stamp,
  updatedAt: stamp,
})

const category = z.object({
  id,
  kind,
  nameKey: z.string().max(40).optional(),
  name: z.string().max(60).optional(),
  icon: z.string().min(1).max(30),
  color,
  createdAt: stamp,
  updatedAt: stamp,
})

const transaction = z.object({
  id,
  kind,
  amount: cents.positive(),
  date: isoDate,
  bankId: id,
  categoryId: id,
  counterparty: z.string().min(1).max(120),
  paymentMethod: z.enum(['pix', 'debit', 'credit', 'boleto', 'cash', 'transfer']).optional(),
  note: z.string().max(500).optional(),
  createdAt: stamp,
  updatedAt: stamp,
})

const investment = z.object({
  id,
  operation: z.enum(['contribution', 'redemption', 'earning']),
  type: z.enum(['savings', 'cdb', 'lci_lca', 'cri_cra', 'debenture', 'treasury', 'stock', 'fii', 'fiagro', 'etf', 'bdr', 'fund', 'pension', 'crypto', 'gold', 'other']),
  amount: cents.positive(),
  date: isoDate,
  bankId: id,
  asset: z.string().min(1).max(80),
  quantity: z.number().positive().optional(),
  unitPrice: cents.optional(),
  fees: cents.optional(),
  issuer: z.string().max(80).optional(),
  issuerCnpj: z.string().max(18).optional(),
  indexer: z.enum(['cdi', 'ipca', 'prefixed', 'selic', 'other']).optional(),
  rate: z.string().max(30).optional(),
  maturity: isoDate.optional(),
  dailyLiquidity: z.boolean().optional(),
  incentivized: z.boolean().optional(),
  fixedIncomeEtf: z.boolean().optional(),
  fundClass: z.enum(['fixed', 'multi', 'equity']).optional(),
  plan: z.enum(['pgbl', 'vgbl']).optional(),
  cryptoClass: z.enum(['bitcoin', 'altcoin', 'stablecoin']).optional(),
  treasuryTitle: z.enum(['selic', 'ipca', 'prefixed', 'renda', 'educa']).optional(),
  earningKind: z.enum(['dividend', 'jcp', 'interest', 'fii_income', 'other']).optional(),
  taxWithheld: cents.optional(),
  note: z.string().max(500).optional(),
  createdAt: stamp,
  updatedAt: stamp,
})

const report = z.object({
  id,
  name: z.string().min(1).max(60),
  filters: z.object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    preset: z.enum(['thisMonth', 'lastMonth', 'last3', 'last12', 'thisYear', 'lastYear']).optional(),
    kinds: z.array(kind),
    categoryIds: z.array(id),
    bankIds: z.array(id),
    text: z.string().max(120).optional(),
  }),
  groupBy: z.enum(['category', 'bank', 'month', 'counterparty']),
  createdAt: stamp,
})

export const dataSchema = z
  .object({
    version: z.literal(1),
    banks: z.array(bank).max(500),
    categories: z.array(category).max(500),
    transactions: z.array(transaction).max(200_000),
    investments: z.array(investment).max(100_000),
    reports: z.array(report).max(200),
  })
  .superRefine((data, ctx) => {
    const bankIds = new Set(data.banks.map((b) => b.id))
    const categories = new Map(data.categories.map((c) => [c.id, c.kind]))
    if (bankIds.size !== data.banks.length) ctx.addIssue({ code: 'custom', message: 'bancos repetidos' })
    if (data.banks.filter((b) => b.isPrimary).length > 1) ctx.addIssue({ code: 'custom', message: 'mais de um banco principal' })
    for (const t of data.transactions) {
      if (!bankIds.has(t.bankId)) ctx.addIssue({ code: 'custom', message: `lançamento ${t.id} com banco inexistente` })
      if (categories.get(t.categoryId) !== t.kind) ctx.addIssue({ code: 'custom', message: `lançamento ${t.id} com categoria inválida` })
    }
    for (const i of data.investments) {
      if (!bankIds.has(i.bankId)) ctx.addIssue({ code: 'custom', message: `investimento ${i.id} com banco inexistente` })
    }
  })

export const settingsSchema = z.object({
  language: z.enum(['pt', 'en', 'es']),
  currency: z.enum(CURRENCIES as [string, ...string[]]),
  theme: z.enum(['dark', 'light', 'system']),
  /** Só em backups da v0.2 (o nome agora fica em Minha conta). */
  name: z.string().max(40).optional(),
  hideValues: z.boolean(),
  onboardingDone: z.boolean(),
  emailCopies: z.boolean().optional(),
})

export function parseData(value: unknown): DataState {
  return dataSchema.parse(value) as DataState
}

export function parseSettings(value: unknown, fallback: Settings): Settings {
  const result = settingsSchema.partial().safeParse(value)
  if (!result.success) return fallback
  return { ...fallback, ...withoutName(result.data) } as Settings
}

/** Backups da v0.2 traziam o nome do dono nas configurações; agora ele fica em Minha conta. */
function withoutName<T extends { name?: string }>(value: T): Omit<T, 'name'> {
  const copy = { ...value }
  delete copy.name
  return copy
}

export interface BackupFile {
  app: 'lume'
  format: 1
  exportedAt: string
  data: DataState
  settings?: Settings
}

/** Maior arquivo aceito ao restaurar. Um cofre cheio (os tetos de MAX_ITEMS no servidor) dá cerca de
 *  120 MB; o teto antigo de 50 MB recusava backups que o próprio Lume tinha gerado. */
export const BACKUP_MAX_BYTES = 256 * 1024 * 1024

/** Nome do arquivo com a data deste computador (toISOString daria a de Greenwich: "amanhã" à noite). */
export function backupFilename(today: ISODate): string {
  return `lume-backup-${today}.json`
}

/** JSON compacto: cerca de 27% menor que o indentado, mais rápido de gravar, ler e mandar por e-mail. */
export function createBackup(data: DataState, settings: Settings, now = new Date()): string {
  const file: BackupFile = { app: 'lume', format: 1, exportedAt: now.toISOString(), data, settings }
  return JSON.stringify(file)
}

export class BackupError extends Error {}

export interface ParsedBackup {
  data: DataState
  settings?: Partial<Settings>
  exportedAt?: string
}

export function readBackup(text: string): ParsedBackup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new BackupError('json')
  }
  if (!raw || typeof raw !== 'object' || (raw as { app?: unknown }).app !== 'lume') throw new BackupError('not-lume')
  const file = raw as Partial<BackupFile>
  const parsed = dataSchema.safeParse(file.data)
  if (!parsed.success) throw new BackupError('invalid')
  const settings = file.settings ? settingsSchema.partial().safeParse(file.settings) : null
  let kept: Partial<Settings> | undefined
  if (settings?.success) kept = withoutName(settings.data) as Partial<Settings>
  return {
    data: parsed.data as DataState,
    settings: kept,
    exportedAt: typeof file.exportedAt === 'string' ? file.exportedAt : undefined,
  }
}
