// Campos de formulário: valor em dinheiro (centavos entram pela direita), seleção,
// sugestões, quantidade, data e CNPJ.

import {
  Combobox,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from '@headlessui/react'
import { useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react'
import { LuCheck, LuChevronsUpDown } from 'react-icons/lu'
import { cn } from '../lib/cn'
import { digitsToCents, parseDecimal, parseMoneyText } from '../lib/money'
import { formatCnpj } from '../data/model'
import { useI18n } from '../i18n'
import { inputClass } from './primitives'

const MAX_CENTS = 9_999_999_999_999

// ---------------------------------------------------------------- dinheiro

interface MoneyProps {
  value: number
  onChange: (cents: number) => void
  format: (cents: number) => string
  id?: string
  label?: string
  allowNegative?: boolean
  autoFocus?: boolean
  className?: string
  invalid?: boolean
}

function useMoneyInput({ value, onChange, allowNegative }: Pick<MoneyProps, 'value' | 'onChange' | 'allowNegative'>) {
  const ref = useRef<HTMLInputElement>(null)
  // Ctrl/Cmd+A logo depois do clique: o cursor só vai para o fim no próximo quadro, e sem isso
  // desfaria a seleção — o número digitado seria somado ao valor antigo em vez de trocá-lo.
  const selectedAll = useRef(false)
  const sign = value < 0 ? -1 : 1
  const abs = Math.abs(value)

  const toEnd = () => {
    const el = ref.current
    if (!el) return
    selectedAll.current = false
    requestAnimationFrame(() => {
      if (selectedAll.current) return
      const n = el.value.length
      el.setSelectionRange(n, n)
    })
  }

  useLayoutEffect(() => {
    const el = ref.current
    if (el && document.activeElement === el) {
      const n = el.value.length
      el.setSelectionRange(n, n)
    }
  }, [value])

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) {
      if (e.key.toLowerCase() === 'a') selectedAll.current = true
      return
    }
    selectedAll.current = false
    const el = e.currentTarget
    const allSelected = el.selectionStart === 0 && el.selectionEnd === el.value.length && el.value.length > 0
    if (/^\d$/.test(e.key)) {
      e.preventDefault()
      const digit = Number(e.key)
      const base = allSelected ? 0 : abs
      const next = base * 10 + digit
      if (next <= MAX_CENTS) onChange(sign * next)
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault()
      onChange(allSelected ? 0 : sign * Math.floor(abs / 10))
    } else if (e.key === '-' && allowNegative) {
      e.preventDefault()
      onChange(-value)
    } else if (e.key === '+' && allowNegative) {
      e.preventDefault()
      onChange(abs)
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const parsed = parseMoneyText(e.clipboardData.getData('text'))
    e.preventDefault()
    if (parsed === null) return
    const next = Math.min(Math.abs(parsed), MAX_CENTS)
    onChange(allowNegative && parsed < 0 ? -next : next)
  }

  // Teclados virtuais e preenchimento automático chegam pelo onChange.
  const onInputChange = (text: string) => onChange(sign * Math.min(digitsToCents(text), MAX_CENTS))

  return { ref, onKeyDown, onPaste, onInputChange, toEnd }
}

/** Valor grande no topo dos formulários, como no app do banco. */
export function AmountInput(props: MoneyProps & { tone?: string }) {
  const { ref, onKeyDown, onPaste, onInputChange, toEnd } = useMoneyInput(props)
  const empty = props.value === 0
  return (
    <input
      ref={ref}
      id={props.id}
      aria-label={props.label}
      aria-invalid={props.invalid || undefined}
      inputMode="numeric"
      autoComplete="off"
      autoFocus={props.autoFocus}
      value={props.format(props.value)}
      onChange={(e) => onInputChange(e.target.value)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onFocus={toEnd}
      onClick={toEnd}
      className={cn(
        'tabular w-full bg-transparent text-center text-[48px] leading-none font-semibold tracking-[-0.03em] caret-accent outline-none focus-visible:outline-none',
        empty ? 'text-label-3' : (props.tone ?? 'text-label'),
        props.className,
      )}
    />
  )
}

/** Valor em dinheiro dentro de uma linha do formulário. */
export function MoneyField(props: MoneyProps & { placeholderZero?: boolean }) {
  const { ref, onKeyDown, onPaste, onInputChange, toEnd } = useMoneyInput(props)
  return (
    <input
      ref={ref}
      id={props.id}
      aria-label={props.label}
      aria-invalid={props.invalid || undefined}
      inputMode="numeric"
      autoComplete="off"
      value={props.format(props.value)}
      onChange={(e) => onInputChange(e.target.value)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onFocus={toEnd}
      onClick={toEnd}
      className={cn(inputClass, 'tabular caret-accent', props.value === 0 && 'text-label-3', props.className)}
    />
  )
}

// ---------------------------------------------------------------- quantidade

export function DecimalField({
  value,
  onChange,
  id,
  label,
  format,
  placeholder,
  invalid,
}: {
  value: number | undefined
  onChange: (value: number | undefined) => void
  id?: string
  label?: string
  format: (value: number) => string
  placeholder?: string
  invalid?: boolean
}) {
  const [text, setText] = useState(() => (value === undefined ? '' : format(value)))
  const [focused, setFocused] = useState(false)
  const shown = focused ? text : value === undefined ? '' : format(value)
  return (
    <input
      id={id}
      aria-label={label}
      aria-invalid={invalid || undefined}
      inputMode="decimal"
      autoComplete="off"
      placeholder={placeholder ?? '0'}
      value={shown}
      onFocus={() => {
        setText(value === undefined ? '' : format(value))
        setFocused(true)
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^\d.,]/g, '').slice(0, 24)
        setText(raw)
        const parsed = parseDecimal(raw)
        onChange(parsed === null || parsed === 0 ? undefined : Math.round(parsed * 1e8) / 1e8)
      }}
      className={cn(inputClass, 'tabular')}
    />
  )
}

// ---------------------------------------------------------------- data e CNPJ

export function DateField({ value, onChange, id, label, invalid, min, max }: { value: string; onChange: (value: string) => void; id?: string; label?: string; invalid?: boolean; min?: string; max?: string }) {
  return (
    <input
      id={id}
      type="date"
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={value}
      min={min ?? '1900-01-01'}
      max={max ?? '2199-12-31'}
      onChange={(e) => onChange(e.target.value)}
      className={cn(inputClass, 'tabular w-auto cursor-pointer rounded-md px-1 hover:bg-fill-2')}
    />
  )
}

export function CnpjField({ value, onChange, id, label, invalid }: { value: string; onChange: (value: string) => void; id?: string; label?: string; invalid?: boolean }) {
  return (
    <input
      id={id}
      aria-label={label}
      aria-invalid={invalid || undefined}
      // Texto, não só números: CNPJ novo pode ter letras (12.ABC.345/01DE-35).
      autoCapitalize="characters"
      autoComplete="off"
      spellCheck={false}
      placeholder="00.000.000/0000-00"
      value={value}
      onChange={(e) => onChange(formatCnpj(e.target.value))}
      className={cn(inputClass, 'tabular')}
    />
  )
}

// ---------------------------------------------------------------- seleção

export interface SelectOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
  hint?: string
}

const optionsPanel =
  'glass z-[70] max-h-96 min-w-(--button-width) overflow-y-auto rounded-[14px] p-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.35)] ring-1 ring-sep/60 [--anchor-gap:6px] [--anchor-padding:12px] origin-top transition duration-200 ease-apple outline-none data-closed:scale-95 data-closed:opacity-0'
const optionRow =
  'group flex cursor-pointer items-center gap-3 rounded-[9px] px-3 py-2 text-[15px] text-label select-none data-focus:bg-accent data-focus:text-white'

export function Select<T extends string>({
  value,
  onChange,
  options,
  placeholder,
  label,
  id,
  invalid,
  className,
}: {
  value: T | undefined
  onChange: (value: T) => void
  options: SelectOption<T>[]
  placeholder: string
  label: string
  id?: string
  invalid?: boolean
  className?: string
}) {
  const selected = options.find((o) => o.value === value)
  return (
    <Listbox value={value ?? null} onChange={(v: T | null) => v !== null && onChange(v)}>
      <ListboxButton
        id={id}
        aria-label={label}
        aria-invalid={invalid || undefined}
        className={cn(
          '-mr-2 flex max-w-full min-w-0 items-center gap-2 rounded-lg py-1 pr-1.5 pl-2 text-[15px] transition-colors hover:bg-fill-2 data-open:bg-fill-2',
          className,
        )}
      >
        {selected?.icon}
        <span className={cn('min-w-0 truncate', selected ? 'text-label' : invalid ? 'text-expense' : 'text-label-3')}>
          {selected?.label ?? placeholder}
        </span>
        <LuChevronsUpDown className="size-3.5 shrink-0 text-label-3" aria-hidden />
      </ListboxButton>
      <ListboxOptions anchor="bottom end" transition className={cn(optionsPanel, 'w-80')}>
        {options.map((option) => (
          <ListboxOption key={option.value} value={option.value} className={optionRow}>
            {option.icon}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{option.label}</span>
              {option.hint && <span className="block truncate text-[12.5px] text-label-2 group-data-focus:text-white/75">{option.hint}</span>}
            </span>
            <LuCheck className="invisible size-4 shrink-0 group-data-selected:visible" aria-hidden />
          </ListboxOption>
        ))}
      </ListboxOptions>
    </Listbox>
  )
}

export function MultiSelect<T extends string>({
  value,
  onChange,
  options,
  allLabel,
  label,
  id,
}: {
  value: T[]
  onChange: (value: T[]) => void
  options: SelectOption<T>[]
  allLabel: string
  label: string
  id?: string
}) {
  const { t } = useI18n()
  const chosen = options.filter((o) => value.includes(o.value))
  const summary =
    chosen.length === 0
      ? allLabel
      : chosen.length <= 2
        ? chosen.map((o) => o.label).join(', ')
        : t('common.andMore', { first: chosen[0].label, count: chosen.length - 1 })
  return (
    <Listbox value={value} onChange={onChange} multiple>
      <ListboxButton
        id={id}
        aria-label={label}
        className="flex h-9 w-full min-w-0 items-center gap-2 rounded-[10px] bg-fill-2 px-3 text-left text-[14px] transition-colors hover:bg-fill data-open:bg-fill"
      >
        <span className={cn('min-w-0 flex-1 truncate', value.length === 0 && 'text-label-2')}>{summary}</span>
        <LuChevronsUpDown className="size-3.5 shrink-0 text-label-3" aria-hidden />
      </ListboxButton>
      <ListboxOptions anchor="bottom start" transition className={cn(optionsPanel, 'w-80')}>
        {options.map((option) => (
          <ListboxOption key={option.value} value={option.value} className={optionRow}>
            <span className="grid size-4 shrink-0 place-items-center rounded-[5px] ring-1 ring-label-3 group-data-selected:bg-accent group-data-selected:ring-accent group-data-focus:ring-white/80">
              <LuCheck className="invisible size-3 text-white group-data-selected:visible" aria-hidden />
            </span>
            {option.icon}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{option.label}</span>
              {option.hint && <span className="block truncate text-[12.5px] text-label-2 group-data-focus:text-white/75">{option.hint}</span>}
            </span>
          </ListboxOption>
        ))}
      </ListboxOptions>
    </Listbox>
  )
}

// ---------------------------------------------------------------- sugestões ("Pago a")

export function Autocomplete({
  value,
  onChange,
  suggestions,
  id,
  label,
  placeholder,
  maxLength,
  invalid,
  uppercase,
}: {
  value: string
  /** Digitação e escolha de uma sugestão chegam aqui. */
  onChange: (value: string) => void
  suggestions: string[]
  id?: string
  label?: string
  placeholder?: string
  maxLength?: number
  invalid?: boolean
  uppercase?: boolean
}) {
  const query = value.trim().toLocaleLowerCase()
  const filtered = useMemo(
    () =>
      query
        ? suggestions.filter((s) => {
            const low = s.toLocaleLowerCase()
            return low.includes(query) && low !== query
          }).slice(0, 7)
        : [],
    [query, suggestions],
  )
  return (
    <Combobox
      value={value}
      onChange={(next: string | null) => {
        if (next !== null) onChange(next)
      }}
    >
      <div className="w-full">
        <ComboboxInput
          id={id}
          aria-label={label}
          aria-invalid={invalid || undefined}
          placeholder={placeholder}
          maxLength={maxLength}
          autoComplete="off"
          spellCheck={false}
          displayValue={(v: string | null) => v ?? ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(uppercase ? e.target.value.toUpperCase() : e.target.value)}
          className={cn(inputClass, uppercase && 'uppercase placeholder:normal-case')}
        />
      </div>
      {filtered.length > 0 && (
        <ComboboxOptions anchor="bottom end" transition className={cn(optionsPanel, 'w-80')}>
          {filtered.map((item) => (
            <ComboboxOption key={item} value={item} className={optionRow}>
              <span className="truncate">{item}</span>
            </ComboboxOption>
          ))}
        </ComboboxOptions>
      )}
    </Combobox>
  )
}
