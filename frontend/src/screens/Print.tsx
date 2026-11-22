// Relatório anual para imprimir, salvar em PDF (Ctrl/⌘ + P) ou mandar por e-mail.

import { useMemo, type ReactNode } from 'react'
import { LuArrowLeft, LuInfo, LuMail, LuPrinter } from 'react-icons/lu'
import { useMail } from '../app/mail'
import { navigate, useRoute } from '../app/router'
import { annualReport, annualReportHtml, type ReportTable } from '../data/annualReport'
import { availableYears, defaultTaxYear } from '../data/exporters'
import { useOwnerName } from '../data/session'
import { useData } from '../data/store'
import { useI18n } from '../i18n'
import { MAX_YEAR, MIN_YEAR } from '../lib/dates'
import { useToday } from '../lib/useToday'
import { Button, Spinner } from '../ui/primitives'
import { LumeMark } from '../app/Layout'

export function Print() {
  const data = useData()
  const owner = useOwnerName()
  const mail = useMail()
  const i18n = useI18n()
  const { t } = i18n
  const route = useRoute()
  const { today } = useToday()
  const yearParam = Number(route.query.get('year'))
  const validParam = Number.isInteger(yearParam) && yearParam >= MIN_YEAR && yearParam <= MAX_YEAR
  const year = useMemo(() => (validParam ? yearParam : defaultTaxYear(availableYears(data), today)), [validParam, yearParam, data, today])
  const report = useMemo(() => annualReport(data, year, i18n, owner.full), [data, year, i18n, owner.full])
  const tables = report.tables.filter((tb) => !tb.half)
  const halves = report.tables.filter((tb) => tb.half)

  const email = () => {
    const html = annualReportHtml(report, { lang: i18n.locale, empty: t('reports.noData') })
    void mail.email({
      blob: new Blob([html], { type: 'text/html;charset=utf-8' }),
      filename: `lume-relatorio-${year}.html`,
      label: t('mail.labels.annual', { year }),
      html,
    })
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2 print:hidden">
        <Button onClick={() => navigate('/export')}>
          <LuArrowLeft className="size-4" aria-hidden />
          {t('common.back')}
        </Button>
        <span className="flex-1" />
        <Button onClick={email} disabled={mail.sending}>
          {mail.sending ? <Spinner /> : <LuMail className="size-4" aria-hidden />}
          {mail.sending ? t('mail.sending') : t('mail.send')}
        </Button>
        <Button variant="primary" onClick={() => window.print()}>
          <LuPrinter className="size-4" aria-hidden />
          {t('reports.print')}
        </Button>
      </div>

      {!report.hasData && (
        <p role="status" className="fx-rise mx-auto mb-4 flex max-w-[820px] items-center gap-2 rounded-xl bg-fill-2 px-4 py-3 text-[14px] text-label-2 print:hidden">
          <LuInfo className="size-4 shrink-0 text-accent" aria-hidden />
          {t('export.nothing', { year })}
        </p>
      )}

      <article className="print-area fx-rise mx-auto max-w-[820px] rounded-[18px] bg-white p-5 text-[13.5px] text-[#1c1c1e] shadow-card ring-1 ring-black/5 sm:p-10 print:rounded-none print:p-0 print:shadow-none print:ring-0">
        <header className="flex flex-col gap-3 border-b border-black/10 pb-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <LumeMark />
              <span className="text-[20px] font-semibold tracking-tight">Lume</span>
            </div>
            <h1 className="mt-3 text-[22px] leading-tight font-bold tracking-[-0.02em] sm:text-[26px]">{report.title}</h1>
            <p className="mt-1 text-black/60">{report.subtitle}</p>
            {report.owner && <p className="mt-0.5 text-black/60">{report.owner}</p>}
          </div>
          <p className="shrink-0 text-[12px] text-black/50 sm:text-right">{report.generatedAt}</p>
        </header>

        <section className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3 print:grid-cols-4">
          {report.kpis.map((k) => (
            <div key={k.label} className="min-w-0 rounded-xl bg-black/[0.035] px-3 py-2.5">
              <p className="text-[12px] text-black/55">{k.label}</p>
              <p className="tabular truncate text-[15px] font-semibold sm:text-[16.5px]" title={k.value}>
                {k.value}
              </p>
            </div>
          ))}
        </section>

        <PrintSection table={tables[0]} />
        <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 print:grid-cols-2">
          {halves.map((table) => (
            <PrintSection key={table.title} table={table} />
          ))}
        </div>
        {tables.slice(1).map((table) => (
          <PrintSection key={table.title} table={table} />
        ))}

        <p className="mt-8 border-t border-black/10 pt-3 text-[11.5px] text-black/45">{report.footer}</p>
      </article>
    </div>
  )
}

function PrintSection({ table }: { table: ReportTable }): ReactNode {
  return (
    <section className="mt-7 break-inside-avoid">
      <h2 className="text-[15.5px] font-semibold tracking-tight">{table.title}</h2>
      {table.note && <p className="mt-0.5 text-[12px] text-black/50">{table.note}</p>}
      {/* Em tela estreita a tabela rola de lado em vez de espremer as colunas. */}
      <div className="mt-2 overflow-x-auto print:overflow-visible">
        <PrintTable table={table} />
      </div>
    </section>
  )
}

function PrintTable({ table }: { table: ReportTable }) {
  const { t } = useI18n()
  const left = table.left ?? 1
  const align = (i: number) => (i < left ? 'text-left' : 'text-right')
  if (table.rows.length === 0) return <p className="text-black/45">{t('reports.noData')}</p>
  return (
    <table className="w-full min-w-max border-collapse text-[12.5px] sm:min-w-0 print:min-w-0">
      <thead>
        <tr className="border-b border-black/15 text-left text-black/55">
          {table.head.map((h, i) => (
            <th key={h + i} className={`py-1.5 pr-2 font-medium ${align(i)}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, r) => (
          <tr key={r} className="border-b border-black/[0.06]">
            {row.map((cell, i) => (
              <td key={i} className={`tabular py-1.5 pr-2 ${align(i)} ${i < left ? '' : 'whitespace-nowrap'}`}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {table.foot && (
        <tfoot>
          <tr className="font-semibold">
            {table.foot.map((cell, i) => (
              <td key={i} className={`tabular pt-2 pr-2 ${align(i)}`}>
                {cell}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  )
}
