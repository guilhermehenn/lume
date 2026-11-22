// Campos grandes das telas de entrada e de Minha conta: rótulo em cima, erro embaixo,
// senha com mostrar/esconder e aviso de Caps Lock, e o medidor de força da senha.

import { useId, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { LuArrowBigUpDash, LuEye, LuEyeOff } from 'react-icons/lu'
import { useI18n, type TKey } from '../i18n'
import { cn } from '../lib/cn'
import { passwordProblem, passwordStrength } from '../lib/password'

export type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  ref?: Ref<HTMLInputElement>
  label: string
  /** Texto de ajuda embaixo do campo (some quando há erro). */
  hint?: ReactNode
  error?: string
}

export function Field({ label, hint, error, trailing, className, id: givenId, ...props }: FieldProps & { trailing?: ReactNode }) {
  const autoId = useId()
  const id = givenId ?? autoId
  const described = [error ? `${id}-err` : null, !error && hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block px-1 text-[13.5px] font-medium text-label-2">
        {label}
      </label>
      <div
        className={cn(
          'flex h-12 items-center rounded-[13px] bg-fill-2 ring-1 ring-sep/50 transition-[box-shadow,background-color] focus-within:bg-surface focus-within:ring-2 focus-within:ring-accent',
          error && 'fx-shake ring-2 ring-expense/70',
        )}
      >
        <input
          {...props}
          id={id}
          className="h-full min-w-0 flex-1 bg-transparent px-4 text-[16px] text-label outline-none placeholder:text-label-3"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
        />
        {trailing}
      </div>
      {error ? (
        <p id={`${id}-err`} className="mt-1.5 px-1 text-[13.5px] font-medium text-expense" role="alert">
          {error}
        </p>
      ) : hint ? (
        <div id={`${id}-hint`} className="mt-1.5 px-1 text-[13px] text-label-2">
          {hint}
        </div>
      ) : null}
    </div>
  )
}

export function PasswordField({ onKeyDown, onKeyUp, onBlur, hint, ...props }: FieldProps) {
  const { t } = useI18n()
  const [visible, setVisible] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const watchCaps = (event: KeyboardEvent<HTMLInputElement>) => setCapsLock(event.nativeEvent.getModifierState?.('CapsLock') ?? false)
  return (
    <Field
      {...props}
      type={visible ? 'text' : 'password'}
      autoCapitalize="none"
      autoCorrect="off"
      onKeyDown={(event) => {
        watchCaps(event)
        onKeyDown?.(event)
      }}
      onKeyUp={(event) => {
        watchCaps(event)
        onKeyUp?.(event)
      }}
      onBlur={(event) => {
        setCapsLock(false)
        onBlur?.(event)
      }}
      hint={
        capsLock ? (
          <span className="flex items-center gap-1.5 font-medium text-warn" role="status">
            <LuArrowBigUpDash className="size-4" aria-hidden />
            {t('gate.capsLock')}
          </span>
        ) : (
          hint
        )
      }
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t('gate.hidePassword') : t('gate.showPassword')}
          aria-pressed={visible}
          className="mr-1.5 grid size-9 place-items-center rounded-full text-label-3 transition-colors hover:bg-fill hover:text-label"
        >
          {visible ? <LuEyeOff className="size-[18px]" aria-hidden /> : <LuEye className="size-[18px]" aria-hidden />}
        </button>
      }
    />
  )
}

export function StrengthMeter({ password }: { password: string }) {
  const { t } = useI18n()
  if (!password) return null
  const score = passwordStrength(password)
  const labels = [t('create.strength.weak'), t('create.strength.fair'), t('create.strength.good'), t('create.strength.strong')]
  const colors = ['bg-expense', 'bg-warn', 'bg-income', 'bg-income']
  return (
    <div className="mt-2 flex items-center gap-3 px-1">
      <div className="flex flex-1 gap-1" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn('h-1.5 flex-1 rounded-full transition-colors duration-300', i <= score ? colors[score] : 'bg-fill')} />
        ))}
      </div>
      <span className="w-20 text-right text-[12.5px] font-medium text-label-2" aria-live="polite">
        {labels[score]}
      </span>
    </div>
  )
}

export function passwordError(password: string, t: (key: TKey) => string): string | undefined {
  const problem = passwordProblem(password)
  if (problem === 'short') return t('create.errors.passwordShort')
  if (problem === 'long') return t('create.errors.passwordLong')
  if (problem === 'spaces') return t('create.errors.passwordSpaces')
  return undefined
}

/** Leva o foco ao primeiro campo com erro (depois de a tela atualizar). */
export function focusFirstInvalid(root: HTMLElement | null): void {
  window.requestAnimationFrame(() => root?.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus())
}
