// Mercado (cotações e indicadores) e notícias de investimentos do Início.
//
// Os dados vêm do back-end, que busca nas fontes públicas e guarda a última resposta. Sem
// internet na primeira vez, ele responde com listas vazias: aqui isso vira o aviso de "sem
// conexão", e não uma seção em branco.

import { LuExternalLink, LuNewspaper, LuRefreshCw, LuTriangleAlert, LuWifiOff } from 'react-icons/lu'
import { useMarket, useNews, type Indicator, type Quote } from '../../api/client'
import { cn } from '../../lib/cn'
import { useI18n } from '../../i18n'
import { ChangeBadge } from '../../ui/display'
import { Card, CardHeader, EmptyState, Skeleton } from '../../ui/primitives'

function formatQuote(value: number, locale: string): string {
  const digits = value >= 10_000 ? 0 : 2
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'BRL', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
}

export function MarketSection() {
  const i18n = useI18n()
  const { t } = i18n
  const market = useMarket()
  const quotes = market.data?.quotes ?? []
  const indicators = market.data?.indicators ?? []
  const waiting = market.loading && !market.data
  const offline = !waiting && quotes.length === 0 && indicators.length === 0
  // Desatualizado: o back-end avisou (fonte fora do ar) ou nem o back-end respondeu agora.
  const stale = Boolean(market.data?.stale || (market.error && market.data))

  return (
    <section className="fx-rise" style={{ animationDelay: '120ms' }} aria-labelledby="market-title" aria-busy={waiting || market.refreshing}>
      <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
        <h2 id="market-title" className="text-[16.5px] font-semibold tracking-tight">
          {t('home.market')}
        </h2>
        {market.data?.updated_at && (
          <span className="flex items-center gap-1.5 text-[13px] text-label-2">
            {stale && (
              <span role="img" aria-label={t('home.stale')} title={t('home.stale')} className="flex">
                <LuTriangleAlert className="size-3.5 text-warn" aria-hidden />
              </span>
            )}
            {t('home.updated', { time: i18n.relative(market.data.updated_at) })}
          </span>
        )}
        <button
          type="button"
          onClick={market.refresh}
          disabled={market.refreshing}
          className="ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13.5px] font-medium text-accent transition-colors hover:bg-fill-2 disabled:opacity-50"
        >
          <LuRefreshCw className={cn('size-3.5', market.refreshing && 'fx-spin')} aria-hidden />
          {t('common.refresh')}
        </button>
      </div>
      {offline ? (
        <Card className="flex items-center gap-3 p-5 text-[14px]">
          <LuWifiOff className="size-5 shrink-0 text-label-3" aria-hidden />
          <div>
            <p className="font-medium">{t('home.marketOffline')}</p>
            <p className="text-label-2">{t('home.marketOfflineHint')}</p>
          </div>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 2xl:grid-cols-[4fr_3fr]">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {waiting ? Array.from({ length: 4 }, (_, i) => <TileSkeleton key={i} />) : quotes.map((q) => <QuoteTile key={q.id} quote={q} />)}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {waiting ? Array.from({ length: 3 }, (_, i) => <TileSkeleton key={i} />) : indicators.map((ind) => <IndicatorTile key={ind.id} indicator={ind} />)}
            </div>
          </div>
          {market.data && market.data.sources.length > 0 && (
            <p className="mt-2 px-1 text-[12px] text-label-3">{t('home.sources', { sources: market.data.sources.join(' · ') })}</p>
          )}
        </>
      )}
    </section>
  )
}

function TileSkeleton() {
  return (
    <Card className="h-[112px] p-5">
      <Skeleton className="h-3 w-14" />
      <Skeleton className="mt-3 h-5 w-24" />
    </Card>
  )
}

function QuoteTile({ quote }: { quote: Quote }) {
  const i18n = useI18n()
  const name = i18n.tx(`home.quotes.${quote.id}`)
  return (
    <Card className={cn('p-5 transition-opacity', quote.stale && 'opacity-60')} title={quote.as_of ? i18n.relative(quote.as_of) : undefined}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-label-2">{name}</span>
        <span className="text-[11.5px] font-semibold tracking-wide text-label-3">{quote.id}</span>
      </div>
      <p className="tabular mt-1.5 truncate text-[18.5px] font-semibold tracking-[-0.01em]">{formatQuote(quote.value, i18n.locale)}</p>
      <ChangeBadge value={quote.change_pct} className="mt-1.5" />
    </Card>
  )
}

function IndicatorTile({ indicator }: { indicator: Indicator }) {
  const i18n = useI18n()
  const { t } = i18n
  const name = i18n.tx(`home.quotes.${indicator.id}`)
  const suffix = indicator.id === 'IPCA12M' ? t('home.last12') : t('home.perYear')
  return (
    <Card className={cn('bg-surface/70 p-5', indicator.stale && 'opacity-60')} title={indicator.as_of ? i18n.date(indicator.as_of) : undefined}>
      <span className="text-[13px] font-semibold text-label-2">{name}</span>
      <p className="tabular mt-1.5 text-[18.5px] font-semibold tracking-[-0.01em]">{i18n.percent(indicator.value)}</p>
      <p className="mt-1.5 text-[12.5px] text-label-3">{suffix}</p>
    </Card>
  )
}

export function NewsCard() {
  const i18n = useI18n()
  const { t } = i18n
  const news = useNews()
  const items = news.data?.items ?? []
  const failed = news.error || Boolean(news.data?.errors?.length)
  return (
    <Card className="fx-rise flex flex-col lg:col-span-2" style={{ animationDelay: '200ms' }} aria-busy={news.loading && !news.data}>
      <CardHeader title={t('home.news')} action={<LuNewspaper className="size-4 text-label-3" aria-hidden />} />
      <div className="flex-1 px-2 pb-2">
        {news.loading && !news.data ? (
          <div className="space-y-4 p-3">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i}>
                <Skeleton className="h-3 w-24" />
                <Skeleton className="mt-2 h-4 w-full" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={<LuNewspaper />} title={failed ? t('home.newsOffline') : t('home.newsEmpty')} />
        ) : (
          <ul>
            {items.slice(0, 6).map((item, i) => (
              <li key={item.link} className="fx-rise" style={{ animationDelay: `${220 + i * 30}ms` }}>
                <a href={item.link} target="_blank" rel="noopener noreferrer" className="group flex gap-2 rounded-xl px-3 py-3 transition-colors hover:bg-fill-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-medium text-label-2">
                      {item.source}
                      {item.published_at && <> · {i18n.relative(item.published_at)}</>}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-[15px] leading-snug font-medium text-label group-hover:text-accent">{item.title}</span>
                  </span>
                  <LuExternalLink className="mt-1 size-3.5 shrink-0 text-label-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                  <span className="sr-only">{t('home.opensInNewTab')}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}
