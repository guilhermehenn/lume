// Exportar: pacote para o contador (.xlsx), CSVs, backup (.json) e relatório para imprimir.

import { useMemo, useState, type ReactNode } from 'react'
import { LuDatabase, LuFileSpreadsheet, LuFileText, LuMail, LuPrinter, LuShieldCheck, LuTable } from 'react-icons/lu'
import { useMail, type OutgoingFile } from '../app/mail'
import { href, navigate } from '../app/router'
import { yearRange } from '../lib/dates'
import { useToday } from '../lib/useToday'
import { backupFilename, createBackup } from '../data/backup'
import { accountantSheets, defaultTaxYear, investmentsCsv, transactionsCsv, yearCounts } from '../data/exporters'
import { useOwnerName } from '../data/session'
import { useData, useSettings } from '../data/store'
import { exportContext, useI18n } from '../i18n'
import { Button, Card, IconButton, PageHeader, Spinner } from '../ui/primitives'
import { Select } from '../ui/inputs'
import { toast } from '../ui/toast'

function ExportCard({ icon, tint, title, description, children, delay }: { icon: ReactNode; tint: string; title: string; description: string; children: ReactNode; delay: number }) {
  return (
    <Card className="fx-rise flex flex-col gap-4 p-6" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-start gap-3.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl text-white [&>svg]:size-5" style={{ background: tint }}>
          {icon}
        </span>
        <div>
          <h2 className="text-[16.5px] font-semibold tracking-tight">{title}</h2>
          <p className="mt-0.5 text-[14px] text-label-2">{description}</p>
        </div>
      </div>
      <div className="mt-auto flex flex-wrap gap-2">{children}</div>
    </Card>
  )
}

const CSV = 'text/csv;charset=utf-8'
type FileKey = 'xlsx' | 'transactions' | 'investments' | 'backup'

export function Export() {
  const data = useData()
  const settings = useSettings()
  const owner = useOwnerName()
  const mail = useMail()
  const i18n = useI18n()
  const { t } = i18n
  const { today } = useToday()
  // Quantos lançamentos e operações cada ano tem, numa passada; trocar de ano não recalcula nada.
  const counts = useMemo(() => yearCounts(data), [data])
  const years = useMemo(() => [...counts.keys()], [counts])
  const [picked, setPicked] = useState(() => defaultTaxYear(years, today))
  // Se o ano escolhido sumiu da lista (todos os lançamentos dele foram excluídos), volta ao padrão.
  const year = years.includes(picked) ? picked : defaultTaxYear(years, today)
  const count = counts.get(year) ?? { transactions: 0, investments: 0 }
  const hasData = count.transactions + count.investments > 0
  const [busy, setBusy] = useState<string | null>(null)

  const mailLabels: Record<FileKey, string> = {
    xlsx: t('mail.labels.xlsx', { year }),
    transactions: t('mail.labels.csvTransactions', { year }),
    investments: t('mail.labels.csvInvestments', { year }),
    backup: t('mail.labels.backup'),
  }

  /** Avisa e não gera arquivo vazio (antes os CSVs saíam só com o cabeçalho). */
  const nothing = (key: 'nothing' | 'nothingTransactions' | 'nothingInvestments') => {
    toast.info(t(`export.${key}`, { year }))
    return null
  }

  // Os arquivos são gerados só no clique: nada disso roda ao abrir a tela ou trocar de ano.
  const files: Record<FileKey, () => Promise<OutgoingFile | null>> = {
    xlsx: async () => {
      if (!hasData) return nothing('nothing')
      // O gerador de planilha (JSZip) só é carregado quando necessário.
      const { buildXlsx } = await import('../lib/xlsx')
      const blob = await buildXlsx(accountantSheets(data, year, exportContext(i18n, owner.full)))
      return { blob, filename: `lume-ir-${year}.xlsx`, label: mailLabels.xlsx }
    },
    transactions: async () => {
      if (!count.transactions) return nothing('nothingTransactions')
      const csv = transactionsCsv(data, exportContext(i18n, owner.full), yearRange(year))
      return { blob: new Blob([csv], { type: CSV }), filename: `lume-lancamentos-${year}.csv`, label: mailLabels.transactions }
    },
    investments: async () => {
      if (!count.investments) return nothing('nothingInvestments')
      const csv = investmentsCsv(data, exportContext(i18n, owner.full), yearRange(year))
      return { blob: new Blob([csv], { type: CSV }), filename: `lume-investimentos-${year}.csv`, label: mailLabels.investments }
    },
    // O backup leva tudo, de todos os anos, como está na tela (inclusive o que ainda está sendo salvo).
    // O nome usa a data deste computador: depois das 21h (Brasília) a data de Greenwich já é amanhã.
    backup: async () => ({
      blob: new Blob([createBackup(data, settings)], { type: 'application/json' }),
      filename: backupFilename(today),
      label: mailLabels.backup,
    }),
  }

  const run = async (key: FileKey, how: 'download' | 'email') => {
    setBusy(`${key}:${how}`)
    try {
      const file = await files[key]()
      if (!file) return
      if (how === 'download') await mail.deliver(file)
      else await mail.email(file)
    } catch {
      toast.error(t('errors.generic'))
    } finally {
      setBusy(null)
    }
  }

  const openReport = () => {
    if (!hasData) {
      nothing('nothing')
      return
    }
    navigate('/print', { year: String(year) })
  }

  /** Botão de baixar + botão de mandar por e-mail para o mesmo arquivo. */
  const actions = (key: FileKey, label: ReactNode, primary = false, icon?: ReactNode) => (
    <span className="inline-flex gap-1">
      <Button variant={primary ? 'primary' : 'secondary'} onClick={() => void run(key, 'download')} disabled={busy !== null}>
        {busy === `${key}:download` ? <Spinner /> : icon}
        {label}
      </Button>
      <IconButton
        label={`${t('mail.send')}: ${mailLabels[key]}`}
        onClick={() => void run(key, 'email')}
        disabled={busy !== null}
        className="size-10 rounded-[11px] bg-fill-2"
      >
        {busy === `${key}:email` ? <Spinner /> : <LuMail className="size-[18px]" aria-hidden />}
      </IconButton>
    </span>
  )

  return (
    <div>
      <PageHeader title={t('export.title')} subtitle={t('export.subtitle')} />
      <div className="fx-rise mb-5 flex flex-wrap items-center gap-x-4 gap-y-2" style={{ animationDelay: '40ms' }}>
        <div className="flex h-10 items-center gap-2 rounded-[10px] bg-fill-2 pr-1 pl-3 text-[14px]">
          <span className="text-label-2">{t('export.year')}</span>
          <Select label={t('export.year')} value={String(year)} options={years.map((y) => ({ value: String(y), label: String(y) }))} placeholder="" onChange={(v) => setPicked(Number(v))} />
        </div>
        <p className="text-[13.5px] text-label-2" role="status" aria-live="polite">
          {hasData
            ? t('export.yearContent', {
                year,
                transactions: t('export.countTransactions', { count: count.transactions }),
                investments: t('export.countInvestments', { count: count.investments }),
              })
            : t('export.yearEmpty', { year })}
        </p>
        <a href={href('/account', { section: 'mail' })} className="flex items-center gap-1.5 text-[13.5px] font-medium text-accent hover:underline sm:ml-auto">
          <LuMail className="size-4 shrink-0" aria-hidden />
          {mail.ready && settings.emailCopies ? t('mail.copiesHint', { email: mail.to }) : t('mail.copies')}
        </a>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ExportCard icon={<LuFileSpreadsheet />} tint="#30A14E" title={t('export.accountant')} description={t('export.accountantDesc')} delay={60}>
          {actions('xlsx', t('export.accountantButton'), true, <LuFileSpreadsheet className="size-4" aria-hidden />)}
        </ExportCard>
        <ExportCard icon={<LuTable />} tint="#0A84FF" title={t('export.csv')} description={t('export.csvDesc')} delay={100}>
          {actions('transactions', t('export.csvTransactions'))}
          {actions('investments', t('export.csvInvestments'))}
        </ExportCard>
        <ExportCard icon={<LuPrinter />} tint="#5E5CE6" title={t('export.print')} description={t('export.printDesc')} delay={140}>
          <Button onClick={openReport}>
            <LuFileText className="size-4" aria-hidden />
            {t('export.printButton')}
          </Button>
        </ExportCard>
        <ExportCard icon={<LuDatabase />} tint="#FF9F0A" title={t('export.backup')} description={t('export.backupDesc')} delay={180}>
          {actions('backup', t('export.backupButton'))}
        </ExportCard>
      </div>
      <p className="fx-rise mt-5 flex items-start gap-1.5 text-[13px] text-label-2" style={{ animationDelay: '220ms' }}>
        <LuShieldCheck className="mt-0.5 size-4 shrink-0 text-income" aria-hidden />
        {t('export.privacy')}
      </p>
    </div>
  )
}
