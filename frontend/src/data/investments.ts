// Tipos de investimento: campos de cada um e a sugestão de Grupo/Código da ficha
// "Bens e Direitos" do IRPF (Receita Federal). Sugestão para o contador conferir.

import type { Investment, InvestmentTypeId } from './types'

export type InvestmentField =
  | 'asset'
  | 'issuer'
  | 'issuerCnpj'
  | 'indexer'
  | 'rate'
  | 'maturity'
  | 'dailyLiquidity'
  | 'incentivized'
  | 'treasuryTitle'
  | 'quantity'
  | 'unitPrice'
  | 'fees'
  | 'fixedIncomeEtf'
  | 'fundClass'
  | 'plan'
  | 'cryptoClass'

export type TaxTreatment = 'exempt' | 'taxable' | 'variable' | 'capitalGain' | 'depends'

export interface InvestmentTypeMeta {
  id: InvestmentTypeId
  icon: string
  color: string
  fields: InvestmentField[]
  /** Usa quantidade × preço (renda variável, cripto, Tesouro). */
  quantityBased: boolean
  tax: TaxTreatment
  /** Chave de tradução do rótulo do campo "ativo". */
  assetLabel: 'ticker' | 'fundName' | 'planName' | 'crypto' | 'description'
}

const FIXED_INCOME: InvestmentField[] = ['asset', 'issuer', 'issuerCnpj', 'indexer', 'rate', 'maturity', 'dailyLiquidity']
const LISTED: InvestmentField[] = ['asset', 'quantity', 'unitPrice', 'fees']

export const INVESTMENT_TYPES: InvestmentTypeMeta[] = [
  { id: 'savings', icon: 'piggy', color: '#30D158', fields: [], quantityBased: false, tax: 'exempt', assetLabel: 'description' },
  { id: 'cdb', icon: 'landmark', color: '#0A84FF', fields: FIXED_INCOME, quantityBased: false, tax: 'taxable', assetLabel: 'description' },
  { id: 'lci_lca', icon: 'sprout', color: '#00C7BE', fields: FIXED_INCOME, quantityBased: false, tax: 'exempt', assetLabel: 'description' },
  { id: 'cri_cra', icon: 'building', color: '#008F83', fields: FIXED_INCOME.filter((f) => f !== 'dailyLiquidity'), quantityBased: false, tax: 'exempt', assetLabel: 'description' },
  { id: 'debenture', icon: 'file', color: '#5E5CE6', fields: ['asset', 'issuer', 'issuerCnpj', 'indexer', 'rate', 'maturity', 'incentivized'], quantityBased: false, tax: 'depends', assetLabel: 'description' },
  { id: 'treasury', icon: 'shield', color: '#FFD60A', fields: ['treasuryTitle', 'maturity', 'quantity', 'unitPrice', 'rate'], quantityBased: true, tax: 'taxable', assetLabel: 'description' },
  { id: 'stock', icon: 'trending', color: '#BF5AF2', fields: LISTED, quantityBased: true, tax: 'variable', assetLabel: 'ticker' },
  { id: 'fii', icon: 'building', color: '#FF6482', fields: ['asset', 'issuerCnpj', 'quantity', 'unitPrice', 'fees'], quantityBased: true, tax: 'variable', assetLabel: 'ticker' },
  { id: 'fiagro', icon: 'sprout', color: '#8DB600', fields: ['asset', 'issuerCnpj', 'quantity', 'unitPrice', 'fees'], quantityBased: true, tax: 'variable', assetLabel: 'ticker' },
  { id: 'etf', icon: 'chart', color: '#64D2FF', fields: [...LISTED, 'fixedIncomeEtf'], quantityBased: true, tax: 'variable', assetLabel: 'ticker' },
  { id: 'bdr', icon: 'globe', color: '#7D7AFF', fields: LISTED, quantityBased: true, tax: 'variable', assetLabel: 'ticker' },
  { id: 'fund', icon: 'pie', color: '#DA8FFF', fields: ['asset', 'issuerCnpj', 'fundClass', 'quantity'], quantityBased: false, tax: 'depends', assetLabel: 'fundName' },
  { id: 'pension', icon: 'umbrella', color: '#AC8E68', fields: ['asset', 'plan', 'issuerCnpj'], quantityBased: false, tax: 'depends', assetLabel: 'planName' },
  { id: 'crypto', icon: 'bitcoin', color: '#F7931A', fields: ['asset', 'cryptoClass', 'quantity', 'unitPrice', 'fees'], quantityBased: true, tax: 'capitalGain', assetLabel: 'crypto' },
  { id: 'gold', icon: 'gem', color: '#C9A227', fields: ['quantity', 'unitPrice'], quantityBased: true, tax: 'capitalGain', assetLabel: 'description' },
  { id: 'other', icon: 'ellipsis', color: '#8E8E93', fields: ['asset', 'issuer'], quantityBased: false, tax: 'depends', assetLabel: 'description' },
]

export const INVESTMENT_TYPE_MAP = Object.fromEntries(INVESTMENT_TYPES.map((t) => [t.id, t])) as Record<
  InvestmentTypeId,
  InvestmentTypeMeta
>

export interface IrpfCode {
  group: string
  code: string
}

/**
 * Grupo/Código sugerido na ficha "Bens e Direitos" (tabela do IRPF 2026, ano-calendário 2025).
 * null = não vai nessa ficha (PGBL entra em "Pagamentos efetuados").
 */
export function irpfCode(inv: Pick<Investment, 'type' | 'incentivized' | 'fixedIncomeEtf' | 'fundClass' | 'plan' | 'cryptoClass'>): IrpfCode | null {
  switch (inv.type) {
    case 'savings':
      return { group: '04', code: '01' }
    case 'cdb':
    case 'treasury':
      return { group: '04', code: '02' }
    case 'lci_lca':
    case 'cri_cra':
      return { group: '04', code: '03' }
    case 'debenture':
      return { group: '04', code: inv.incentivized ? '03' : '02' }
    case 'stock':
      return { group: '03', code: '01' }
    case 'fii':
      return { group: '07', code: '03' }
    case 'fiagro':
      return { group: '07', code: '02' }
    case 'etf':
      // Renda fixa: 08. Ações e cripto: 06 desde o IRPF 2025 (antes era 09).
      return { group: '07', code: inv.fixedIncomeEtf ? '08' : '06' }
    case 'bdr':
      return { group: '04', code: '04' }
    case 'fund':
      return { group: '07', code: inv.fundClass === 'equity' ? '04' : '01' }
    case 'pension':
      return inv.plan === 'vgbl' ? { group: '99', code: '06' } : null
    case 'crypto':
      return { group: '08', code: inv.cryptoClass === 'altcoin' ? '02' : inv.cryptoClass === 'stablecoin' ? '03' : '01' }
    case 'gold':
      return { group: '04', code: '05' }
    case 'other':
      return { group: '04', code: '99' }
  }
}

export function formatIrpf(code: IrpfCode | null): string {
  return code ? `${code.group} · ${code.code}` : '—'
}

/** Chave usada para agrupar operações do mesmo ativo (posição). */
export function positionKey(inv: Pick<Investment, 'type' | 'asset' | 'bankId'>): string {
  return `${inv.type}|${inv.asset.trim().toUpperCase()}|${inv.bankId}`
}
