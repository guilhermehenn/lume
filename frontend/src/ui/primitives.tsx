// Componentes básicos da interface: botões, cartões, listas agrupadas (estilo iOS),
// controle segmentado, interruptor e estados vazios.

import { Switch as HSwitch } from '@headlessui/react'
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, Ref } from 'react'
import { cn } from '../lib/cn'

// ---------------------------------------------------------------- botões

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'tinted'
type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:brightness-110 shadow-[0_1px_0_rgba(255,255,255,0.18)_inset]',
  secondary: 'bg-fill text-label hover:bg-fill-2',
  ghost: 'text-accent hover:bg-fill-2',
  danger: 'bg-expense text-white hover:brightness-110',
  tinted: 'bg-accent/15 text-accent hover:bg-accent/20',
}
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-[14px] gap-1.5 rounded-[10px]',
  md: 'h-10 px-4 text-[15px] gap-2 rounded-[11px]',
  lg: 'h-12 px-5 text-[16.5px] gap-2 rounded-xl',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap transition-[filter,background-color,transform,opacity] duration-150 ease-out select-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  )
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-full text-label-2 transition-[background-color,color,transform] duration-150 hover:bg-fill hover:text-label active:scale-90 disabled:opacity-40',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------- estrutura

export function Card({ className, children, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn('rounded-[20px] bg-surface shadow-card ring-1 ring-sep/40', className)} {...props}>
      {children}
    </section>
  )
}

export function CardHeader({ title, action, className }: { title: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-12 items-center justify-between gap-3 px-6 pt-5 pb-2', className)}>
      <h2 className="text-[16.5px] font-semibold tracking-tight">{title}</h2>
      {action}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="fx-rise mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[32px] leading-tight font-bold tracking-[-0.022em]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-[15px] text-label-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="fx-fade flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon && <div className="mb-2 grid size-12 place-items-center rounded-2xl bg-fill-2 text-label-3 [&>svg]:size-6">{icon}</div>}
      <p className="text-[16.5px] font-semibold">{title}</p>
      {hint && <p className="max-w-sm text-[14px] text-label-2">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />
}

export function Badge({ children, className, ...rest }: { children: ReactNode; className?: string; title?: string; 'aria-label'?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md bg-fill-2 px-1.5 py-0.5 text-[12px] font-semibold text-label-2', className)} {...rest}>
      {children}
    </span>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn('fx-spin inline-block size-4 rounded-full border-2 border-current border-r-transparent', className)} aria-hidden />
}

// ---------------------------------------------------------------- listas agrupadas

export function Group({ title, footer, children, className }: { title?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      {title && <div className="mb-2 px-4 text-[13px] font-medium tracking-wide text-label-2 uppercase">{title}</div>}
      <div className="divide-y divide-sep/70 overflow-hidden rounded-xl bg-surface-2/60 ring-1 ring-sep/40 dark:bg-surface-2/55">{children}</div>
      {footer && <div className="mt-1.5 px-4 text-[13px] text-label-2">{footer}</div>}
    </div>
  )
}

export function Row({
  label,
  htmlFor,
  children,
  error,
  hint,
  className,
  stacked,
  stackOnMobile,
}: {
  label: ReactNode
  htmlFor?: string
  children: ReactNode
  error?: string
  hint?: ReactNode
  className?: string
  stacked?: boolean
  /** No celular, o rótulo fica em cima e o controle ocupa a largura toda (ex.: opções lado a lado). */
  stackOnMobile?: boolean
}) {
  return (
    <div className={cn('px-4 py-3', error && 'fx-shake bg-expense/[0.06]', className)} data-invalid={error ? '' : undefined}>
      <div
        className={cn(
          'flex min-h-9 gap-3',
          stacked ? 'flex-col items-stretch gap-2' : 'items-center',
          stackOnMobile && !stacked && 'max-sm:flex-col max-sm:items-stretch max-sm:gap-2',
        )}
      >
        <label htmlFor={htmlFor} className={cn('shrink-0 text-[15px] text-label', !stacked && (stackOnMobile ? 'w-44 max-sm:w-auto' : 'w-44 max-sm:w-28'))}>
          {label}
        </label>
        <div className={cn('flex min-w-0 flex-1 items-center', stacked ? 'justify-start' : 'justify-end', stackOnMobile && 'max-sm:justify-start')}>
          {children}
        </div>
      </div>
      {hint && !error && <p className="mt-1 text-[13px] text-label-2">{hint}</p>}
      {error && (
        <p className="mt-1 text-[13px] font-medium text-expense" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export const inputClass =
  'w-full min-w-0 bg-transparent text-right text-[15px] text-label placeholder:text-label-3 outline-none focus-visible:outline-none'

export function TextField({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClass, className)} autoComplete="off" spellCheck={false} {...props} />
}

export function SearchField({
  value,
  onChange,
  placeholder,
  inputRef,
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  inputRef?: Ref<HTMLInputElement>
  className?: string
}) {
  return (
    <label className={cn('flex h-10 items-center gap-2 rounded-[11px] bg-fill-2 px-3.5 text-label-2 ring-accent/60 transition-shadow focus-within:ring-2', className)}>
      <svg viewBox="0 0 24 24" className="size-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-label outline-none placeholder:text-label-3 focus-visible:outline-none"
      />
    </label>
  )
}

// ---------------------------------------------------------------- segmentado e interruptor

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
  /** Cor do indicador quando selecionado (ex.: verde para receitas). */
  tone?: string
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
  size = 'md',
  disabled,
}: {
  value: T
  options: SegmentOption<T>[]
  onChange: (value: T) => void
  label: string
  className?: string
  size?: 'sm' | 'md'
  /** Travado de verdade: nem o mouse nem o teclado trocam a opção. */
  disabled?: boolean
}) {
  const found = options.findIndex((o) => o.value === value)
  const index = Math.max(0, found)
  const move = (delta: number) => {
    const next = options[(index + delta + options.length) % options.length]
    onChange(next.value)
  }
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cn('relative grid rounded-[11px] bg-fill-2 p-0.5', size === 'sm' ? 'h-9' : 'h-10', disabled && 'opacity-50', className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      onKeyDown={(e) => {
        if (disabled) return
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault()
          move(1)
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault()
          move(-1)
        }
      }}
    >
      <span
        aria-hidden
        className="absolute top-0.5 bottom-0.5 left-0.5 rounded-[8px] bg-surface-3 shadow-[0_1px_3px_rgba(0,0,0,0.18),0_0_0_0.5px_rgba(0,0,0,0.04)] transition-transform duration-300 ease-apple dark:bg-[#636366]/70"
        style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${index * 100}%)`, opacity: found < 0 ? 0 : 1 }}
      />
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            tabIndex={selected || (found < 0 && option === options[0]) ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative z-10 flex min-w-0 items-center justify-center gap-1.5 truncate rounded-[8px] px-2 font-semibold transition-colors duration-200 disabled:cursor-not-allowed',
              size === 'sm' ? 'text-[13.5px]' : 'text-[14px]',
              selected ? (option.tone ?? 'text-label') : cn('text-label-2', !disabled && 'hover:text-label'),
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (value: boolean) => void; label: string; id?: string }) {
  return (
    <HSwitch
      id={id}
      checked={checked}
      onChange={onChange}
      aria-label={label}
      className="group relative inline-flex h-[30px] w-[50px] shrink-0 cursor-pointer rounded-full bg-fill p-0.5 transition-colors duration-200 ease-out data-checked:bg-income"
    >
      <span className="pointer-events-none size-[26px] rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.25)] transition-transform duration-300 ease-spring group-data-checked:translate-x-[20px]" />
    </HSwitch>
  )
}

/** Chips de escolha única opcional (clique de novo para desmarcar). */
export function ChoiceChips<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T | undefined
  options: { value: T; label: string }[]
  onChange: (value: T | undefined) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(selected ? undefined : option.value)}
            className={cn(
              'h-8 rounded-full px-3.5 text-[14px] font-medium transition-all duration-200 ease-apple active:scale-95',
              selected ? 'bg-accent text-white shadow-[0_2px_8px_color-mix(in_oklab,var(--lume-accent)_35%,transparent)]' : 'bg-fill-2 text-label-2 hover:bg-fill hover:text-label',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
