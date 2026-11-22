// Cadastros que vêm com o app: bancos, categorias e paleta de cores.

import type { BankKind, Kind } from './types'

export interface BankSeed {
  name: string
  code: string
  kind: BankKind
  color: string
}

/** Principais bancos do Brasil, com o código COMPE. Cores servem só para o monograma. */
export const BANK_CATALOG: BankSeed[] = [
  { name: 'Banco do Brasil', code: '001', kind: 'checking', color: '#F7D117' },
  { name: 'Bradesco', code: '237', kind: 'checking', color: '#CC092F' },
  { name: 'Itaú', code: '341', kind: 'checking', color: '#EC7000' },
  { name: 'Caixa', code: '104', kind: 'checking', color: '#1C60AB' },
  { name: 'Santander', code: '033', kind: 'checking', color: '#EC0000' },
  { name: 'Nubank', code: '260', kind: 'digital', color: '#8A05BE' },
  { name: 'Inter', code: '077', kind: 'digital', color: '#FF7A00' },
  { name: 'C6 Bank', code: '336', kind: 'digital', color: '#3A3A3C' },
  { name: 'BTG Pactual', code: '208', kind: 'checking', color: '#0B3B78' },
  { name: 'Banrisul', code: '041', kind: 'checking', color: '#0A5DB8' },
  { name: 'Sicredi', code: '748', kind: 'checking', color: '#3FA110' },
  { name: 'Sicoob', code: '756', kind: 'checking', color: '#00A091' },
  { name: 'Mercado Pago', code: '323', kind: 'digital', color: '#00B1EA' },
  { name: 'PicPay', code: '380', kind: 'digital', color: '#21C25E' },
  { name: 'PagBank', code: '290', kind: 'digital', color: '#1BB99A' },
  { name: 'Safra', code: '422', kind: 'checking', color: '#1F3A6B' },
  { name: 'Banco BV', code: '655', kind: 'checking', color: '#1C55C6' },
  { name: 'XP Investimentos', code: '102', kind: 'broker', color: '#2C2C2E' },
]

export interface CategorySeed {
  key: string
  kind: Kind
  icon: string
  color: string
}

export const CATEGORY_CATALOG: CategorySeed[] = [
  { key: 'housing', kind: 'expense', icon: 'house', color: '#FF9F0A' },
  { key: 'groceries', kind: 'expense', icon: 'cart', color: '#30D158' },
  { key: 'restaurants', kind: 'expense', icon: 'utensils', color: '#FF6482' },
  { key: 'transport', kind: 'expense', icon: 'car', color: '#0A84FF' },
  { key: 'health', kind: 'expense', icon: 'heart', color: '#FF453A' },
  { key: 'education', kind: 'expense', icon: 'graduation', color: '#5E5CE6' },
  { key: 'leisure', kind: 'expense', icon: 'gamepad', color: '#BF5AF2' },
  { key: 'shopping', kind: 'expense', icon: 'bag', color: '#FF375F' },
  { key: 'subscriptions', kind: 'expense', icon: 'repeat', color: '#64D2FF' },
  { key: 'bills', kind: 'expense', icon: 'zap', color: '#FFD60A' },
  { key: 'travel', kind: 'expense', icon: 'plane', color: '#40C8E0' },
  { key: 'pets', kind: 'expense', icon: 'paw', color: '#AC8E68' },
  { key: 'gifts', kind: 'expense', icon: 'gift', color: '#FF2D55' },
  { key: 'taxes', kind: 'expense', icon: 'landmark', color: '#8E8E93' },
  { key: 'personal_care', kind: 'expense', icon: 'sparkles', color: '#DA8FFF' },
  { key: 'other_expense', kind: 'expense', icon: 'ellipsis', color: '#98989D' },
  { key: 'salary', kind: 'income', icon: 'briefcase', color: '#30D158' },
  { key: 'freelance', kind: 'income', icon: 'laptop', color: '#0A84FF' },
  { key: 'investment_income', kind: 'income', icon: 'trending', color: '#BF5AF2' },
  { key: 'refunds', kind: 'income', icon: 'undo', color: '#64D2FF' },
  { key: 'sales', kind: 'income', icon: 'tag', color: '#FF9F0A' },
  { key: 'gifts_received', kind: 'income', icon: 'gift', color: '#FF375F' },
  { key: 'rent_received', kind: 'income', icon: 'key', color: '#FFD60A' },
  { key: 'other_income', kind: 'income', icon: 'ellipsis', color: '#98989D' },
]

/** Paleta para bancos e categorias criados pelo usuário (cores do sistema Apple). */
export const PALETTE = [
  '#0A84FF',
  '#30D158',
  '#FF9F0A',
  '#FF453A',
  '#BF5AF2',
  '#5E5CE6',
  '#64D2FF',
  '#FFD60A',
  '#FF375F',
  '#AC8E68',
  '#00A091',
  '#8E8E93',
]

export type ColorName = 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'indigo' | 'lightBlue' | 'yellow' | 'pink' | 'tan' | 'teal' | 'gray'

/** Nome de cada cor da paleta, para leitores de tela (o texto fica em i18n, `colorNames`). */
export const PALETTE_NAMES: Record<string, ColorName | undefined> = {
  '#0A84FF': 'blue',
  '#30D158': 'green',
  '#FF9F0A': 'orange',
  '#FF453A': 'red',
  '#BF5AF2': 'purple',
  '#5E5CE6': 'indigo',
  '#64D2FF': 'lightBlue',
  '#FFD60A': 'yellow',
  '#FF375F': 'pink',
  '#AC8E68': 'tan',
  '#00A091': 'teal',
  '#8E8E93': 'gray',
}

/** Ícones oferecidos no cadastro de categoria, na ordem da grade (o desenho fica em ui/icons.tsx). */
export const CATEGORY_ICONS = [
  'house', 'cart', 'utensils', 'coffee', 'car', 'fuel', 'bus', 'bike', 'plane',
  'heart', 'stethoscope', 'pill', 'dumbbell', 'graduation', 'book', 'baby', 'gamepad', 'music',
  'tv', 'camera', 'palette', 'ticket', 'bag', 'shirt', 'gift', 'sparkles', 'flower',
  'paw', 'cat', 'dog', 'repeat', 'zap', 'wifi', 'phone', 'wrench', 'hammer',
  'sofa', 'landmark', 'receipt', 'card', 'wallet', 'banknote', 'handcoins', 'piggy', 'briefcase',
  'laptop', 'trending', 'undo', 'tag', 'key', 'trophy', 'ellipsis',
] as const

export type CategoryIconName = (typeof CATEGORY_ICONS)[number]
