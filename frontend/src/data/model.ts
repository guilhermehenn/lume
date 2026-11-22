// Regras de negócio dos cadastros e lançamentos. Funções puras: recebem o estado e devolvem
// um estado novo (nunca alteram o anterior). Testadas em tests/unit/model.test.ts.

import { isEntryDate } from '../lib/dates'
import { newId, nowISO } from '../lib/ids'
import { normalize } from '../lib/text'
import { en } from '../i18n/en'
import { es } from '../i18n/es'
import { pt } from '../i18n/pt'
import { BANK_CATALOG, CATEGORY_CATALOG, CATEGORY_ICONS } from './catalog'
import { INVESTMENT_TYPE_MAP } from './investments'
import type {
  Bank,
  BankKind,
  Category,
  DataState,
  ID,
  Investment,
  InvestmentOperation,
  InvestmentTypeId,
  Kind,
  PaymentMethod,
  ReportFilters,
  ReportGroupBy,
  SavedReport,
  Transaction,
} from './types'
import { INVESTMENT_OPERATIONS, PAYMENT_METHODS } from './types'

export type DataErrorCode = 'not-found' | 'invalid' | 'in-use' | 'reassign-invalid' | 'duplicate' | 'limit'

export class DataError extends Error {
  constructor(
    public code: DataErrorCode,
    public field?: string,
    public count?: number,
  ) {
    super(field ? `${code}:${field}` : code)
    this.name = 'DataError'
  }
}

export const LIMITS = {
  name: 60,
  counterparty: 120,
  note: 500,
  asset: 80,
  maxAmount: 99_999_999_999_99,
  /** Bancos e categorias por cofre: o mesmo teto do backup, para que todo cofre possa ser restaurado. */
  banks: 500,
  categories: 500,
  reports: 200,
  /** Texto do filtro de relatório (o mesmo teto do servidor). */
  reportText: 120,
} as const

export const BANK_KINDS: BankKind[] = ['checking', 'digital', 'savings', 'broker', 'cash', 'other']
const COLOR_RE = /^#[0-9a-fA-F]{6}$/

export function emptyState(): DataState {
  return { version: 1, banks: [], categories: [], transactions: [], investments: [], reports: [] }
}

export function createSeedData(now: string = nowISO()): DataState {
  return {
    ...emptyState(),
    banks: BANK_CATALOG.map((b) => ({
      id: newId(),
      name: b.name,
      code: b.code,
      kind: b.kind,
      color: b.color,
      initialBalance: 0,
      isPrimary: false,
      createdAt: now,
      updatedAt: now,
    })),
    categories: CATEGORY_CATALOG.map((c) => ({
      id: newId(),
      kind: c.kind,
      nameKey: c.key,
      icon: c.icon,
      color: c.color,
      createdAt: now,
      updatedAt: now,
    })),
  }
}

// ---------------------------------------------------------------- helpers

function cleanText(value: string | undefined, max: number): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function cleanNote(value: string | undefined): string | undefined {
  const text = (value ?? '').trim().slice(0, LIMITS.note)
  return text || undefined
}

function assertAmount(amount: number, field = 'amount'): void {
  if (!Number.isInteger(amount) || amount <= 0 || amount > LIMITS.maxAmount) throw new DataError('invalid', field)
}

function findIndex<T extends { id: ID }>(items: T[], id: ID): number {
  const i = items.findIndex((x) => x.id === id)
  if (i < 0) throw new DataError('not-found')
  return i
}

// ---------------------------------------------------------------- bancos

export interface BankInput {
  name: string
  code?: string
  kind: BankKind
  color: string
  initialBalance: number
  isPrimary: boolean
}

function validateBank(input: BankInput): BankInput {
  const name = cleanText(input.name, LIMITS.name)
  if (!name) throw new DataError('invalid', 'name')
  if (!BANK_KINDS.includes(input.kind)) throw new DataError('invalid', 'kind')
  if (!COLOR_RE.test(input.color)) throw new DataError('invalid', 'color')
  if (!Number.isInteger(input.initialBalance) || Math.abs(input.initialBalance) > LIMITS.maxAmount) {
    throw new DataError('invalid', 'initialBalance')
  }
  // Código COMPE sempre com 3 dígitos ("1" vira "001"). Dinheiro em espécie não tem código.
  const digits = (input.code ?? '').replace(/\D/g, '').slice(0, 3)
  const code = input.kind === 'cash' || !digits ? undefined : digits.padStart(3, '0')
  // Só os campos do banco: nunca espalhar `input` (ele pode trazer id: undefined e apagar o id novo).
  return { name, code, kind: input.kind, color: input.color, initialBalance: input.initialBalance, isPrimary: Boolean(input.isPrimary) }
}

/** Outro banco com o mesmo nome, sem diferença de acento ou maiúsculas ("Itau" = "Itaú"). */
export function duplicateBank(state: DataState, name: string, exceptId?: ID): Bank | undefined {
  const key = normalize(cleanText(name, LIMITS.name))
  return key ? state.banks.find((b) => b.id !== exceptId && normalize(b.name) === key) : undefined
}

function withPrimary(banks: Bank[], primaryId: ID | null): Bank[] {
  return banks.map((b) => (b.isPrimary === (b.id === primaryId) ? b : { ...b, isPrimary: b.id === primaryId }))
}

export function saveBank(state: DataState, input: BankInput & { id?: ID }, now = nowISO()): [DataState, Bank] {
  const clean = validateBank(input)
  const current = input.id ? state.banks.find((b) => b.id === input.id) : undefined
  // Nome repetido vindo de versão anterior não trava a edição: a regra vale quando o nome muda.
  const renamed = !current || normalize(current.name) !== normalize(clean.name)
  if (renamed && duplicateBank(state, clean.name, input.id)) throw new DataError('duplicate', 'name')
  if (!input.id && state.banks.length >= LIMITS.banks) throw new DataError('limit')
  let banks = [...state.banks]
  let bank: Bank
  if (input.id) {
    const i = findIndex(banks, input.id)
    bank = { ...banks[i], ...clean, updatedAt: now }
    banks[i] = bank
  } else {
    bank = { ...clean, id: newId(), createdAt: now, updatedAt: now }
    banks = [...banks, bank]
  }
  if (bank.isPrimary) banks = withPrimary(banks, bank.id)
  return [{ ...state, banks }, banks.find((b) => b.id === bank.id)!]
}

export function setPrimaryBank(state: DataState, id: ID | null): DataState {
  if (id) findIndex(state.banks, id)
  return { ...state, banks: withPrimary(state.banks, id) }
}

export function bankUsage(state: DataState, id: ID): number {
  return state.transactions.filter((t) => t.bankId === id).length + state.investments.filter((i) => i.bankId === id).length
}

/**
 * Exclui um banco. Se ele tem lançamentos, é preciso informar para qual banco eles vão, e a
 * exclusão vira uma junção: o saldo inicial vai junto (o saldo total não muda), o destino passa
 * a ser o principal se o excluído era, e os relatórios salvos filtrados pelo excluído passam a
 * filtrar pelo destino. Sem lançamentos, o banco só sai (e o saldo inicial dele deixa de contar).
 */
export function deleteBank(state: DataState, id: ID, reassignTo?: ID, now = nowISO()): DataState {
  const bank = state.banks[findIndex(state.banks, id)]
  const usage = bankUsage(state, id)
  if (usage > 0) {
    if (!reassignTo) throw new DataError('in-use', undefined, usage)
    if (reassignTo === id || !state.banks.some((b) => b.id === reassignTo)) throw new DataError('reassign-invalid')
  }
  const target = usage > 0 ? reassignTo : undefined
  let banks = state.banks.filter((b) => b.id !== id)
  if (target) {
    banks = banks.map((b) => {
      if (b.id !== target || (bank.initialBalance === 0 && !bank.isPrimary)) return b
      const initialBalance = b.initialBalance + bank.initialBalance
      if (Math.abs(initialBalance) > LIMITS.maxAmount) throw new DataError('invalid', 'initialBalance')
      return { ...b, initialBalance, updatedAt: now }
    })
    if (bank.isPrimary) banks = withPrimary(banks, target)
  }
  const move = <T extends { bankId: ID; updatedAt: string }>(items: T[]): T[] =>
    target ? items.map((x) => (x.bankId === id ? { ...x, bankId: target, updatedAt: now } : x)) : items
  return {
    ...state,
    banks,
    transactions: move(state.transactions),
    investments: move(state.investments),
    // Só os relatórios que filtravam por este banco mudam (os outros continuam o mesmo objeto).
    reports: state.reports.map((r) => {
      if (!r.filters.bankIds.includes(id)) return r
      const bankIds = r.filters.bankIds.flatMap((b) => (b !== id ? [b] : target && !r.filters.bankIds.includes(target) ? [target] : []))
      return { ...r, filters: { ...r.filters, bankIds } }
    }),
  }
}

export function primaryBank(state: DataState): Bank | undefined {
  return state.banks.find((b) => b.isPrimary)
}

// ---------------------------------------------------------------- categorias

export interface CategoryInput {
  kind: Kind
  name: string
  icon: string
  color: string
  /** Categoria que veio com o app e não foi renomeada: continua traduzida pelo idioma. */
  keepTranslation?: boolean
}

/** Nomes com que a categoria aparece: o dado pela pessoa ou, se veio com o app, o do catálogo em cada idioma. */
function categoryNames(category: Pick<Category, 'name' | 'nameKey'>): string[] {
  if (category.name) return [category.name]
  if (!category.nameKey) return []
  return [pt, en, es].map((d) => (d.categoryNames as Record<string, string | undefined>)[category.nameKey!]).filter((n): n is string => Boolean(n))
}

/**
 * Outra categoria do mesmo tipo com esse nome, sem diferença de acento ou maiúsculas. As que vieram
 * com o app contam pelo nome em qualquer idioma: "Groceries" repete "Mercado".
 */
export function duplicateCategory(state: DataState, kind: Kind, name: string, exceptId?: ID): Category | undefined {
  const key = normalize(cleanText(name, LIMITS.name))
  if (!key) return undefined
  return state.categories.find((c) => c.id !== exceptId && c.kind === kind && categoryNames(c).some((n) => normalize(n) === key))
}

const ICON_SET: ReadonlySet<string> = new Set(CATEGORY_ICONS)

export function saveCategory(state: DataState, input: CategoryInput & { id?: ID }, now = nowISO()): [DataState, Category] {
  const name = cleanText(input.name, LIMITS.name)
  if (!name) throw new DataError('invalid', 'name')
  if (input.kind !== 'expense' && input.kind !== 'income') throw new DataError('invalid', 'kind')
  if (!COLOR_RE.test(input.color)) throw new DataError('invalid', 'color')
  const categories = [...state.categories]
  const i = input.id ? findIndex(categories, input.id) : -1
  const current = i >= 0 ? categories[i] : undefined
  // Ícone fora da grade só vale se já era o da categoria (cofre de versão anterior).
  if (!ICON_SET.has(input.icon) && input.icon !== current?.icon) throw new DataError('invalid', 'icon')
  // A regra de nome repetido vale quando o nome (ou o tipo) muda: cofres antigos continuam editáveis.
  const unchanged = current && current.kind === input.kind && categoryNames(current).some((n) => normalize(n) === normalize(name))
  if (!unchanged && duplicateCategory(state, input.kind, name, input.id)) throw new DataError('duplicate', 'name')
  if (!current && state.categories.length >= LIMITS.categories) throw new DataError('limit')
  let category: Category
  if (current) {
    if (current.kind !== input.kind && categoryUsage(state, current.id) > 0) throw new DataError('in-use', 'kind')
    category = { ...current, kind: input.kind, name, icon: input.icon, color: input.color, updatedAt: now }
    if (input.keepTranslation && current.nameKey) delete category.name
    categories[i] = category
  } else {
    category = { id: newId(), kind: input.kind, name, icon: input.icon, color: input.color, createdAt: now, updatedAt: now }
    categories.push(category)
  }
  return [{ ...state, categories }, category]
}

export function categoryUsage(state: DataState, id: ID): number {
  return state.transactions.filter((t) => t.categoryId === id).length
}

/**
 * Exclui uma categoria. Se ela tem lançamentos, é preciso informar outra do mesmo tipo para
 * recebê-los; os relatórios salvos filtrados pela excluída passam a filtrar a escolhida.
 */
export function deleteCategory(state: DataState, id: ID, reassignTo?: ID, now = nowISO()): DataState {
  const category = state.categories[findIndex(state.categories, id)]
  const usage = categoryUsage(state, id)
  if (usage > 0) {
    if (!reassignTo) throw new DataError('in-use', undefined, usage)
    const target = state.categories.find((c) => c.id === reassignTo)
    if (!target || target.id === id || target.kind !== category.kind) throw new DataError('reassign-invalid')
  }
  const target = usage > 0 ? reassignTo : undefined
  return {
    ...state,
    categories: state.categories.filter((c) => c.id !== id),
    transactions: target ? state.transactions.map((t) => (t.categoryId === id ? { ...t, categoryId: target, updatedAt: now } : t)) : state.transactions,
    // Só os relatórios que filtravam esta categoria mudam (os outros continuam o mesmo objeto).
    reports: state.reports.map((r) => {
      if (!r.filters.categoryIds.includes(id)) return r
      const categoryIds = r.filters.categoryIds.flatMap((c) => (c !== id ? [c] : target && !r.filters.categoryIds.includes(target) ? [target] : []))
      return { ...r, filters: { ...r.filters, categoryIds } }
    }),
  }
}

// ---------------------------------------------------------------- receitas e despesas

export interface TransactionInput {
  kind: Kind
  amount: number
  date: string
  bankId: ID
  categoryId: ID
  counterparty: string
  paymentMethod?: PaymentMethod
  note?: string
}

export function saveTransaction(state: DataState, input: TransactionInput & { id?: ID }, now = nowISO()): [DataState, Transaction] {
  if (input.kind !== 'expense' && input.kind !== 'income') throw new DataError('invalid', 'kind')
  assertAmount(input.amount)
  if (!isEntryDate(input.date)) throw new DataError('invalid', 'date')
  if (!state.banks.some((b) => b.id === input.bankId)) throw new DataError('invalid', 'bankId')
  const category = state.categories.find((c) => c.id === input.categoryId)
  if (!category || category.kind !== input.kind) throw new DataError('invalid', 'categoryId')
  const counterparty = cleanText(input.counterparty, LIMITS.counterparty)
  if (!counterparty) throw new DataError('invalid', 'counterparty')
  const paymentMethod = input.kind === 'expense' && input.paymentMethod && PAYMENT_METHODS.includes(input.paymentMethod) ? input.paymentMethod : undefined

  const fields = {
    kind: input.kind,
    amount: input.amount,
    date: input.date,
    bankId: input.bankId,
    categoryId: input.categoryId,
    counterparty,
    paymentMethod,
    note: cleanNote(input.note),
  }
  const transactions = [...state.transactions]
  let tx: Transaction
  if (input.id) {
    const i = findIndex(transactions, input.id)
    tx = { ...transactions[i], ...fields, updatedAt: now }
    transactions[i] = tx
  } else {
    tx = { id: newId(), ...fields, createdAt: now, updatedAt: now }
    transactions.push(tx)
  }
  return [{ ...state, transactions }, tx]
}

export function deleteTransaction(state: DataState, id: ID): DataState {
  findIndex(state.transactions, id)
  return { ...state, transactions: state.transactions.filter((t) => t.id !== id) }
}

// ---------------------------------------------------------------- investimentos

export type InvestmentInput = Omit<Investment, 'id' | 'createdAt' | 'updatedAt'>

// CNPJ: desde 31/07/2026 as 12 primeiras posições podem ter letras (CNPJ alfanumérico); os dois
// dígitos verificadores continuam numéricos. O cálculo é o mesmo módulo 11, com cada caractere
// valendo o código ASCII menos 48 (0–9 continuam 0–9; A = 17 … Z = 42). Vale para os dois formatos.
const CNPJ_RE = /^[0-9A-Z]{2}\.?[0-9A-Z]{3}\.?[0-9A-Z]{3}\/?[0-9A-Z]{4}-?\d{2}$/

export function formatCnpj(value: string): string {
  const d = value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 14)
  return d
    .replace(/^([0-9A-Z]{2})([0-9A-Z])/, '$1.$2')
    .replace(/^([0-9A-Z]{2})\.([0-9A-Z]{3})([0-9A-Z])/, '$1.$2.$3')
    .replace(/\.([0-9A-Z]{3})([0-9A-Z])/, '.$1/$2')
    .replace(/\/([0-9A-Z]{4})([0-9A-Z])/, '/$1-$2')
}

export function isValidCnpj(value: string): boolean {
  const text = value.trim().toUpperCase()
  if (!CNPJ_RE.test(text)) return false
  const d = text.replace(/[^0-9A-Z]/g, '')
  if (/^(\d)\1{13}$/.test(d)) return false
  const digit = (i: number) => d.charCodeAt(i) - 48
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const sum = weights.reduce((acc, w, i) => acc + w * digit(i), 0)
    const rest = sum % 11
    return rest < 2 ? 0 : 11 - rest
  }
  return calc(12) === digit(12) && calc(13) === digit(13)
}

function defaultAsset(type: InvestmentTypeId, input: InvestmentInput, bankName: string): string {
  if (type === 'savings') return `Poupança ${bankName}`.trim()
  if (type === 'gold') return 'Ouro'
  if (type === 'treasury' && input.treasuryTitle) {
    const label = { selic: 'Selic', ipca: 'IPCA+', prefixed: 'Prefixado', renda: 'Renda+', educa: 'Educa+' }[input.treasuryTitle]
    return `Tesouro ${label}${input.maturity ? ` ${input.maturity.slice(0, 4)}` : ''}`
  }
  const product: Partial<Record<InvestmentTypeId, string>> = {
    cdb: 'CDB',
    lci_lca: 'LCI/LCA',
    cri_cra: 'CRI/CRA',
    debenture: 'Debênture',
    pension: input.plan ? input.plan.toUpperCase() : 'Previdência',
  }
  const label = product[type]
  if (label) return `${label} ${cleanText(input.issuer, LIMITS.asset) || bankName}`.trim()
  return ''
}

/**
 * Nome com que o ativo é gravado: o digitado (ticker em maiúsculas) ou um padrão ("Tesouro
 * IPCA+ 2035", "CDB Nubank"). O formulário usa o mesmo nome para achar a posição em carteira.
 */
export function resolveAsset(input: Pick<InvestmentInput, 'type' | 'asset' | 'treasuryTitle' | 'maturity' | 'issuer' | 'plan'>, bankName: string): string {
  const meta = INVESTMENT_TYPE_MAP[input.type]
  const typed = meta.fields.includes('asset') ? cleanText(input.asset, LIMITS.asset) : ''
  return (meta.assetLabel === 'ticker' ? typed.toUpperCase() : typed) || defaultAsset(input.type, input as InvestmentInput, bankName)
}

export function saveInvestment(state: DataState, input: InvestmentInput & { id?: ID }, now = nowISO()): [DataState, Investment] {
  const meta = INVESTMENT_TYPE_MAP[input.type]
  if (!meta) throw new DataError('invalid', 'type')
  if (!INVESTMENT_OPERATIONS.includes(input.operation as InvestmentOperation)) throw new DataError('invalid', 'operation')
  assertAmount(input.amount)
  if (!isEntryDate(input.date)) throw new DataError('invalid', 'date')
  const bank = state.banks.find((b) => b.id === input.bankId)
  if (!bank) throw new DataError('invalid', 'bankId')

  const allowed = new Set(meta.fields)
  if (input.type === 'treasury' && !input.treasuryTitle) throw new DataError('invalid', 'treasuryTitle')
  const finalAsset = resolveAsset(input, bank.name)
  if (!finalAsset) throw new DataError('invalid', 'asset')

  if (input.quantity !== undefined && (!Number.isFinite(input.quantity) || input.quantity <= 0)) throw new DataError('invalid', 'quantity')
  if (input.unitPrice !== undefined && (!Number.isInteger(input.unitPrice) || input.unitPrice < 0)) throw new DataError('invalid', 'unitPrice')
  if (input.fees !== undefined && (!Number.isInteger(input.fees) || input.fees < 0)) throw new DataError('invalid', 'fees')
  if (input.taxWithheld !== undefined && (!Number.isInteger(input.taxWithheld) || input.taxWithheld < 0)) throw new DataError('invalid', 'taxWithheld')
  if (input.maturity !== undefined && input.maturity !== '' && !isEntryDate(input.maturity)) throw new DataError('invalid', 'maturity')
  if (input.issuerCnpj && !isValidCnpj(input.issuerCnpj)) throw new DataError('invalid', 'issuerCnpj')
  if (meta.quantityBased && input.operation !== 'earning' && (input.quantity === undefined || input.quantity <= 0)) {
    throw new DataError('invalid', 'quantity')
  }
  // Taxas da aplicação estão dentro do valor; IR retido sai do rendimento. O servidor confere o mesmo.
  if (input.operation === 'contribution' && input.fees && input.fees > input.amount) throw new DataError('invalid', 'fees')
  if (input.operation === 'earning' && input.taxWithheld && input.taxWithheld > input.amount) throw new DataError('invalid', 'taxWithheld')

  const pick = <K extends keyof InvestmentInput>(key: K): InvestmentInput[K] | undefined =>
    allowed.has(key as never) ? input[key] : undefined
  const isEarning = input.operation === 'earning'

  const fields: InvestmentInput = {
    operation: input.operation,
    type: input.type,
    amount: input.amount,
    date: input.date,
    bankId: input.bankId,
    asset: finalAsset,
    quantity: isEarning ? undefined : pick('quantity'),
    unitPrice: isEarning ? undefined : pick('unitPrice'),
    fees: isEarning ? undefined : pick('fees') || undefined,
    issuer: cleanText(pick('issuer') as string | undefined, LIMITS.asset) || undefined,
    issuerCnpj: pick('issuerCnpj') ? formatCnpj(input.issuerCnpj!) : undefined,
    indexer: pick('indexer'),
    rate: cleanText(pick('rate') as string | undefined, 30) || undefined,
    maturity: pick('maturity') || undefined,
    dailyLiquidity: pick('dailyLiquidity') ? true : undefined,
    incentivized: pick('incentivized') ? true : undefined,
    fixedIncomeEtf: pick('fixedIncomeEtf') ? true : undefined,
    fundClass: pick('fundClass'),
    plan: pick('plan'),
    cryptoClass: pick('cryptoClass'),
    treasuryTitle: pick('treasuryTitle'),
    earningKind: isEarning ? input.earningKind ?? 'other' : undefined,
    taxWithheld: isEarning ? input.taxWithheld || undefined : undefined,
    note: cleanNote(input.note),
  }
  for (const key of Object.keys(fields) as (keyof InvestmentInput)[]) {
    if (fields[key] === undefined) delete fields[key]
  }

  const investments = [...state.investments]
  let inv: Investment
  if (input.id) {
    const i = findIndex(investments, input.id)
    inv = { id: input.id, ...fields, createdAt: investments[i].createdAt, updatedAt: now }
    investments[i] = inv
  } else {
    inv = { id: newId(), ...fields, createdAt: now, updatedAt: now }
    investments.push(inv)
  }
  return [{ ...state, investments }, inv]
}

export function deleteInvestment(state: DataState, id: ID): DataState {
  findIndex(state.investments, id)
  return { ...state, investments: state.investments.filter((i) => i.id !== id) }
}

// ---------------------------------------------------------------- relatórios salvos

const KINDS: readonly Kind[] = ['expense', 'income']

/**
 * Filtros de relatório limpos: datas em ordem, sem repetição, só bancos e categorias que existem
 * (o servidor recusa os que não existem) e o período relativo guardado como tal.
 */
function cleanReportFilters(state: DataState, f: ReportFilters): ReportFilters {
  if ((f.from && !isEntryDate(f.from)) || (f.to && !isEntryDate(f.to)) || (f.from && f.to && f.from > f.to)) {
    throw new DataError('invalid', 'period')
  }
  const banks = new Set(state.banks.map((b) => b.id))
  const categories = new Set(state.categories.map((c) => c.id))
  const text = cleanText(f.text, LIMITS.reportText)
  const out: ReportFilters = {
    from: f.from,
    to: f.to,
    kinds: [...new Set(f.kinds)].filter((k) => KINDS.includes(k)),
    categoryIds: [...new Set(f.categoryIds)].filter((id) => categories.has(id)),
    bankIds: [...new Set(f.bankIds)].filter((id) => banks.has(id)),
  }
  if (text) out.text = text
  if (f.preset) out.preset = f.preset
  if (!out.from) delete out.from
  if (!out.to) delete out.to
  return out
}

export function saveReport(
  state: DataState,
  input: { id?: ID; name: string; filters: ReportFilters; groupBy: ReportGroupBy },
  now = nowISO(),
): [DataState, SavedReport] {
  const name = cleanText(input.name, LIMITS.name)
  if (!name) throw new DataError('invalid', 'name')
  const i = input.id ? findIndex(state.reports, input.id) : -1
  if (state.reports.some((r) => r.id !== input.id && normalize(r.name) === normalize(name))) throw new DataError('duplicate', 'name')
  if (i < 0 && state.reports.length >= LIMITS.reports) throw new DataError('limit')
  const filters = cleanReportFilters(state, input.filters)
  const reports = [...state.reports]
  let report: SavedReport
  if (i >= 0) {
    report = { ...reports[i], name, filters, groupBy: input.groupBy }
    reports[i] = report
  } else {
    report = { id: newId(), name, filters, groupBy: input.groupBy, createdAt: now }
    reports.push(report)
  }
  return [{ ...state, reports }, report]
}

export function deleteReport(state: DataState, id: ID): DataState {
  findIndex(state.reports, id)
  return { ...state, reports: state.reports.filter((r) => r.id !== id) }
}
