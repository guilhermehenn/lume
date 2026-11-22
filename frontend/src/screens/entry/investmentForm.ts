// Estado do formulário de investimento e a conversão para o que model.saveInvestment espera.

import { totalFromQuantity } from '../../lib/money'
import { primaryBank, type InvestmentInput } from '../../data/model'
import type {
  CryptoClass,
  DataState,
  EarningKind,
  FundClass,
  Indexer,
  Investment,
  InvestmentOperation,
  InvestmentTypeId,
  PensionPlan,
  TreasuryTitle,
} from '../../data/types'

export interface InvForm {
  operation: InvestmentOperation
  type: InvestmentTypeId
  bankId: string
  asset: string
  quantity?: number
  unitPrice: number
  fees: number
  issuer: string
  issuerCnpj: string
  indexer?: Indexer
  rate: string
  maturity: string
  dailyLiquidity: boolean
  incentivized: boolean
  fixedIncomeEtf: boolean
  fundClass?: FundClass
  plan?: PensionPlan
  cryptoClass?: CryptoClass
  treasuryTitle?: TreasuryTitle
  earningKind?: EarningKind
  taxWithheld: number
}

/** Instituição do último investimento lançado; senão a primeira corretora; senão o banco principal. */
export function defaultInvestmentBank(data: DataState): string {
  let last: Investment | undefined
  for (const i of data.investments) if (!last || i.createdAt > last.createdAt) last = i
  if (last && data.banks.some((b) => b.id === last.bankId)) return last.bankId
  return data.banks.find((b) => b.kind === 'broker')?.id ?? primaryBank(data)?.id ?? data.banks[0]?.id ?? ''
}

export function initialInvestment(data: DataState, editing?: Investment, preset?: Partial<InvestmentInput>): InvForm {
  const src: Partial<Investment> = editing ?? preset ?? {}
  return {
    operation: src.operation ?? 'contribution',
    type: src.type ?? 'cdb',
    bankId: src.bankId ?? defaultInvestmentBank(data),
    asset: src.asset ?? '',
    quantity: src.quantity,
    unitPrice: src.unitPrice ?? 0,
    fees: src.fees ?? 0,
    issuer: src.issuer ?? '',
    issuerCnpj: src.issuerCnpj ?? '',
    indexer: src.indexer,
    rate: src.rate ?? '',
    maturity: src.maturity ?? '',
    dailyLiquidity: src.dailyLiquidity ?? false,
    incentivized: src.incentivized ?? false,
    fixedIncomeEtf: src.fixedIncomeEtf ?? false,
    fundClass: src.fundClass,
    plan: src.plan,
    cryptoClass: src.cryptoClass,
    treasuryTitle: src.treasuryTitle,
    earningKind: src.earningKind,
    taxWithheld: src.taxWithheld ?? 0,
  }
}

/** Quantidade × preço (+ taxas na aplicação, − taxas no resgate). 0 quando falta algum dos dois. */
export function computedTotal(form: Pick<InvForm, 'operation' | 'quantity' | 'unitPrice' | 'fees'>): number {
  if (!form.quantity || !form.unitPrice) return 0
  if (form.operation === 'redemption') return Math.max(0, totalFromQuantity(form.quantity, form.unitPrice) - form.fees)
  return totalFromQuantity(form.quantity, form.unitPrice, form.fees)
}

/** Campos que mudam o total calculado. */
export const TOTAL_FIELDS: (keyof InvForm)[] = ['operation', 'quantity', 'unitPrice', 'fees']

export function toInvestmentInput(form: InvForm, base: { amount: number; date: string; note: string }): InvestmentInput {
  return {
    operation: form.operation,
    type: form.type,
    amount: base.amount,
    date: base.date,
    bankId: form.bankId,
    asset: form.asset,
    quantity: form.quantity,
    unitPrice: form.unitPrice || undefined,
    fees: form.fees || undefined,
    issuer: form.issuer || undefined,
    issuerCnpj: form.issuerCnpj || undefined,
    indexer: form.indexer,
    rate: form.rate || undefined,
    maturity: form.maturity || undefined,
    dailyLiquidity: form.dailyLiquidity,
    incentivized: form.incentivized,
    fixedIncomeEtf: form.fixedIncomeEtf,
    fundClass: form.fundClass,
    plan: form.plan,
    cryptoClass: form.cryptoClass,
    treasuryTitle: form.treasuryTitle,
    earningKind: form.earningKind,
    taxWithheld: form.taxWithheld || undefined,
    note: base.note,
  }
}
