// Início: saudação, resumo do mês, saldos, mercado, notícias e lançamentos.
//
// Tudo que depende da data usa `useToday`: com o app aberto de um dia para o outro, a saudação,
// o mês do resumo e o "saldo de hoje" acompanham o relógio.

import { useMemo, useState } from 'react'
import { LuArrowRight, LuLifeBuoy } from 'react-icons/lu'
import { openNewEntry } from '../../app/entrySheet'
import { href } from '../../app/router'
import { cn } from '../../lib/cn'
import { fromISODate, monthOf, monthRange, type ISODate } from '../../lib/dates'
import { useToday } from '../../lib/useToday'
import { balanceOverview, homeEntries, periodSummary } from '../../data/selectors'
import { useAccount, useOwnerName } from '../../data/session'
import { useData, useSettings } from '../../data/store'
import type { DataState } from '../../data/types'
import { useI18n } from '../../i18n'
import { Amount, BankAvatar, MASK, useHidden } from '../../ui/display'
import { Button, Card, CardHeader, EmptyState } from '../../ui/primitives'
import { EntryRow, useLookups } from '../EntryRow'
import { MarketSection, NewsCard } from './Market'
import { Onboarding } from './Onboarding'

const link = 'text-[13.5px] font-medium text-accent hover:underline'

export function Home() {
  const data = useData()
  const settings = useSettings()
  const owner = useOwnerName()
  const i18n = useI18n()
  const { t } = i18n
  const { today, part } = useToday()
  // As boas-vindas abrem uma vez; a própria folha marca como vistas e fecha com animação.
  const [welcome] = useState(!settings.onboardingDone)
  const greeting = t(`home.${part}`)
  const dateLabel = useMemo(
    () => new Intl.DateTimeFormat(i18n.locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(fromISODate(today)),
    [i18n.locale, today],
  )

  return (
    <div className="space-y-6">
      <header className="fx-rise">
        <p className="text-[14px] font-medium text-label-2 first-letter:uppercase">{dateLabel}</p>
        <h1 className="mt-0.5 text-[34px] leading-tight font-bold tracking-[-0.025em]">
          {owner.first ? t('home.greetingName', { greeting, name: owner.first }) : greeting}
        </h1>
      </header>
      <RecoveryReminder />

      <div className="grid gap-4 lg:grid-cols-3">
        <MonthCard data={data} today={today} />
        <BalancesCard data={data} today={today} />
      </div>

      <MarketSection />

      <div className="grid gap-4 lg:grid-cols-5">
        <EntriesCard data={data} today={today} />
        <NewsCard />
      </div>

      {welcome && <Onboarding />}
    </div>
  )
}

// ---------------------------------------------------------------- resumo do mês

function MonthCard({ data, today }: { data: DataState; today: ISODate }) {
  const i18n = useI18n()
  // "Ocultar valores" esconde também o percentual guardado: dá para deduzir valores com ele.
  const hidden = useHidden()
  const { t } = i18n
  const month = monthOf(today)
  const summary = useMemo(() => {
    const { from, to } = monthRange(month)
    return periodSummary(data, from, to)
  }, [data, month])
  const spentShare = summary.income > 0 ? Math.min(100, (summary.expense / summary.income) * 100) : summary.expense > 0 ? 100 : 0
  const note =
    summary.count === 0
      ? t('transactions.empty')
      : summary.savingsRate === null
        ? t('home.noIncome')
        : summary.savingsRate >= 0
          ? t('home.savingsRate', { value: hidden ? MASK : i18n.percent(summary.savingsRate, { digits: 0 }) })
          : t('home.savingsNegative')

  return (
    <Card className="fx-rise relative overflow-hidden p-6 lg:col-span-2" style={{ animationDelay: '40ms' }} aria-labelledby="home-month">
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-[radial-gradient(circle,var(--lume-glow),transparent_65%)]" />
      <div className="relative flex items-center justify-between">
        <h2 id="home-month" className="text-[16.5px] font-semibold tracking-tight first-letter:uppercase">
          {t('home.monthTitle', { month: i18n.monthInline(month) })}
        </h2>
        <a href={href('/reports')} className={cn(link, 'flex items-center gap-1')}>
          {t('nav.reports')}
          <LuArrowRight className="size-3.5" aria-hidden />
        </a>
      </div>
      <div className="relative mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label={t('home.income')} cents={summary.income} className="text-income" to={href('/transactions', { kind: 'income' })} title={t('home.seeIncome')} />
        <Stat label={t('home.expense')} cents={summary.expense} to={href('/transactions', { kind: 'expense' })} title={t('home.seeExpense')} />
        <Stat
          label={t('home.balance')}
          cents={summary.balance}
          className={summary.balance < 0 ? 'text-expense' : undefined}
          large
          wrapper="col-span-2 order-first sm:order-none sm:col-span-1"
        />
      </div>
      {/* Mês sem nada lançado: trilho neutro (verde inteiro sugeria "guardou tudo"). */}
      <div className={cn('relative mt-5 h-2 overflow-hidden rounded-full', summary.income || summary.expense ? 'bg-income/25' : 'bg-fill-2')} aria-hidden>
        <div className="h-full rounded-full bg-expense/85 transition-[width] duration-1000 ease-out-expo" style={{ width: `${spentShare}%` }} />
      </div>
      <div className="relative mt-3 flex flex-wrap items-center justify-between gap-2 text-[13.5px] text-label-2">
        <span>{note}</span>
        {summary.contributions > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-invest" aria-hidden />
            {t('home.invested')}: <Amount cents={summary.contributions} className="font-semibold text-label" />
          </span>
        )}
      </div>
    </Card>
  )
}

function Stat({
  label,
  cents,
  className,
  large,
  wrapper,
  to,
  title,
}: {
  label: string
  cents: number
  className?: string
  large?: boolean
  wrapper?: string
  /** Endereço da lista filtrada (Entrou/Saiu levam aos lançamentos do mês). */
  to?: string
  title?: string
}) {
  const body = (
    <>
      <span className="block text-[13px] font-medium text-label-2">{label}</span>
      <Amount cents={cents} animate className={cn('block truncate font-semibold tracking-[-0.02em]', large ? 'text-[26px] sm:text-[32px]' : 'text-[20px] sm:text-[23px]', className)} />
    </>
  )
  if (!to) return <div className={cn('min-w-0', wrapper)}>{body}</div>
  return (
    <a href={to} title={title} className={cn('-m-2 min-w-0 rounded-xl p-2 transition-colors hover:bg-fill-2', wrapper)}>
      {body}
    </a>
  )
}

// ---------------------------------------------------------------- saldos

function BalancesCard({ data, today }: { data: DataState; today: ISODate }) {
  const { t } = useI18n()
  const overview = useMemo(() => balanceOverview(data, today), [data, today])
  const topBanks = useMemo(
    () =>
      data.banks
        .map((bank) => ({ bank, balance: overview.byBank.get(bank.id) ?? 0 }))
        .filter((x) => x.balance !== 0 || x.bank.isPrimary)
        .sort((a, b) => Number(b.bank.isPrimary) - Number(a.bank.isPrimary) || b.balance - a.balance)
        .slice(0, 5),
    [data.banks, overview],
  )
  const showProjected = overview.futureCount > 0 && overview.projected !== overview.total

  return (
    <Card className="fx-rise flex flex-col p-6" style={{ animationDelay: '80ms' }} aria-labelledby="home-balances">
      <div className="flex items-center justify-between">
        <h2 id="home-balances" className="text-[16.5px] font-semibold tracking-tight">
          {t('home.balances')}
        </h2>
        <a href={href('/banks')} className={link}>
          {t('common.seeAll')}
        </a>
      </div>
      <p className="mt-3 text-[13px] text-label-2">{t('home.totalBalance')}</p>
      <Amount cents={overview.total} animate className={cn('text-[29px] font-bold tracking-[-0.02em]', overview.total < 0 && 'text-expense')} />
      {showProjected && (
        <p className="mt-0.5 text-[13px] text-label-2">
          {t('home.projected')} <Amount cents={overview.projected} className={cn('font-semibold text-label', overview.projected < 0 && 'text-expense')} />
        </p>
      )}
      {data.banks.length === 0 ? (
        <p className="mt-3 text-[14px] text-label-2">
          {t('home.noBanks')}{' '}
          <a href={href('/banks')} className={link}>
            {t('form.addBank')}
          </a>
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {topBanks.map(({ bank, balance }) => (
            <li key={bank.id} className="flex items-center gap-2.5 text-[14px]">
              <BankAvatar name={bank.name} color={bank.color} size="sm" />
              <span className="min-w-0 flex-1 truncate">{bank.name}</span>
              <Amount cents={balance} className={cn('font-medium', balance < 0 && 'text-expense')} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- lançamentos

function EntriesCard({ data, today }: { data: DataState; today: ISODate }) {
  const { t } = useI18n()
  const lookups = useLookups(data)
  const { recent, upcoming, upcomingCount } = useMemo(() => homeEntries(data, today), [data, today])
  const empty = recent.length === 0 && upcoming.length === 0

  return (
    <Card className="fx-rise lg:col-span-3" style={{ animationDelay: '160ms' }}>
      <CardHeader
        title={t('home.recent')}
        action={
          <a href={href('/transactions')} className={link}>
            {t('common.seeAll')}
          </a>
        }
      />
      <div className="px-2 pb-2">
        {empty ? (
          <EmptyState
            title={t('home.emptyRecent')}
            hint={t('transactions.emptyHint')}
            action={
              <Button variant="primary" onClick={() => openNewEntry()}>
                {t('nav.new')}
              </Button>
            }
          />
        ) : (
          <>
            {recent.length === 0 ? (
              <p className="px-4 py-3 text-[14px] text-label-2">{t('home.noRecent')}</p>
            ) : (
              recent.map((entry, i) => <EntryRow key={entry.id} entry={entry} lookups={lookups} showDate index={i} />)
            )}
            {upcoming.length > 0 && (
              <section aria-labelledby="home-upcoming" className="mt-1 border-t border-sep/50 pt-2">
                <h3 id="home-upcoming" className="flex items-center gap-2 px-3 py-1 text-[12.5px] font-semibold tracking-wide text-label-2 uppercase">
                  {t('home.upcoming')}
                  <span className="rounded-full bg-fill-2 px-1.5 text-[11.5px] tabular-nums">{upcomingCount}</span>
                </h3>
                {upcoming.map((entry, i) => (
                  <EntryRow key={entry.id} entry={entry} lookups={lookups} showDate index={recent.length + i} />
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- lembrete

/** Enquanto o dono não guardou o código de recuperação, um lembrete discreto no Início. */
function RecoveryReminder() {
  const account = useAccount()
  const { t } = useI18n()
  if (!account || (account.recovery.createdAt && account.recovery.confirmed)) return null
  return (
    <a
      href={href('/account', { section: 'recovery' })}
      className="fx-rise flex items-center gap-3 rounded-2xl bg-warn/12 px-4 py-3 text-[14.5px] ring-1 ring-warn/30 transition-colors hover:bg-warn/18"
    >
      <LuLifeBuoy className="size-5 shrink-0 text-warn" aria-hidden />
      <span className="min-w-0 flex-1">{t('home.recoveryBanner')}</span>
      <span className="flex shrink-0 items-center gap-1 font-medium text-accent">
        {t('home.recoveryAction')}
        <LuArrowRight className="size-3.5" aria-hidden />
      </span>
    </a>
  )
}
