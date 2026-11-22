// Exibição: valores (com modo privacidade), números que contam, avatares e gráficos.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { LuArrowDownRight, LuArrowUpRight } from 'react-icons/lu'
import { cn } from '../lib/cn'
import { useSettings } from '../data/store'
import { useI18n } from '../i18n'
import { Icon } from './icons'

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/** Último valor não nulo: mantém o texto de um diálogo enquanto ele fecha com animação. */
export function useLatest<T>(value: T | null): T | null {
  const ref = useRef<T | null>(value)
  if (value !== null) ref.current = value
  return value ?? ref.current
}

/** Monta depois do primeiro quadro: usado para animar barras e arcos a partir do zero. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setMounted(true)))
    return () => cancelAnimationFrame(id)
  }, [])
  return mounted
}

// ---------------------------------------------------------------- valores

/** O que aparece no lugar de um número com "Ocultar valores" ligado. */
export const MASK = '•••••'

export function useHidden(): boolean {
  return useSettings().hideValues
}

/**
 * Valor em dinheiro. tone: 'kind' pinta pelo tipo (receita verde, despesa vermelha, investimento roxo);
 * 'sign' pinta pelo sinal.
 */
export function Amount({
  cents,
  kind,
  tone = 'none',
  sign = 'auto',
  className,
  animate = false,
}: {
  cents: number
  kind?: 'income' | 'expense' | 'investment'
  tone?: 'none' | 'kind' | 'sign'
  sign?: 'auto' | 'always' | 'never' | 'kind'
  className?: string
  animate?: boolean
}) {
  const i18n = useI18n()
  const hidden = useHidden()
  const value = sign === 'kind' && kind === 'expense' ? -Math.abs(cents) : cents
  const signMode = sign === 'kind' ? (kind === 'expense' || kind === 'income' ? 'always' : 'never') : sign
  const color =
    tone === 'kind'
      ? kind === 'income'
        ? 'text-income'
        : kind === 'expense'
          ? 'text-label'
          : kind === 'investment'
            ? 'text-invest'
            : undefined
      : tone === 'sign'
        ? value < 0
          ? 'text-expense'
          : value > 0
            ? 'text-income'
            : undefined
        : undefined
  if (hidden) {
    return (
      <span className={cn('tabular amount-hidden', className)} aria-label={i18n.t('common.hidden')}>
        {MASK}
      </span>
    )
  }
  const format = (v: number) => i18n.money(v, { sign: signMode })
  return (
    <span className={cn('tabular', color, className)}>{animate ? <AnimatedNumber value={value} format={format} /> : format(value)}</span>
  )
}

export function AnimatedNumber({ value, format, duration = 900 }: { value: number; format: (v: number) => string; duration?: number }) {
  const [shown, setShown] = useState(prefersReducedMotion() ? value : 0)
  const from = useRef(shown)
  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(value)
      return
    }
    const start = performance.now()
    const initial = from.current
    let frame = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - p, 4)
      const current = Math.round(initial + (value - initial) * eased)
      from.current = current
      setShown(current)
      if (p < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, duration])
  return <>{format(shown)}</>
}

export function ChangeBadge({ value, className }: { value: number; className?: string }) {
  const i18n = useI18n()
  const up = value > 0
  const flat = Math.abs(value) < 0.005
  const ArrowIcon = up ? LuArrowUpRight : LuArrowDownRight
  return (
    <span
      className={cn(
        'tabular inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[12.5px] font-semibold',
        flat ? 'bg-fill-2 text-label-2' : up ? 'bg-income/15 text-income' : 'bg-expense/15 text-expense',
        className,
      )}
    >
      {!flat && <ArrowIcon className="size-3" aria-hidden />}
      {i18n.percent(value, { sign: true })}
    </span>
  )
}

// ---------------------------------------------------------------- avatares

function readableText(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.45 ? '#1c1c1e' : '#ffffff'
}

const STOPWORDS = new Set(['de', 'do', 'da', 'dos', 'das', 'e'])

export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => w && !STOPWORDS.has(w.toLowerCase()))
  const acronym = words.find((w) => /^[A-Z0-9]{2,3}$/.test(w) && /[A-Z]/.test(w))
  if (acronym) return acronym
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return (words[0]?.[0] ?? '?').toUpperCase()
}

export function BankAvatar({ name, color, size = 'md' }: { name: string; color: string; size?: 'sm' | 'md' | 'lg' }) {
  const text = monogram(name)
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-semibold tracking-tight shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.18)]',
        size === 'sm' ? 'size-7 text-[11.5px]' : size === 'lg' ? 'size-12 text-[16.5px]' : 'size-10 text-[13px]',
        text.length > 2 && size !== 'lg' && 'text-[10px]',
      )}
      style={{ background: color, color: readableText(color) }}
    >
      {text}
    </span>
  )
}

export function CategoryIcon({ icon, color, size = 'md' }: { icon: string; color: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center text-white shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.15)]',
        size === 'sm' ? 'size-7 rounded-[8px] [&>svg]:size-4' : size === 'lg' ? 'size-12 rounded-[13px] [&>svg]:size-6' : 'size-10 rounded-[11px] [&>svg]:size-5',
      )}
      style={{ background: color }}
    >
      <Icon name={icon} />
    </span>
  )
}

// ---------------------------------------------------------------- gráficos

export interface Segment {
  key: string
  value: number
  color: string
  label: string
}

export function Donut({
  segments,
  size = 180,
  thickness = 16,
  center,
  label,
  activeKey,
  onActiveChange,
}: {
  segments: Segment[]
  size?: number
  thickness?: number
  center?: ReactNode
  label: string
  activeKey?: string | null
  onActiveChange?: (key: string | null) => void
}) {
  const mounted = useMounted()
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0)
  const r = 50 - thickness / 2
  const c = 2 * Math.PI * r
  const gap = segments.length > 1 ? 0.6 : 0
  let offset = 0
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" role="img" aria-label={label}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--lume-fill-2)" strokeWidth={thickness} />
        {total > 0 &&
          segments.map((s) => {
            const length = (Math.max(0, s.value) / total) * c
            const dash = Math.max(0, length - gap)
            const node = (
              <circle
                key={s.key}
                cx="50"
                cy="50"
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={activeKey === s.key ? thickness + 3 : thickness}
                strokeDasharray={mounted ? `${dash} ${c - dash}` : `0 ${c}`}
                strokeDashoffset={-offset}
                className="cursor-pointer transition-[stroke-dasharray,stroke-width,opacity] duration-[900ms] ease-out-expo"
                style={{ opacity: activeKey && activeKey !== s.key ? 0.35 : 1 }}
                onPointerEnter={() => onActiveChange?.(s.key)}
                onPointerLeave={() => onActiveChange?.(null)}
              >
                <title>{s.label}</title>
              </circle>
            )
            offset += length
            return node
          })}
      </svg>
      {center && <div className="absolute inset-0 grid place-items-center text-center">{center}</div>}
    </div>
  )
}

export function ProgressBar({ value, max, color, className }: { value: number; max: number; color: string; className?: string }) {
  const mounted = useMounted()
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-fill-2', className)} aria-hidden>
      <div className="h-full rounded-full transition-[width] duration-[900ms] ease-out-expo" style={{ width: mounted ? `${pct}%` : '0%', background: color }} />
    </div>
  )
}

export interface BarSeries {
  key: string
  label: string
  color: string
}

export interface BarGroup {
  key: string
  label: string
  values: Record<string, number>
  title?: string
}

/** Colunas agrupadas (ex.: receitas × despesas por mês). */
export function BarChart({
  groups,
  series,
  height = 180,
  format,
  label,
}: {
  groups: BarGroup[]
  series: BarSeries[]
  height?: number
  format: (v: number) => string
  label: string
}) {
  const hidden = useHidden()
  const [active, setActive] = useState<number | null>(null)
  const max = useMemo(() => Math.max(1, ...groups.flatMap((g) => series.map((s) => Math.max(0, g.values[s.key] ?? 0)))), [groups, series])
  const current = active !== null ? groups[active] : null
  return (
    <div className="relative" role="img" aria-label={label}>
      <div className="flex items-end gap-[3%] px-1" style={{ height }} onPointerLeave={() => setActive(null)}>
        {groups.map((g, gi) => (
          <div
            key={g.key}
            className="group relative flex h-full min-w-0 flex-1 items-end justify-center gap-[3px] rounded-md"
            onPointerEnter={() => setActive(gi)}
          >
            <div className={cn('absolute inset-x-[-2px] inset-y-0 rounded-md transition-colors', active === gi && 'bg-fill-2')} />
            {series.map((s, si) => {
              const v = Math.max(0, g.values[s.key] ?? 0)
              return (
                <div
                  key={s.key}
                  className="fx-grow relative w-full max-w-[18px] rounded-t-[4px] rounded-b-[2px]"
                  style={{
                    height: `${Math.max(v > 0 ? 2 : 0, (v / max) * 100)}%`,
                    background: s.color,
                    animationDelay: `${gi * 45 + si * 30}ms`,
                  }}
                />
              )
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-[3%] px-1">
        {groups.map((g, gi) => (
          <div key={g.key} className={cn('min-w-0 flex-1 truncate text-center text-[12px] text-label-3 capitalize', active === gi && 'text-label')}>
            {g.label}
          </div>
        ))}
      </div>
      {current && !hidden && (
        <div className="glass pointer-events-none absolute top-0 left-1/2 z-10 -translate-x-1/2 -translate-y-2 rounded-xl px-3 py-2 text-[13px] shadow-card ring-1 ring-sep/60 fx-fade">
          <div className="mb-1 font-semibold capitalize">{current.title ?? current.label}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-2 whitespace-nowrap">
              <span className="size-2 rounded-full" style={{ background: s.color }} />
              <span className="text-label-2">{s.label}</span>
              <span className="tabular ml-auto pl-3 font-medium">{format(current.values[s.key] ?? 0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-label-2">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  )
}
