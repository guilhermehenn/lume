// Modelo de dados do Lume. Espelha o cofre no back-end (UUID, centavos inteiros, datas AAAA-MM-DD).

import type { ISODate } from '../lib/dates'
import type { Currency } from '../lib/money'
import type { PeriodPreset } from '../lib/period'

export type ID = string
export type Kind = 'expense' | 'income'

export type BankKind = 'checking' | 'digital' | 'savings' | 'broker' | 'cash' | 'other'

export interface Bank {
  id: ID
  name: string
  /** Código COMPE (ex.: 341 Itaú). Opcional. */
  code?: string
  kind: BankKind
  color: string
  /** Saldo inicial em centavos. */
  initialBalance: number
  isPrimary: boolean
  createdAt: string
  updatedAt: string
}

export interface Category {
  id: ID
  kind: Kind
  /** Chave de tradução das categorias que vêm com o app. */
  nameKey?: string
  /** Nome digitado pelo usuário (prevalece sobre nameKey). */
  name?: string
  icon: string
  color: string
  createdAt: string
  updatedAt: string
}

export type PaymentMethod = 'pix' | 'debit' | 'credit' | 'boleto' | 'cash' | 'transfer'
export const PAYMENT_METHODS: PaymentMethod[] = ['pix', 'debit', 'credit', 'boleto', 'cash', 'transfer']

export interface Transaction {
  id: ID
  kind: Kind
  /** Valor em centavos, sempre positivo. O tipo diz se entra ou sai. */
  amount: number
  date: ISODate
  bankId: ID
  categoryId: ID
  /** "Pago a" (despesa) ou "Recebido de" (receita). */
  counterparty: string
  paymentMethod?: PaymentMethod
  note?: string
  createdAt: string
  updatedAt: string
}

export type InvestmentOperation = 'contribution' | 'redemption' | 'earning'
export const INVESTMENT_OPERATIONS: InvestmentOperation[] = ['contribution', 'redemption', 'earning']

export type InvestmentTypeId =
  | 'savings'
  | 'cdb'
  | 'lci_lca'
  | 'cri_cra'
  | 'debenture'
  | 'treasury'
  | 'stock'
  | 'fii'
  | 'fiagro'
  | 'etf'
  | 'bdr'
  | 'fund'
  | 'pension'
  | 'crypto'
  | 'gold'
  | 'other'

export type Indexer = 'cdi' | 'ipca' | 'prefixed' | 'selic' | 'other'
export type TreasuryTitle = 'selic' | 'ipca' | 'prefixed' | 'renda' | 'educa'
export type FundClass = 'fixed' | 'multi' | 'equity'
export type PensionPlan = 'pgbl' | 'vgbl'
export type CryptoClass = 'bitcoin' | 'altcoin' | 'stablecoin'
export type EarningKind = 'dividend' | 'jcp' | 'interest' | 'fii_income' | 'other'

export interface Investment {
  id: ID
  operation: InvestmentOperation
  type: InvestmentTypeId
  /** Valor da operação em centavos (sempre positivo). */
  amount: number
  date: ISODate
  /** Instituição onde o investimento fica (banco ou corretora). */
  bankId: ID
  /** Ativo, ticker, título ou descrição. */
  asset: string
  quantity?: number
  /** Preço unitário em centavos. */
  unitPrice?: number
  /** Taxas e corretagem em centavos. */
  fees?: number
  issuer?: string
  issuerCnpj?: string
  indexer?: Indexer
  rate?: string
  maturity?: ISODate
  dailyLiquidity?: boolean
  incentivized?: boolean
  fixedIncomeEtf?: boolean
  fundClass?: FundClass
  plan?: PensionPlan
  cryptoClass?: CryptoClass
  treasuryTitle?: TreasuryTitle
  earningKind?: EarningKind
  /** IR retido na fonte, em centavos. */
  taxWithheld?: number
  note?: string
  createdAt: string
  updatedAt: string
}

export type ReportGroupBy = 'category' | 'bank' | 'month' | 'counterparty'

export interface ReportFilters {
  from?: ISODate
  to?: ISODate
  /** Período relativo ("Este mês"): ao abrir o relatório salvo, as datas são as de hoje. Sem ele, valem from/to. */
  preset?: Exclude<PeriodPreset, 'custom'>
  kinds: Kind[]
  categoryIds: ID[]
  bankIds: ID[]
  text?: string
}

export interface SavedReport {
  id: ID
  name: string
  filters: ReportFilters
  groupBy: ReportGroupBy
  createdAt: string
}

export interface DataState {
  version: 1
  banks: Bank[]
  categories: Category[]
  transactions: Transaction[]
  investments: Investment[]
  reports: SavedReport[]
}

export type Language = 'pt' | 'en' | 'es'
export type Theme = 'dark' | 'light' | 'system'

/** Preferências guardadas no cofre (o nome do dono fica em Minha conta). */
export interface Settings {
  language: Language
  currency: Currency
  theme: Theme
  hideValues: boolean
  onboardingDone: boolean
  /** Manda por e-mail uma cópia de cada arquivo exportado. */
  emailCopies: boolean
}
