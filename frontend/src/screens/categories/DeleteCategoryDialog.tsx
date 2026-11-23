// Exclusão de categoria. Com lançamentos, eles vão para outra do mesmo tipo (sugestão: "Outras
// despesas" ou "Outras receitas"); sem outra do mesmo tipo, o diálogo explica o que fazer antes.

import { useState } from 'react'
import { actions, captureUndoAction, useData } from '../../data/store'
import type { Category } from '../../data/types'
import { useI18n } from '../../i18n'
import { useLatest } from '../../ui/display'
import { Select } from '../../ui/inputs'
import { ConfirmDialog } from '../../ui/Sheet'
import { toast } from '../../ui/toast'
import { categoryOptions } from '../entry/options'

export function DeleteCategoryDialog({
  category: current,
  count: currentCount,
  onClose,
  onDeleted,
}: {
  category: Category | null
  /** Lançamentos da categoria (a tela já tem essa conta). */
  count: number
  onClose: () => void
  onDeleted: () => void
}) {
  const data = useData()
  // Mantém o conteúdo enquanto o diálogo faz a animação de saída.
  const category = useLatest(current)
  const count = useLatest<number>(current ? currentCount : null) ?? 0
  const i18n = useI18n()
  const { t } = i18n
  const [picked, setPicked] = useState<string | undefined>()
  const options = category ? categoryOptions(data, category.kind, i18n).filter((o) => o.value !== category.id) : []
  // Sugestão: "Outras despesas" / "Outras receitas", se não for a que sai. Dá para trocar.
  const fallback = category ? data.categories.find((c) => c.kind === category.kind && c.nameKey === `other_${category.kind}` && c.id !== category.id) : undefined
  const target = picked ?? fallback?.id
  const targetOption = options.find((o) => o.value === target)
  const moving = count > 0
  const blocked = moving && options.length === 0

  const reset = () => {
    setPicked(undefined)
    onClose()
  }
  const confirm = () => {
    if (!current || !category) return
    try {
      actions.deleteCategory(category.id, moving ? target : undefined)
      const message = moving && targetOption ? t('categories.deletedMoved', { count, target: targetOption.label }) : t('categories.deleted')
      toast(message, { action: captureUndoAction(t('common.undo')) })
      onDeleted()
    } catch {
      toast.error(t('errors.generic'))
    }
    reset()
  }

  return (
    <ConfirmDialog
      open={current !== null}
      onClose={reset}
      onConfirm={confirm}
      title={t('categories.deleteTitle', { name: category ? i18n.categoryName(category) : '' })}
      body={blocked ? t('categories.noTarget', { count }) : moving ? t('categories.inUse', { count }) : t('categories.deleteBody')}
      confirmLabel={moving ? t('categories.deleteAndMove') : t('common.delete')}
      cancelLabel={t('common.cancel')}
      confirmDisabled={moving && !targetOption}
    >
      {moving && !blocked && (
        <div className="rounded-xl bg-fill-2 px-3 py-2 text-[14px]">
          {/* Rótulo em cima: o nome do destino usa a largura toda, sem reticências. */}
          <span className="block text-[12.5px] text-label-2">{t('categories.moveTo')}</span>
          <Select className="mr-0 -ml-2 w-[calc(100%+0.5rem)]" label={t('categories.moveTo')} value={target} options={options} placeholder={t('form.morePlaceholder')} onChange={setPicked} />
        </div>
      )}
    </ConfirmDialog>
  )
}
