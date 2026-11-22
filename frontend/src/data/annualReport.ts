// Relatório anual (tela de impressão e e-mail): as mesmas tabelas viram React na tela
// ou um HTML simples, com estilos na própria marcação, para mandar por e-mail.

import { todayISO } from '../lib/dates'
import type { I18n } from '../i18n'
import { exportContext } from '../i18n'
import { yearEarnings, yearPositions, yearSummary } from './exporters'
import type { DataState } from './types'

export interface ReportTable {
  title: string
  note?: string
  head: string[]
  rows: string[][]
  foot?: string[]
  /** Quantas colunas, a partir da esquerda, ficam alinhadas à esquerda. */
  left?: number
  /** Tabelas que podem ficar lado a lado. */
  half?: boolean
}

export interface AnnualReport {
  year: number
  title: string
  subtitle: string
  owner: string
  generatedAt: string
  kpis: { label: string; value: string }[]
  tables: ReportTable[]
  footer: string
  hasData: boolean
}

export function annualReport(data: DataState, year: number, i18n: I18n, ownerName: string, now = new Date()): AnnualReport {
  const { t } = i18n
  const ctx = exportContext(i18n, ownerName, now)
  const summary = yearSummary(data, year)
  const positions = yearPositions(data, year, ctx)
  const earnings = [...yearEarnings(data, year)]
  // O relatório sempre mostra os valores, mesmo com "ocultar valores" ligado.
  const money = (v: number) => i18n.money(v)
  // Mês sem movimento fica com um traço: os meses com valores saltam aos olhos.
  const moneyOrDash = (v: number) => (v ? money(v) : '—')
  const categories = new Map(data.categories.map((c) => [c.id, c]))
  const cat = (id: string) => i18n.categoryName(categories.get(id))
  const total = (pick: (p: (typeof positions)[number]) => number) => positions.reduce((s, p) => s + pick(p), 0)
  // Resultado em vendas e resgates só aparece no ano em que houve.
  const withRealized = positions.some((p) => p.realized !== 0)
  return {
    year,
    title: t('export.reportTitle', { year }),
    subtitle: t('export.reportSubtitle'),
    owner: ownerName ? t('export.readme.owner', { name: ownerName }) : '',
    generatedAt: t('reports.generatedAt', { date: i18n.date(todayISO(now)) }),
    kpis: [
      { label: t('reports.income'), value: money(summary.total.income) },
      { label: t('reports.expense'), value: money(summary.total.expense) },
      { label: t('reports.balance'), value: money(summary.total.balance) },
      { label: t('reports.invested'), value: money(summary.total.contributions - summary.total.redemptions) },
    ],
    tables: [
      {
        title: t('reports.months'),
        head: [t('reports.month'), t('reports.income'), t('reports.expense'), t('reports.net'), t('export.cols.contributions'), t('export.cols.earnings')],
        rows: summary.months.map((m) => [
          i18n.month(m.month),
          moneyOrDash(m.income),
          moneyOrDash(m.expense),
          moneyOrDash(m.balance),
          moneyOrDash(m.contributions),
          moneyOrDash(m.earnings),
        ]),
        foot: [
          t('common.total'),
          money(summary.total.income),
          money(summary.total.expense),
          money(summary.total.balance),
          money(summary.total.contributions),
          money(summary.total.earnings),
        ],
      },
      {
        title: t('reports.topExpenses'),
        head: [t('common.category'), t('common.total')],
        rows: summary.expenseByCategory.map((g) => [cat(g.key), money(g.total)]),
        half: true,
      },
      {
        title: t('reports.topIncome'),
        head: [t('common.category'), t('common.total')],
        rows: summary.incomeByCategory.map((g) => [cat(g.key), money(g.total)]),
        half: true,
      },
      {
        title: t('reports.positionAt', { date: i18n.date(`${year}-12-31`, 'short') }),
        note: t('reports.positionHint'),
        head: [
          t('export.cols.irpfGroup'),
          t('export.cols.irpfCode'),
          t('export.cols.asset'),
          t('export.cols.cnpj'),
          t('export.cols.costPrevious'),
          t('export.cols.costCurrent'),
          ...(withRealized ? [t('reports.realizedYear')] : []),
        ],
        left: 4,
        // Sem grupo (previdência PGBL): não vai em Bens e Direitos, então grupo e código ficam com um traço.
        rows: positions.map((p) => [
          p.group || '—',
          p.group ? p.code || '?' : '—',
          `${p.asset} · ${p.bank}`,
          p.cnpj || '—',
          money(p.costPrevious),
          money(p.costCurrent),
          ...(withRealized ? [money(p.realized)] : []),
        ]),
        foot: [
          t('common.total'),
          '',
          '',
          '',
          money(total((p) => p.costPrevious)),
          money(total((p) => p.costCurrent)),
          ...(withRealized ? [money(total((p) => p.realized))] : []),
        ],
      },
      {
        title: t('reports.earningsTitle'),
        head: [t('export.cols.earningKind'), t('common.total'), t('export.cols.taxWithheld')],
        rows: earnings.map(([k, v]) => [t(`earningKinds.${k}`), money(v.total), v.tax ? money(v.tax) : '—']),
        foot: earnings.length
          ? [t('common.total'), money(earnings.reduce((s, [, v]) => s + v.total, 0)), money(earnings.reduce((s, [, v]) => s + v.tax, 0))]
          : undefined,
      },
    ],
    footer: t('export.readme.line3'),
    hasData: summary.hasData,
  }
}

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function tableHtml(table: ReportTable, emptyText: string): string {
  const left = table.left ?? 1
  const align = (i: number) => (i < left ? 'left' : 'right')
  const cell = 'padding:6px 10px 6px 0;font-size:13px;'
  let html = `<h2 style="margin:28px 0 4px;font-size:16px;font-weight:600;">${escape(table.title)}</h2>`
  if (table.note) html += `<p style="margin:0 0 6px;font-size:12px;color:#6e6e73;">${escape(table.note)}</p>`
  if (table.rows.length === 0) return `${html}<p style="color:#8e8e93;font-size:13px;">${escape(emptyText)}</p>`
  html += '<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;">'
  html += `<thead><tr>${table.head.map((h, i) => `<th style="${cell}text-align:${align(i)};font-weight:500;color:#6e6e73;border-bottom:1px solid #d1d1d6;">${escape(h)}</th>`).join('')}</tr></thead><tbody>`
  for (const row of table.rows) {
    html += `<tr>${row.map((c, i) => `<td style="${cell}text-align:${align(i)};border-bottom:1px solid #f2f2f7;white-space:${i < left ? 'normal' : 'nowrap'};">${escape(c)}</td>`).join('')}</tr>`
  }
  html += '</tbody>'
  if (table.foot) html += `<tfoot><tr>${table.foot.map((c, i) => `<td style="${cell}text-align:${align(i)};font-weight:600;">${escape(c)}</td>`).join('')}</tr></tfoot>`
  return `${html}</table>`
}

/** Documento HTML completo, com estilos inline (clientes de e-mail ignoram folhas de estilo). */
export function annualReportHtml(report: AnnualReport, labels: { lang: string; empty: string }): string {
  const kpis = report.kpis
    .map(
      (k) =>
        `<td style="padding:10px 12px;background:#f5f5f7;border-radius:10px;"><div style="font-size:12px;color:#6e6e73;">${escape(k.label)}</div><div style="font-size:17px;font-weight:600;white-space:nowrap;">${escape(k.value)}</div></td>`,
    )
    .join('<td style="width:8px;"></td>')
  return [
    `<!doctype html><html lang="${escape(labels.lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<title>${escape(report.title)}</title></head>`,
    '<body style="margin:0;padding:24px;background:#ffffff;color:#1c1c1e;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">',
    '<div style="max-width:820px;margin:0 auto;">',
    '<p style="margin:0;font-size:15px;font-weight:600;color:#ff9f0a;">● Lume</p>',
    `<h1 style="margin:8px 0 2px;font-size:24px;letter-spacing:-0.02em;">${escape(report.title)}</h1>`,
    `<p style="margin:0 0 2px;color:#6e6e73;">${escape(report.subtitle)}</p>`,
    report.owner ? `<p style="margin:0;color:#6e6e73;">${escape(report.owner)}</p>` : '',
    `<p style="margin:4px 0 20px;font-size:12px;color:#8e8e93;">${escape(report.generatedAt)}</p>`,
    `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:separate;"><tr>${kpis}</tr></table>`,
    ...report.tables.map((t) => tableHtml(t, labels.empty)),
    `<p style="margin-top:32px;padding-top:10px;border-top:1px solid #e5e5ea;font-size:11px;color:#8e8e93;">${escape(report.footer)}</p>`,
    '</div></body></html>',
  ].join('')
}
