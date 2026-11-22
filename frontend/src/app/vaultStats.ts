// O que há no cofre, numa linha (Configurações e Minha conta).

import type { DataState } from '../data/types'
import type { I18n } from '../i18n'

/** "18 bancos · 24 categorias · 120 lançamentos · 22 operações de investimento · nenhum relatório salvo" */
export function vaultStats(data: Pick<DataState, 'banks' | 'categories' | 'transactions' | 'investments' | 'reports'>, t: I18n['t']): string {
  return t('settings.stats', {
    banks: t('settings.countBanks', { count: data.banks.length }),
    categories: t('settings.countCategories', { count: data.categories.length }),
    transactions: t('export.countTransactions', { count: data.transactions.length }),
    investments: t('export.countInvestments', { count: data.investments.length }),
    reports: t('settings.countReports', { count: data.reports.length }),
  })
}
