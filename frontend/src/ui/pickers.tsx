// Escolha de cor e de ícone (bancos e categorias). Cada grade é um grupo de opções de verdade:
// um só ponto de parada no Tab, setas trocam a escolha, e cada opção tem nome no idioma do app.

import { useRef, type KeyboardEvent } from 'react'
import { LuCheck } from 'react-icons/lu'
import { cn } from '../lib/cn'
import { CATEGORY_ICONS, PALETTE, PALETTE_NAMES } from '../data/catalog'
import { useI18n } from '../i18n'
import { Icon } from './icons'

/** Setas, Home e End trocam a escolha e levam o foco junto (como num grupo de rádios). */
function useRadioKeys<T extends string>(values: readonly T[], value: T, onChange: (value: T) => void) {
  const group = useRef<HTMLDivElement>(null)
  const current = Math.max(0, values.indexOf(value))
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = values.length - 1
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? Math.min(last, current + 1)
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? Math.max(0, current - 1)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null
    if (next === null) return
    e.preventDefault()
    onChange(values[next])
    group.current?.querySelectorAll<HTMLButtonElement>('[role=radio]')[next]?.focus()
  }
  return { group, onKeyDown, tabIndex: (i: number) => (i === current ? 0 : -1) }
}

export function ColorPicker({ value, onChange, label }: { value: string; onChange: (color: string) => void; label: string }) {
  const { t } = useI18n()
  const known = PALETTE.find((c) => c.toUpperCase() === value.toUpperCase())
  // Cor que não é da paleta (a de um banco do catálogo, por exemplo) fica como primeira opção.
  const colors = known ? PALETTE : [value, ...PALETTE]
  const selectedValue = known ?? value
  const { group, onKeyDown, tabIndex } = useRadioKeys(colors, selectedValue, onChange)
  return (
    <div ref={group} role="radiogroup" aria-label={label} className="flex w-full flex-wrap gap-2" onKeyDown={onKeyDown}>
      {colors.map((color, i) => {
        const selected = color === selectedValue
        const name = PALETTE_NAMES[color]
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={name ? t(`colorNames.${name}`) : t('colorNames.current')}
            tabIndex={tabIndex(i)}
            onClick={() => onChange(color)}
            className={cn(
              'grid size-7 place-items-center rounded-full transition-transform duration-200 ease-spring hover:scale-110 active:scale-95',
              selected && 'ring-2 ring-label/70 ring-offset-2 ring-offset-surface',
            )}
            style={{ background: color }}
          >
            {selected && <LuCheck className="size-3.5 text-white drop-shadow" aria-hidden />}
          </button>
        )
      })}
    </div>
  )
}

export function IconPicker({ value, onChange, color, label }: { value: string; onChange: (icon: string) => void; color: string; label: string }) {
  const { t } = useI18n()
  const { group, onKeyDown, tabIndex } = useRadioKeys(CATEGORY_ICONS, value as (typeof CATEGORY_ICONS)[number], onChange)
  return (
    // w-full: dentro de uma linha do formulário, a grade encolhia para uma coluna só.
    <div ref={group} role="radiogroup" aria-label={label} className="grid w-full grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1.5" onKeyDown={onKeyDown}>
      {CATEGORY_ICONS.map((name, i) => {
        const selected = name === value
        return (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={t(`iconNames.${name}`)}
            title={t(`iconNames.${name}`)}
            tabIndex={tabIndex(i)}
            onClick={() => onChange(name)}
            className={cn(
              'grid aspect-square place-items-center rounded-[10px] transition-all duration-200 ease-apple active:scale-90 [&>svg]:size-[18px]',
              selected ? 'text-white shadow-[0_4px_12px_rgba(0,0,0,0.25)]' : 'bg-fill-2 text-label-2 hover:bg-fill hover:text-label',
            )}
            style={selected ? { background: color } : undefined}
          >
            <Icon name={name} />
          </button>
        )
      })}
    </div>
  )
}
