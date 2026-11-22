// Arquivos para o contador: pacote .xlsx do ano, CSVs e linhas do relatório anual.
// Funções puras (recebem o estado e um contexto de tradução), testadas em tests/unit/exporters.test.ts.

import { csvDecimal, csvQuantity, toCsv, type CsvCell } from '../lib/csv'
import { inRange, toISODate, yearRange, type ISODate, type MonthKey } from '../lib/dates'
import type { XlsxCell, XlsxSheet } from '../lib/xlsx'
import { INVESTMENT_TYPE_MAP, irpfCode, positionKey } from './investments'
import { bankBalances, categoryTotals, investmentPositions, type PeriodSummary } from './selectors'
import type { Bank, Category, DataState, EarningKind, ID, Investment, Transaction } from './types'

export interface ExportContext {
  /** Tradução por chave (ex.: 'export.cols.date'). */
  t: (key: string, params?: Record<string, string | number>) => string
  categoryName: (category: Pick<Category, 'name' | 'nameKey'> | undefined) => string
  /** Data para CSV no formato do idioma (ex.: 20/11/2026). */
  csvDate: (date: ISODate) => string
  monthLabel: (month: string) => string
  /** Separador do CSV: ";" (pt/es) ou "," (en). */
  separator: string
  /** Moeda dos valores, por extenso (ex.: "Real brasileiro (R$)"), para o Leia-me. */
  currencyName: string
  ownerName: string
  now: Date
}

// ---------------------------------------------------------------- anos

export interface YearCount {
  transactions: number
  investments: number
}

/** Quantos lançamentos e operações cada ano tem (do mais recente ao mais antigo), numa passada.
 *  O ano atual sempre aparece, mesmo vazio. */
export function yearCounts(state: DataState, now = new Date()): Map<number, YearCount> {
  const counts = new Map<number, YearCount>()
  const of = (year: number) => {
    let count = counts.get(year)
    if (!count) {
      count = { transactions: 0, investments: 0 }
      counts.set(year, count)
    }
    return count
  }
  of(now.getFullYear())
  for (const x of state.transactions) of(Number(x.date.slice(0, 4))).transactions++
  for (const x of state.investments) of(Number(x.date.slice(0, 4))).investments++
  return new Map([...counts].sort((a, b) => b[0] - a[0]))
}

export function availableYears(state: DataState, now = new Date()): number[] {
  return [...yearCounts(state, now).keys()]
}

/** Ano que abre a exportação e o relatório de investimentos: até junho (época da declaração do IR),
 *  o ano anterior; depois, o ano atual. Nunca um ano futuro só porque há lançamento agendado. */
export function defaultTaxYear(years: number[], today: ISODate): number {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  if (month <= 6) return years.find((y) => y < year) ?? years.find((y) => y <= year) ?? years[0] ?? year
  return years.includes(year) ? year : (years.find((y) => y < year) ?? years[0] ?? year)
}

// ---------------------------------------------------------------- consultas

/** Bancos e categorias por id, montados uma vez por arquivo (antes: um mapa novo e uma busca na
 *  lista inteira a cada linha). */
interface Lookups {
  bank: (id: ID) => Bank | undefined
  category: (id: ID) => Category | undefined
}

function lookups(state: DataState): Lookups {
  const banks = new Map(state.banks.map((b) => [b.id, b]))
  const categories = new Map(state.categories.map((c) => [c.id, c]))
  return { bank: (id) => banks.get(id), category: (id) => categories.get(id) }
}

function sortByDate<T extends { date: string; createdAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
}

// ---------------------------------------------------------------- linhas comuns

function transactionRow(tx: Transaction, ctx: ExportContext, look: Lookups) {
  const bank = look.bank(tx.bankId)
  return {
    date: tx.date,
    kind: ctx.t(`kinds.${tx.kind}`),
    category: ctx.categoryName(look.category(tx.categoryId)),
    counterparty: tx.counterparty,
    bank: bank?.name ?? '',
    bankCode: bank?.code ?? '',
    paymentMethod: tx.paymentMethod ? ctx.t(`paymentMethods.${tx.paymentMethod}`) : '',
    amount: tx.amount,
    signed: tx.kind === 'expense' ? -tx.amount : tx.amount,
    note: tx.note ?? '',
  }
}

function investmentRow(inv: Investment, ctx: ExportContext, look: Lookups) {
  const bank = look.bank(inv.bankId)
  const code = irpfCode(inv)
  return {
    date: inv.date,
    operation: ctx.t(`operations.${inv.operation}`),
    type: ctx.t(`investmentTypes.${inv.type}`),
    asset: inv.asset,
    bank: bank?.name ?? '',
    quantity: inv.quantity,
    unitPrice: inv.unitPrice,
    fees: inv.fees,
    amount: inv.amount,
    issuer: inv.issuer ?? '',
    cnpj: inv.issuerCnpj ?? '',
    indexer: inv.indexer ? ctx.t(`indexers.${inv.indexer}`) : '',
    rate: inv.rate ?? '',
    maturity: inv.maturity ?? '',
    earningKind: inv.earningKind ? ctx.t(`earningKinds.${inv.earningKind}`) : '',
    taxWithheld: inv.taxWithheld,
    group: code?.group ?? '',
    code: code?.code ?? '',
    tax: ctx.t(`tax.${INVESTMENT_TYPE_MAP[inv.type].tax}`),
    note: inv.note ?? '',
  }
}

// ---------------------------------------------------------------- posição em 31/12

export interface YearPosition {
  key: string
  type: Investment['type']
  asset: string
  bank: string
  cnpj: string
  group: string
  code: string
  tax: string
  quantity: number
  averagePrice: number | null
  costPrevious: number
  costCurrent: number
  earnings: number
  taxWithheld: number
  realized: number
}

/** Posição de cada ativo em 31/12 do ano e do ano anterior (custo de aquisição), como na ficha Bens e Direitos. */
export function yearPositions(state: DataState, year: number, ctx: ExportContext): YearPosition[] {
  const previous = new Map(investmentPositions(state, `${year - 1}-12-31`).map((p) => [p.key, p]))
  const current = investmentPositions(state, `${year}-12-31`)
  const { from, to } = yearRange(year)
  const earnings = new Map<string, { total: number; tax: number }>()
  // CNPJ mais recente de cada posição, numa passada (antes: uma busca na lista inteira por posição).
  const cnpjs = new Map<string, string>()
  for (const inv of state.investments) {
    if (inv.issuerCnpj) cnpjs.set(positionKey(inv), inv.issuerCnpj)
    if (inv.operation !== 'earning' || !inRange(inv.date, from, to)) continue
    const key = positionKey(inv)
    const e = earnings.get(key) ?? { total: 0, tax: 0 }
    e.total += inv.amount
    e.tax += inv.taxWithheld ?? 0
    earnings.set(key, e)
  }
  const { bank } = lookups(state)
  const rows: YearPosition[] = []
  for (const p of current) {
    const prev = previous.get(p.key)
    const e = earnings.get(p.key)
    if (p.cost <= 0 && (prev?.cost ?? 0) <= 0 && !e && p.realized === (prev?.realized ?? 0)) continue
    const code = irpfCode(p.last)
    const cnpj = cnpjs.get(p.key) ?? ''
    rows.push({
      key: p.key,
      type: p.type,
      asset: p.asset,
      bank: bank(p.bankId)?.name ?? '',
      cnpj,
      group: code?.group ?? '',
      code: code?.code ?? '',
      tax: ctx.t(`tax.${INVESTMENT_TYPE_MAP[p.type].tax}`),
      quantity: p.quantity,
      averagePrice: p.averagePrice,
      costPrevious: prev?.cost ?? 0,
      costCurrent: p.cost,
      earnings: e?.total ?? 0,
      taxWithheld: e?.tax ?? 0,
      realized: p.realized - (prev?.realized ?? 0),
    })
  }
  // Por grupo e código da ficha; o que não vai em Bens e Direitos (PGBL) fica no fim.
  return rows.sort((a, b) => Number(!a.group) - Number(!b.group) || a.group.localeCompare(b.group) || a.code.localeCompare(b.code) || a.asset.localeCompare(b.asset))
}

// ---------------------------------------------------------------- pacote .xlsx

export function accountantSheets(state: DataState, year: number, ctx: ExportContext): XlsxSheet[] {
  const { t } = ctx
  const c = (key: string) => t(`export.cols.${key}`)
  const { from, to } = yearRange(year)
  const txs = sortByDate(state.transactions.filter((x) => inRange(x.date, from, to)))
  const invs = sortByDate(state.investments.filter((x) => inRange(x.date, from, to)))
  const look = lookups(state)

  const readme: XlsxSheet = {
    name: t('export.sheets.readme'),
    plain: true,
    columns: [{ header: t('export.readme.title', { year }), width: 110 }],
    rows: [
      [t('export.readme.generated', { date: ctx.csvDate(toISODate(ctx.now)) })],
      ...(ctx.ownerName ? [[t('export.readme.owner', { name: ctx.ownerName })]] : []),
      [''],
      [t('export.readme.line1', { currency: ctx.currencyName })],
      [t('export.readme.line2')],
      [t('export.readme.line3')],
      [t('export.readme.line4')],
      [t('export.readme.line5')],
    ],
  }

  const txRows = txs.map((tx) => transactionRow(tx, ctx, look))
  const transactions: XlsxSheet = {
    name: t('export.sheets.transactions'),
    columns: [
      { header: c('date'), type: 'date', width: 12 },
      { header: c('kind'), width: 11 },
      { header: c('category'), width: 22 },
      { header: c('counterparty'), width: 28 },
      { header: c('bank'), width: 18 },
      { header: c('bankCode'), width: 10 },
      { header: c('paymentMethod'), width: 16 },
      { header: c('amount'), type: 'money', width: 14 },
      { header: c('signedAmount'), type: 'money', width: 15 },
      { header: c('note'), width: 36 },
    ],
    rows: txRows.map((r) => [r.date, r.kind, r.category, r.counterparty, r.bank, r.bankCode, r.paymentMethod, r.amount, r.signed, r.note]),
    totalRow: txRows.length ? [c('total'), '', '', '', '', '', '', null, txRows.reduce((s, r) => s + r.signed, 0), ''] : undefined,
  }

  const invRows = invs.map((inv) => investmentRow(inv, ctx, look))
  const investments: XlsxSheet = {
    name: t('export.sheets.investments'),
    columns: [
      { header: c('date'), type: 'date', width: 12 },
      { header: c('operation'), width: 13 },
      { header: c('investmentType'), width: 22 },
      { header: c('asset'), width: 24 },
      { header: c('bank'), width: 18 },
      { header: c('quantity'), type: 'number', width: 12 },
      { header: c('unitPrice'), type: 'money', width: 14 },
      { header: c('fees'), type: 'money', width: 11 },
      { header: c('amount'), type: 'money', width: 14 },
      { header: c('issuer'), width: 20 },
      { header: c('cnpj'), width: 20 },
      { header: c('indexer'), width: 12 },
      { header: c('rate'), width: 16 },
      { header: c('maturity'), type: 'date', width: 12 },
      { header: c('earningKind'), width: 22 },
      { header: c('taxWithheld'), type: 'money', width: 12 },
      { header: c('irpfGroup'), width: 12 },
      { header: c('irpfCode'), width: 12 },
      { header: c('tax'), width: 20 },
      { header: c('note'), width: 30 },
    ],
    rows: invRows.map((r) => [
      r.date, r.operation, r.type, r.asset, r.bank, r.quantity, r.unitPrice, r.fees, r.amount, r.issuer, r.cnpj, r.indexer, r.rate,
      r.maturity, r.earningKind, r.taxWithheld, r.group, r.code, r.tax, r.note,
    ]),
  }

  const pos = yearPositions(state, year, ctx)
  const positions: XlsxSheet = {
    name: t('export.sheets.positions'),
    columns: [
      { header: c('irpfGroup'), width: 12 },
      { header: c('irpfCode'), width: 12 },
      { header: c('investmentType'), width: 22 },
      { header: c('asset'), width: 26 },
      { header: c('bank'), width: 18 },
      { header: c('cnpj'), width: 20 },
      { header: c('quantity'), type: 'number', width: 12 },
      { header: c('averagePrice'), type: 'money', width: 14 },
      { header: c('costPrevious'), type: 'money', width: 18 },
      { header: c('costCurrent'), type: 'money', width: 18 },
      { header: c('earnings'), type: 'money', width: 14 },
      { header: c('taxWithheld'), type: 'money', width: 12 },
      { header: c('realized'), type: 'money', width: 16 },
      { header: c('tax'), width: 20 },
    ],
    rows: pos.map((p) => [
      p.group, p.code, t(`investmentTypes.${p.type}`), p.asset, p.bank, p.cnpj, p.quantity || null, p.averagePrice, p.costPrevious, p.costCurrent,
      p.earnings, p.taxWithheld, p.realized, p.tax,
    ]),
    totalRow: pos.length
      ? [c('total'), '', '', '', '', '', null, null, sum(pos, 'costPrevious'), sum(pos, 'costCurrent'), sum(pos, 'earnings'), sum(pos, 'taxWithheld'), sum(pos, 'realized'), '']
      : undefined,
  }

  const earningInvs = invs.filter((i) => i.operation === 'earning')
  const earnings: XlsxSheet = {
    name: t('export.sheets.earnings'),
    columns: [
      { header: c('date'), type: 'date', width: 12 },
      { header: c('earningKind'), width: 24 },
      { header: c('asset'), width: 24 },
      { header: c('investmentType'), width: 22 },
      { header: c('bank'), width: 18 },
      { header: c('cnpj'), width: 20 },
      { header: c('amount'), type: 'money', width: 14 },
      { header: c('taxWithheld'), type: 'money', width: 12 },
      { header: c('tax'), width: 20 },
    ],
    rows: earningInvs.map((inv) => {
      const r = investmentRow(inv, ctx, look)
      return [r.date, r.earningKind, r.asset, r.type, r.bank, r.cnpj, r.amount, r.taxWithheld, r.tax]
    }),
    totalRow: earningInvs.length
      ? [c('total'), '', '', '', '', '', earningInvs.reduce((s, i) => s + i.amount, 0), earningInvs.reduce((s, i) => s + (i.taxWithheld ?? 0), 0), '']
      : undefined,
  }

  // Os 12 meses e o total do ano numa passada (antes: 13 passadas pela lista inteira).
  const { months: monthRows, total } = yearTotals(state, year)
  const monthly: XlsxSheet = {
    name: t('export.sheets.monthly'),
    columns: [
      { header: c('month'), width: 16 },
      { header: c('income'), type: 'money', width: 15 },
      { header: c('expense'), type: 'money', width: 15 },
      { header: c('balance'), type: 'money', width: 15 },
      { header: c('contributions'), type: 'money', width: 15 },
      { header: c('redemptions'), type: 'money', width: 15 },
      { header: c('earnings'), type: 'money', width: 15 },
    ],
    rows: monthRows.map((r) => [ctx.monthLabel(r.month), r.income, r.expense, r.balance, r.contributions, r.redemptions, r.earnings]),
    totalRow: [c('total'), total.income, total.expense, total.balance, total.contributions, total.redemptions, total.earnings],
  }

  const categoryRows: XlsxCell[][] = []
  for (const kind of ['income', 'expense'] as const) {
    const groups = categoryTotals(state, kind, from, to)
    const kindTotal = groups.reduce((s, g) => s + g.total, 0)
    for (const g of groups) {
      categoryRows.push([t(`kinds.${kind}`), ctx.categoryName(look.category(g.key)), g.total, g.count, kindTotal ? Math.round((g.total / kindTotal) * 10000) / 100 : 0])
    }
  }
  const categories: XlsxSheet = {
    name: t('export.sheets.categories'),
    columns: [
      { header: c('kind'), width: 11 },
      { header: c('category'), width: 26 },
      { header: c('total'), type: 'money', width: 15 },
      { header: c('count'), type: 'number', width: 14 },
      { header: c('share'), type: 'percent', width: 11 },
    ],
    rows: categoryRows,
  }

  const balancesStart = bankBalances(state, `${year - 1}-12-31`)
  const balancesEnd = bankBalances(state, to)
  // Bancos com algum lançamento ou operação, numa passada (antes: duas buscas na lista inteira por banco).
  const usedIds = new Set<ID>()
  for (const x of state.transactions) usedIds.add(x.bankId)
  for (const x of state.investments) usedIds.add(x.bankId)
  const usedBanks = state.banks.filter((b) => b.initialBalance !== 0 || usedIds.has(b.id))
  const banks: XlsxSheet = {
    name: t('export.sheets.banks'),
    columns: [
      { header: c('name'), width: 22 },
      { header: c('bankCode'), width: 10 },
      { header: c('kind'), width: 18 },
      { header: c('initialBalance'), type: 'money', width: 16 },
      { header: c('balancePrevious'), type: 'money', width: 20 },
      { header: c('balanceEnd'), type: 'money', width: 16 },
    ],
    rows: usedBanks.map((b) => [b.name, b.code ?? '', t(`bankKinds.${b.kind}`), b.initialBalance, balancesStart.get(b.id) ?? 0, balancesEnd.get(b.id) ?? 0]),
  }

  return [readme, positions, earnings, transactions, investments, monthly, categories, banks]
}

function sum(rows: YearPosition[], key: 'costPrevious' | 'costCurrent' | 'earnings' | 'taxWithheld' | 'realized'): number {
  return rows.reduce((s, r) => s + r[key], 0)
}

// ---------------------------------------------------------------- CSV

export function transactionsCsv(state: DataState, ctx: ExportContext, range?: { from?: ISODate; to?: ISODate }, list?: Transaction[]): string {
  const c = (key: string) => ctx.t(`export.cols.${key}`)
  const sep = ctx.separator
  const items = sortByDate(list ?? state.transactions.filter((x) => inRange(x.date, range?.from, range?.to)))
  const look = lookups(state)
  const rows: CsvCell[][] = [
    [c('date'), c('kind'), c('category'), c('counterparty'), c('bank'), c('bankCode'), c('paymentMethod'), c('amount'), c('signedAmount'), c('note')],
    ...items.map((tx) => {
      const r = transactionRow(tx, ctx, look)
      return [ctx.csvDate(r.date), r.kind, r.category, r.counterparty, r.bank, r.bankCode, r.paymentMethod, csvDecimal(r.amount, sep), csvDecimal(r.signed, sep), r.note]
    }),
  ]
  return toCsv(rows, sep)
}

export function investmentsCsv(state: DataState, ctx: ExportContext, range?: { from?: ISODate; to?: ISODate }): string {
  const c = (key: string) => ctx.t(`export.cols.${key}`)
  const sep = ctx.separator
  const money = (v: number | undefined) => (v === undefined ? '' : csvDecimal(v, sep))
  const qty = (v: number | undefined) => (v === undefined ? '' : csvQuantity(v, sep))
  const items = sortByDate(state.investments.filter((x) => inRange(x.date, range?.from, range?.to)))
  const look = lookups(state)
  const rows: CsvCell[][] = [
    [
      c('date'), c('operation'), c('investmentType'), c('asset'), c('bank'), c('quantity'), c('unitPrice'), c('fees'), c('amount'), c('issuer'), c('cnpj'),
      c('indexer'), c('rate'), c('maturity'), c('earningKind'), c('taxWithheld'), c('irpfGroup'), c('irpfCode'), c('tax'), c('note'),
    ],
    ...items.map((inv) => {
      const r = investmentRow(inv, ctx, look)
      return [
        ctx.csvDate(r.date), r.operation, r.type, r.asset, r.bank, qty(r.quantity), money(r.unitPrice), money(r.fees), money(r.amount), r.issuer, r.cnpj,
        r.indexer, r.rate, r.maturity ? ctx.csvDate(r.maturity) : '', r.earningKind, money(r.taxWithheld), r.group, r.code, r.tax, r.note,
      ]
    }),
  ]
  return toCsv(rows, sep)
}

// ---------------------------------------------------------------- resumos do ano

export interface MonthTotals extends PeriodSummary {
  month: MonthKey
}

function emptySummary(): PeriodSummary {
  return { income: 0, expense: 0, balance: 0, contributions: 0, redemptions: 0, earnings: 0, savingsRate: null, count: 0 }
}

function close(s: PeriodSummary): PeriodSummary {
  s.balance = s.income - s.expense
  s.savingsRate = s.income > 0 ? Math.round((s.balance / s.income) * 1000) / 10 : null
  return s
}

/** Os 12 meses e o total do ano numa passada; os mesmos números de periodSummary() mês a mês. */
export function yearTotals(state: DataState, year: number): { months: MonthTotals[]; total: PeriodSummary } {
  const prefix = `${year}-`
  const months = Array.from({ length: 12 }, emptySummary)
  for (const x of state.transactions) {
    if (!x.date.startsWith(prefix)) continue
    const m = months[Number(x.date.slice(5, 7)) - 1]
    if (!m) continue
    m.count++
    if (x.kind === 'income') m.income += x.amount
    else m.expense += x.amount
  }
  for (const x of state.investments) {
    if (!x.date.startsWith(prefix)) continue
    const m = months[Number(x.date.slice(5, 7)) - 1]
    if (!m) continue
    m.count++
    if (x.operation === 'contribution') m.contributions += x.amount
    else if (x.operation === 'redemption') m.redemptions += x.amount
    else m.earnings += x.amount
  }
  const total = emptySummary()
  for (const m of months) {
    close(m)
    total.income += m.income
    total.expense += m.expense
    total.contributions += m.contributions
    total.redemptions += m.redemptions
    total.earnings += m.earnings
    total.count += m.count
  }
  return { months: months.map((m, i) => ({ month: `${year}-${String(i + 1).padStart(2, '0')}`, ...m })), total: close(total) }
}

/** Rendimentos do ano por tipo, com o IR retido (relatório anual e relatório de investimentos). */
export function yearEarnings(state: DataState, year: number): Map<EarningKind, { total: number; tax: number }> {
  const prefix = `${year}-`
  const map = new Map<EarningKind, { total: number; tax: number }>()
  for (const inv of state.investments) {
    if (inv.operation !== 'earning' || !inv.date.startsWith(prefix)) continue
    const kind = inv.earningKind ?? 'other'
    const e = map.get(kind) ?? { total: 0, tax: 0 }
    e.total += inv.amount
    e.tax += inv.taxWithheld ?? 0
    map.set(kind, e)
  }
  return map
}

/** Resumo do ano para o relatório de impressão. */
export function yearSummary(state: DataState, year: number) {
  const { from, to } = yearRange(year)
  const { months, total } = yearTotals(state, year)
  return {
    total,
    months,
    expenseByCategory: categoryTotals(state, 'expense', from, to),
    incomeByCategory: categoryTotals(state, 'income', from, to),
    hasData: total.count > 0,
  }
}
