// Cálculos sobre os dados: saldos, resumos, relatórios e posição dos investimentos.
// Funções puras, testadas em tests/unit/selectors.test.ts.

import { inRange, monthOf, type ISODate, type MonthKey } from '../lib/dates'
import { normalize } from '../lib/text'
import { INVESTMENT_TYPE_MAP, positionKey } from './investments'
import type {
  Category,
  DataState,
  EarningKind,
  ID,
  Investment,
  InvestmentTypeId,
  Kind,
  PaymentMethod,
  ReportFilters,
  ReportGroupBy,
  Transaction,
} from './types'

// ---------------------------------------------------------------- saldos

/** Saldo de cada banco: inicial + receitas − despesas − aplicações + resgates + rendimentos. */
export function bankBalances(state: DataState, upTo?: ISODate): Map<ID, number> {
  const balances = new Map<ID, number>(state.banks.map((b) => [b.id, b.initialBalance]))
  const add = (id: ID, value: number) => balances.set(id, (balances.get(id) ?? 0) + value)
  for (const t of state.transactions) {
    if (upTo && t.date > upTo) continue
    add(t.bankId, t.kind === 'income' ? t.amount : -t.amount)
  }
  for (const i of state.investments) {
    if (upTo && i.date > upTo) continue
    add(i.bankId, i.operation === 'contribution' ? -i.amount : i.amount)
  }
  return balances
}

export interface BalanceOverview {
  /** Saldo de cada banco até hoje: lançamentos com data depois de hoje ficam de fora. */
  byBank: Map<ID, number>
  total: number
  /** Saldo total contando também os lançamentos com data futura. */
  projected: number
  /** Quantos lançamentos têm data depois de hoje. */
  futureCount: number
}

/** Saldos de hoje e o previsto, numa passada só (Início e Bancos). */
export function balanceOverview(state: DataState, today: ISODate): BalanceOverview {
  const byBank = new Map<ID, number>(state.banks.map((b) => [b.id, b.initialBalance]))
  let future = 0
  let futureCount = 0
  const add = (bankId: ID, value: number, date: ISODate) => {
    if (date > today) {
      future += value
      futureCount++
    } else byBank.set(bankId, (byBank.get(bankId) ?? 0) + value)
  }
  for (const t of state.transactions) add(t.bankId, t.kind === 'income' ? t.amount : -t.amount, t.date)
  for (const i of state.investments) add(i.bankId, i.operation === 'contribution' ? -i.amount : i.amount, i.date)
  let total = 0
  for (const value of byBank.values()) total += value
  return { byBank, total, projected: total + future, futureCount }
}

/** Quantos lançamentos e operações de investimento cada banco tem, numa passada só. */
export function bankUsageCounts(state: Pick<DataState, 'transactions' | 'investments'>): Map<ID, number> {
  const counts = new Map<ID, number>()
  for (const t of state.transactions) counts.set(t.bankId, (counts.get(t.bankId) ?? 0) + 1)
  for (const i of state.investments) counts.set(i.bankId, (counts.get(i.bankId) ?? 0) + 1)
  return counts
}

/** Quantos lançamentos cada categoria tem, numa passada só (investimentos não têm categoria). */
export function categoryUsageCounts(state: Pick<DataState, 'transactions'>): Map<ID, number> {
  const counts = new Map<ID, number>()
  for (const t of state.transactions) counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1)
  return counts
}

/** Categorias de um tipo em ordem de nome, com as "Outras …" no fim (lista da tela e dos formulários). */
export function categoriesByName(categories: Category[], kind: Kind, nameOf: (c: Category) => string, locale: string): { category: Category; name: string }[] {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true })
  return categories
    .filter((c) => c.kind === kind)
    .map((category) => ({ category, name: nameOf(category), other: category.nameKey?.startsWith('other_') ? 1 : 0 }))
    .sort((a, b) => a.other - b.other || collator.compare(a.name, b.name))
    .map(({ category, name }) => ({ category, name }))
}

// ---------------------------------------------------------------- resumo de período

export interface PeriodSummary {
  income: number
  expense: number
  balance: number
  contributions: number
  redemptions: number
  earnings: number
  /** Percentual da receita que sobrou (0–100) ou null sem receita. */
  savingsRate: number | null
  count: number
}

export function periodSummary(state: DataState, from?: ISODate, to?: ISODate): PeriodSummary {
  let income = 0
  let expense = 0
  let count = 0
  for (const t of state.transactions) {
    if (!inRange(t.date, from, to)) continue
    count++
    if (t.kind === 'income') income += t.amount
    else expense += t.amount
  }
  let contributions = 0
  let redemptions = 0
  let earnings = 0
  for (const i of state.investments) {
    if (!inRange(i.date, from, to)) continue
    count++
    if (i.operation === 'contribution') contributions += i.amount
    else if (i.operation === 'redemption') redemptions += i.amount
    else earnings += i.amount
  }
  const balance = income - expense
  return {
    income,
    expense,
    balance,
    contributions,
    redemptions,
    earnings,
    savingsRate: income > 0 ? Math.round((balance / income) * 1000) / 10 : null,
    count,
  }
}

// ---------------------------------------------------------------- agrupamentos

export interface GroupTotal {
  key: string
  total: number
  count: number
}

function sortTotals(map: Map<string, GroupTotal>): GroupTotal[] {
  return [...map.values()].sort((a, b) => b.total - a.total || a.key.localeCompare(b.key))
}

export function categoryTotals(state: DataState, kind: Kind, from?: ISODate, to?: ISODate): GroupTotal[] {
  const map = new Map<string, GroupTotal>()
  for (const t of state.transactions) {
    if (t.kind !== kind || !inRange(t.date, from, to)) continue
    const g = map.get(t.categoryId) ?? { key: t.categoryId, total: 0, count: 0 }
    g.total += t.amount
    g.count++
    map.set(t.categoryId, g)
  }
  return sortTotals(map)
}

export interface MonthPoint {
  month: MonthKey
  income: number
  expense: number
  invested: number
}

export function monthlySeries(state: DataState, months: MonthKey[]): MonthPoint[] {
  const points = new Map<MonthKey, MonthPoint>(months.map((m) => [m, { month: m, income: 0, expense: 0, invested: 0 }]))
  for (const t of state.transactions) {
    const p = points.get(monthOf(t.date))
    if (!p) continue
    if (t.kind === 'income') p.income += t.amount
    else p.expense += t.amount
  }
  for (const i of state.investments) {
    const p = points.get(monthOf(i.date))
    if (!p) continue
    if (i.operation === 'contribution') p.invested += i.amount
    else if (i.operation === 'redemption') p.invested -= i.amount
  }
  return months.map((m) => points.get(m)!)
}

// ---------------------------------------------------------------- relatório personalizado

/**
 * Lançamentos do relatório personalizado. O texto é procurado sem acento e sem diferença de
 * maiúsculas, como em Lançamentos ("cafe" acha "Café"); os filtros baratos vêm antes.
 */
export function filterTransactions(state: DataState, filters: ReportFilters): Transaction[] {
  const text = filters.text ? normalize(filters.text.trim()) : ''
  const kinds = filters.kinds.length ? new Set(filters.kinds) : null
  const categories = filters.categoryIds.length ? new Set(filters.categoryIds) : null
  const banks = filters.bankIds.length ? new Set(filters.bankIds) : null
  return state.transactions.filter(
    (t) =>
      inRange(t.date, filters.from, filters.to) &&
      (!kinds || kinds.has(t.kind)) &&
      (!categories || categories.has(t.categoryId)) &&
      (!banks || banks.has(t.bankId)) &&
      (!text || searchText(t).includes(text)),
  )
}

// Texto já normalizado de cada lançamento, guardado pelo próprio objeto: os lançamentos não mudam
// (editar cria um objeto novo), então só a primeira tecla de uma busca paga a normalização.
const SEARCH_CACHE = new WeakMap<Transaction, string>()
const KEY_CACHE = new WeakMap<Transaction, string>()
// Separa nome e observação sem ser espaço, para a busca não emendar o fim de um no começo do outro.
const SEPARATOR = String.fromCharCode(0)

function searchText(t: Transaction): string {
  let text = SEARCH_CACHE.get(t)
  if (text === undefined) {
    text = normalize(t.note ? t.counterparty + SEPARATOR + t.note : t.counterparty)
    SEARCH_CACHE.set(t, text)
  }
  return text
}

/** Chave de quem paga/recebe ao agrupar: "Padaria do Zé" e "padaria do ze" são o mesmo. */
function counterpartyKey(t: Transaction): string {
  let key = KEY_CACHE.get(t)
  if (key === undefined) {
    key = normalize(t.counterparty.trim())
    KEY_CACHE.set(t, key)
  }
  return key
}

export interface ReportRow {
  key: string
  income: number
  expense: number
  net: number
  count: number
}

export function groupTransactions(transactions: Transaction[], groupBy: ReportGroupBy): ReportRow[] {
  const map = new Map<string, ReportRow>()
  for (const t of transactions) {
    const key =
      groupBy === 'category'
        ? t.categoryId
        : groupBy === 'bank'
          ? t.bankId
          : groupBy === 'month'
            ? monthOf(t.date)
            : counterpartyKey(t)
    const row = map.get(key) ?? { key, income: 0, expense: 0, net: 0, count: 0 }
    if (t.kind === 'income') row.income += t.amount
    else row.expense += t.amount
    row.net = row.income - row.expense
    row.count++
    map.set(key, row)
  }
  const rows = [...map.values()]
  if (groupBy === 'month') return rows.sort((a, b) => a.key.localeCompare(b.key))
  return rows.sort((a, b) => b.income + b.expense - (a.income + a.expense))
}

/** Nome original (com maiúsculas) de quem paga/recebe, para exibir os grupos por "counterparty". */
export function counterpartyLabels(transactions: Transaction[]): Map<string, string> {
  const labels = new Map<string, string>()
  for (const t of transactions) {
    const key = counterpartyKey(t)
    if (!labels.has(key)) labels.set(key, t.counterparty.trim())
  }
  return labels
}

/** O que o Lume lembra de cada "Pago a" / "Recebido de" para preencher o formulário. */
export interface CounterpartyRecall {
  categoryId: ID
  paymentMethod?: PaymentMethod
}

export interface CounterpartyMemory {
  /** Nomes mais usados primeiro (empate: o mais recente). */
  suggestions: string[]
  /** Categoria e forma de pagamento do lançamento mais recente com esse nome (sem diferenciar maiúsculas). */
  recall: (counterparty: string) => CounterpartyRecall | undefined
}

/**
 * Uma passada pelos lançamentos do tipo monta as sugestões e o "lembrar" por nome.
 * Antes eram duas funções, e a do "lembrar" percorria todos os lançamentos a cada tecla.
 */
export function counterpartyMemory(state: DataState, kind: Kind, limit = 50): CounterpartyMemory {
  const byName = new Map<string, { label: string; count: number; last: Transaction }>()
  for (const t of state.transactions) {
    if (t.kind !== kind) continue
    const key = t.counterparty.trim().toLowerCase()
    const entry = byName.get(key)
    if (!entry) byName.set(key, { label: t.counterparty.trim(), count: 1, last: t })
    else {
      entry.count++
      if (t.date > entry.last.date || (t.date === entry.last.date && t.createdAt > entry.last.createdAt)) {
        entry.last = t
        entry.label = t.counterparty.trim()
      }
    }
  }
  const suggestions = [...byName.values()]
    .sort((a, b) => b.count - a.count || b.last.date.localeCompare(a.last.date))
    .slice(0, limit)
    .map((e) => e.label)
  return {
    suggestions,
    recall: (counterparty) => {
      const last = byName.get(counterparty.trim().toLowerCase())?.last
      return last && { categoryId: last.categoryId, paymentMethod: last.paymentMethod }
    },
  }
}

// ---------------------------------------------------------------- lista unificada

export type Entry =
  | { entryKind: 'expense' | 'income'; id: ID; date: ISODate; amount: number; createdAt: string; tx: Transaction }
  | { entryKind: 'investment'; id: ID; date: ISODate; amount: number; createdAt: string; inv: Investment }

function toEntry(x: Transaction | Investment, isTx: boolean): Entry {
  if (isTx) {
    const tx = x as Transaction
    return { entryKind: tx.kind, id: tx.id, date: tx.date, amount: tx.amount, createdAt: tx.createdAt, tx }
  }
  const inv = x as Investment
  return { entryKind: 'investment', id: inv.id, date: inv.date, amount: inv.amount, createdAt: inv.createdAt, inv }
}

export interface HomeEntries {
  /** Os mais recentes até hoje (mesma ordem da lista de lançamentos). */
  recent: Entry[]
  /** Os próximos, a partir de amanhã: o mais perto primeiro. */
  upcoming: Entry[]
  upcomingCount: number
}

/**
 * Últimos e próximos lançamentos do Início sem ordenar tudo: guarda só os poucos que vão
 * aparecer. Com 100 mil lançamentos, ordenar a lista inteira levava ~145 ms a cada gravação.
 */
export function homeEntries(state: DataState, today: ISODate, limit = 6, upcomingLimit = 3): HomeEntries {
  type Item = { date: ISODate; createdAt: string; source: Transaction | Investment; isTx: boolean }
  const recent: Item[] = []
  const upcoming: Item[] = []
  let upcomingCount = 0
  const newer = (a: Item, b: Item) => a.date > b.date || (a.date === b.date && a.createdAt > b.createdAt)
  const sooner = (a: Item, b: Item) => a.date < b.date || (a.date === b.date && a.createdAt < b.createdAt)
  const keep = (list: Item[], item: Item, max: number, before: (a: Item, b: Item) => boolean) => {
    if (max <= 0 || (list.length === max && !before(item, list[max - 1]))) return
    let at = list.length
    while (at > 0 && before(item, list[at - 1])) at--
    list.splice(at, 0, item)
    if (list.length > max) list.pop()
  }
  const consider = (source: Transaction | Investment, isTx: boolean) => {
    const item = { date: source.date, createdAt: source.createdAt, source, isTx }
    if (source.date > today) {
      upcomingCount++
      keep(upcoming, item, upcomingLimit, sooner)
    } else keep(recent, item, limit, newer)
  }
  for (const t of state.transactions) consider(t, true)
  for (const i of state.investments) consider(i, false)
  return {
    recent: recent.map((i) => toEntry(i.source, i.isTx)),
    upcoming: upcoming.map((i) => toEntry(i.source, i.isTx)),
    upcomingCount,
  }
}

export function allEntries(state: DataState): Entry[] {
  const entries: Entry[] = [...state.transactions.map((tx) => toEntry(tx, true)), ...state.investments.map((inv) => toEntry(inv, false))]
  return entries.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
}

// ---------------------------------------------------------------- investimentos

export interface Position {
  key: string
  type: InvestmentTypeId
  asset: string
  bankId: ID
  /** Quantidade em carteira (só tipos com quantidade). */
  quantity: number
  /** Custo de aquisição do que ainda está em carteira (centavos). */
  cost: number
  /** Preço médio por unidade (centavos), quando há quantidade. */
  averagePrice: number | null
  contributions: number
  redemptions: number
  earnings: number
  taxWithheld: number
  /** Resultado realizado nas vendas (valor da venda − custo médio vendido). */
  realized: number
  last: Investment
}

/** Ainda em carteira: tem custo ou quantidade. */
export function isOpenPosition(p: Position): boolean {
  return p.cost > 0 || p.quantity > 0
}

/** Quantidades com até 8 casas (cripto): sem isso, somas de 0,1 + 0,2 deixam resto. */
const roundQuantity = (q: number) => Math.round(q * 1e8) / 1e8

/**
 * Posição por ativo pelo método do custo médio (o mesmo usado na declaração do IR).
 *
 * - Com quantidade (ações, FII, Tesouro, cripto…): a venda baixa o custo médio das unidades
 *   vendidas e o resto vira resultado. Vender mais do que havia em carteira (compra antiga que
 *   não foi lançada): só a parte que existia entra no resultado; o resto não tem custo conhecido.
 * - Sem quantidade (CDB, LCI, poupança, fundos…): o resgate baixa o custo; o que passar do custo
 *   é ganho realizado (antes, um CDB aplicado em 1.000 e resgatado em 1.100 não mostrava ganho).
 *
 * `upTo`: só operações até essa data (a tela usa hoje: operação agendada não entra ainda).
 */
export function investmentPositions(state: DataState, upTo?: ISODate): Position[] {
  const sorted = [...state.investments]
    .filter((i) => !upTo || i.date <= upTo)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
  const map = new Map<string, Position>()
  for (const inv of sorted) {
    const key = positionKey(inv)
    const p =
      map.get(key) ??
      ({
        key,
        type: inv.type,
        asset: inv.asset,
        bankId: inv.bankId,
        quantity: 0,
        cost: 0,
        averagePrice: null,
        contributions: 0,
        redemptions: 0,
        earnings: 0,
        taxWithheld: 0,
        realized: 0,
        last: inv,
      } satisfies Position)
    const quantityBased = INVESTMENT_TYPE_MAP[inv.type].quantityBased
    if (inv.operation === 'contribution') {
      p.contributions += inv.amount
      p.cost += inv.amount
      if (quantityBased && inv.quantity) p.quantity = roundQuantity(p.quantity + inv.quantity)
    } else if (inv.operation === 'redemption') {
      p.redemptions += inv.amount
      // Sem quantidade: renda fixa, ou operação antiga de ativo por cotas gravada antes de a
      // quantidade ser obrigatória (cofres e backups anteriores à v0.3.5). Baixa pelo valor.
      if (!quantityBased || !inv.quantity) {
        p.realized += Math.max(0, inv.amount - p.cost)
        p.cost = Math.max(0, p.cost - inv.amount)
      } else if (p.quantity > 0) {
        const sold = Math.min(inv.quantity, p.quantity)
        const revenue = sold < inv.quantity ? Math.round(inv.amount * (sold / inv.quantity)) : inv.amount
        const costOut = Math.round((p.cost / p.quantity) * sold)
        p.realized += revenue - costOut
        p.cost -= costOut
        p.quantity = roundQuantity(p.quantity - sold)
        if (p.quantity === 0) p.cost = 0
      }
    } else {
      p.earnings += inv.amount
      p.taxWithheld += inv.taxWithheld ?? 0
    }
    p.averagePrice = quantityBased && p.quantity > 0 ? Math.round(p.cost / p.quantity) : null
    p.last = inv
    map.set(key, p)
  }
  return [...map.values()].sort((a, b) => b.cost - a.cost || a.asset.localeCompare(b.asset))
}

/**
 * Quantidade em carteira de um ativo numa data, sem contar a operação que está sendo editada.
 * O formulário de resgate mostra isso para evitar vender mais do que se tem.
 */
export function heldQuantity(state: DataState, key: string, upTo: ISODate, excludeId?: ID): number {
  const ops = state.investments.filter((i) => i.id !== excludeId && positionKey(i) === key)
  return investmentPositions({ ...state, investments: ops }, upTo)[0]?.quantity ?? 0
}

export function investedByType(positions: Position[]): GroupTotal[] {
  const map = new Map<string, GroupTotal>()
  for (const p of positions) {
    if (p.cost <= 0) continue
    const g = map.get(p.type) ?? { key: p.type, total: 0, count: 0 }
    g.total += p.cost
    g.count++
    map.set(p.type, g)
  }
  return sortTotals(map)
}

export function earningsByKind(state: DataState, from?: ISODate, to?: ISODate): Map<EarningKind, number> {
  const map = new Map<EarningKind, number>()
  for (const i of state.investments) {
    if (i.operation !== 'earning' || !inRange(i.date, from, to)) continue
    const kind = i.earningKind ?? 'other'
    map.set(kind, (map.get(kind) ?? 0) + i.amount)
  }
  return map
}
