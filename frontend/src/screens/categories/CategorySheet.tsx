// Folha de cadastro e edição de categoria: nome (sem repetir outra do mesmo tipo), tipo (travado
// se já tem lançamentos), cor e ícone. Fechar com algo mudado pergunta antes de descartar.

import { useMemo, useState, type FormEvent } from 'react'
import { LuTrash2 } from 'react-icons/lu'
import { PALETTE } from '../../data/catalog'
import { DataError, LIMITS } from '../../data/model'
import { actions, useData } from '../../data/store'
import type { Category, Kind } from '../../data/types'
import { useI18n } from '../../i18n'
import { CategoryIcon } from '../../ui/display'
import { ColorPicker, IconPicker } from '../../ui/pickers'
import { Button, Group, Row, Segmented, TextField } from '../../ui/primitives'
import { ConfirmDialog, Sheet } from '../../ui/Sheet'
import { toast } from '../../ui/toast'

interface Form {
  name: string
  kind: Kind
  icon: string
  color: string
}

export function CategorySheet({
  category,
  count,
  defaultKind,
  onClose,
  onDelete,
}: {
  category?: Category
  /** Lançamentos da categoria (a tela já tem essa conta): com algum, o tipo não muda. */
  count: number
  defaultKind: Kind
  onClose: () => void
  onDelete: (c: Category) => void
}) {
  const data = useData()
  const i18n = useI18n()
  const { t } = i18n
  const [open, setOpen] = useState(true)
  const [initial] = useState<Form>(() => ({
    name: category ? i18n.categoryName(category) : '',
    kind: category?.kind ?? defaultKind,
    icon: category?.icon ?? 'tag',
    color: category?.color ?? PALETTE[data.categories.length % PALETTE.length],
  }))
  const [form, setForm] = useState<Form>(initial)
  const [error, setError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const nameField = useMemo(() => ({ get current() { return document.getElementById('cat-name') } }), [])
  const locked = count > 0
  const dirty = (Object.keys(initial) as (keyof Form)[]).some((k) => form[k] !== initial[k])
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }))

  const close = () => {
    setOpen(false)
    window.setTimeout(onClose, 280)
  }
  const requestClose = () => (dirty ? setConfirmDiscard(true) : close())

  const submit = (e: FormEvent) => {
    e.preventDefault()
    try {
      // Categoria que veio com o app e manteve o nome: continua traduzida quando o idioma muda.
      const keepTranslation = Boolean(category?.nameKey && !category.name && form.name.trim() === i18n.categoryName(category))
      actions.saveCategory({ id: category?.id, ...form, keepTranslation })
      toast(t('categories.saved'))
      close()
    } catch (err) {
      const code = err instanceof DataError ? err.code : null
      if (code === 'duplicate') setError(t('categories.duplicate'))
      else if (code === 'invalid' && (err as DataError).field === 'name') setError(t('form.errors.name'))
      else if (code === 'limit') toast.error(t('categories.limit', { max: LIMITS.categories }))
      else toast.error(t('form.errors.generic'))
      if (code === 'duplicate' || (err instanceof DataError && err.field === 'name')) document.getElementById('cat-name')?.focus()
    }
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={requestClose}
        size="sm"
        title={category ? t('categories.editTitle') : t('categories.newTitle')}
        closeLabel={t('common.close')}
        onSubmit={submit}
        initialFocus={category ? undefined : nameField}
        footer={
          <>
            {category && (
              <Button variant="ghost" className="text-expense" onClick={() => onDelete(category)}>
                <LuTrash2 className="size-4" aria-hidden />
                {t('common.delete')}
              </Button>
            )}
            <span className="flex-1" />
            <Button onClick={requestClose}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary">
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="flex flex-col items-center gap-2 py-2" aria-hidden>
            <div key={`${form.icon}${form.color}`} className="fx-pop">
              <CategoryIcon icon={form.icon} color={form.color} size="lg" />
            </div>
            <p className="max-w-full truncate text-[16.5px] font-semibold">{form.name || '—'}</p>
          </div>
          <Group>
            <Row label={t('common.name')} htmlFor="cat-name" error={error ?? undefined}>
              <TextField
                id="cat-name"
                value={form.name}
                maxLength={LIMITS.name}
                placeholder={t('categories.namePlaceholder')}
                aria-invalid={error ? true : undefined}
                onChange={(e) => {
                  set('name', e.target.value)
                  setError(null)
                }}
              />
            </Row>
            <Row label={t('common.type')} hint={locked ? t('categories.kindLocked') : undefined}>
              <Segmented
                size="sm"
                className="w-48"
                label={t('common.type')}
                value={form.kind}
                onChange={(v) => set('kind', v)}
                disabled={locked}
                options={[
                  { value: 'expense', label: t('kinds.expense'), tone: 'text-expense' },
                  { value: 'income', label: t('kinds.income'), tone: 'text-income' },
                ]}
              />
            </Row>
          </Group>
          <Group>
            <Row label={t('common.color')} stacked>
              <ColorPicker label={t('common.color')} value={form.color} onChange={(c) => set('color', c)} />
            </Row>
            <Row label={t('common.icon')} stacked>
              <IconPicker label={t('common.icon')} value={form.icon} color={form.color} onChange={(icon) => set('icon', icon)} />
            </Row>
          </Group>
        </div>
      </Sheet>
      <ConfirmDialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setConfirmDiscard(false)
          close()
        }}
        title={category ? t('form.discardEditTitle') : t('categories.discardNewTitle')}
        body={t('form.discardBody')}
        confirmLabel={t('form.discard')}
        cancelLabel={t('form.keepEditing')}
      />
    </>
  )
}
