// Categorias de despesa e de receita (o tipo fica no endereço): uso e total do mês em cada uma,
// cadastro, "Ver lançamentos" e exclusão com os lançamentos indo para outra do mesmo tipo.

import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { useMemo, useState } from 'react'
import { LuEllipsis, LuListOrdered, LuPencil, LuPlus, LuShapes, LuTrash2 } from 'react-icons/lu'
import { navigate, replaceQuery, useRoute } from '../../app/router'
import { cn } from '../../lib/cn'
import { monthOf, monthRange } from '../../lib/dates'
import { useToday } from '../../lib/useToday'
import { categoriesByName, categoryTotals, categoryUsageCounts } from '../../data/selectors'
import { useData } from '../../data/store'
import type { Category, Kind } from '../../data/types'
import { useI18n } from '../../i18n'
import { Amount, CategoryIcon } from '../../ui/display'
import { Button, Card, EmptyState, PageHeader, Segmented } from '../../ui/primitives'
import { CategorySheet } from './CategorySheet'
import { DeleteCategoryDialog } from './DeleteCategoryDialog'

const menuPanel =
  'glass z-[70] min-w-52 rounded-xl p-1 shadow-[0_16px_48px_rgba(0,0,0,0.35)] ring-1 ring-sep/60 [--anchor-gap:6px] origin-top-right transition duration-200 ease-apple outline-none data-closed:scale-95 data-closed:opacity-0'
const menuItem = 'flex w-full items-center gap-3 rounded-[9px] px-3 py-2 text-[15px] data-focus:bg-accent data-focus:text-white'

export function Categories() {
  const data = useData()
  const i18n = useI18n()
  const { t } = i18n
  const route = useRoute()
  // Receitas ficam no endereço (?kind=income): recarregar e voltar mantêm a aba.
  const kind: Kind = route.query.get('kind') === 'income' ? 'income' : 'expense'
  const setKind = (next: Kind) => replaceQuery({ kind: next === 'income' ? 'income' : undefined })
  const [editing, setEditing] = useState<{ category?: Category; seq: number } | null>(null)
  const [deleting, setDeleting] = useState<Category | null>(null)
  // Mês de hoje pelo relógio do app: acompanha a virada do mês com a tela aberta.
  const { today } = useToday()
  const month = monthOf(today)

  const { transactions } = data
  const usage = useMemo(() => categoryUsageCounts({ transactions }), [transactions])
  const monthTotals = useMemo(() => {
    const { from, to } = monthRange(month)
    return new Map(categoryTotals(data, kind, from, to).map((g) => [g.key, g.total]))
  }, [data, kind, month])
  const list = useMemo(() => categoriesByName(data.categories, kind, i18n.categoryName, i18n.locale), [data.categories, kind, i18n])
  const create = () => setEditing({ seq: Date.now() })

  return (
    <div>
      <PageHeader
        title={t('categories.title')}
        subtitle={t('categories.subtitle')}
        actions={
          <Button variant="primary" onClick={create}>
            <LuPlus className="size-4" aria-hidden />
            {t('categories.add')}
          </Button>
        }
      />
      <Segmented
        className="fx-rise mb-4 w-full sm:w-72"
        label={t('common.type')}
        value={kind}
        onChange={setKind}
        options={[
          { value: 'expense', label: t('kinds.expenses'), tone: 'text-expense' },
          { value: 'income', label: t('kinds.incomes'), tone: 'text-income' },
        ]}
      />
      {list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<LuShapes />}
            title={t('categories.empty')}
            action={
              <Button variant="primary" onClick={create}>
                <LuPlus className="size-4" aria-hidden />
                {t('categories.add')}
              </Button>
            }
          />
        </Card>
      ) : (
        // grid-cols-1: no celular, um nome longo não alarga a coluna além da tela.
        <ul key={kind} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={kind === 'income' ? t('kinds.incomes') : t('kinds.expenses')}>
          {list.map(({ category, name }, i) => (
            <CategoryCard
              key={category.id}
              category={category}
              name={name}
              index={i}
              count={usage.get(category.id) ?? 0}
              monthTotal={monthTotals.get(category.id) ?? 0}
              monthLabel={i18n.monthShort(month)}
              onEdit={() => setEditing({ category, seq: Date.now() })}
              onDelete={() => setDeleting(category)}
            />
          ))}
        </ul>
      )}

      {editing && (
        <CategorySheet
          key={editing.seq}
          category={editing.category}
          count={editing.category ? (usage.get(editing.category.id) ?? 0) : 0}
          defaultKind={kind}
          onClose={() => setEditing(null)}
          onDelete={(c) => setDeleting(c)}
        />
      )}
      <DeleteCategoryDialog
        category={deleting}
        count={deleting ? (usage.get(deleting.id) ?? 0) : 0}
        onClose={() => setDeleting(null)}
        onDeleted={() => setEditing(null)}
      />
    </div>
  )
}

function CategoryCard({
  category,
  name,
  index,
  count,
  monthTotal,
  monthLabel,
  onEdit,
  onDelete,
}: {
  category: Category
  name: string
  index: number
  count: number
  monthTotal: number
  monthLabel: string
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useI18n()
  return (
    <li
      className="fx-rise flex items-center gap-1 rounded-2xl bg-surface pr-2 shadow-card ring-1 ring-sep/40 transition-[transform,box-shadow] duration-200 ease-apple hover:-translate-y-0.5 hover:shadow-[0_14px_36px_rgba(0,0,0,0.28)]"
      style={{ animationDelay: `${Math.min(index, 18) * 22}ms` }}
    >
      <button type="button" onClick={onEdit} className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl p-3.5 text-left active:scale-[0.98]">
        <CategoryIcon icon={category.icon} color={category.color} size="lg" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15.5px] font-medium" title={name}>
            {name}
          </span>
          <span className="block truncate text-[13px] text-label-2">{count ? t('categories.usage', { count }) : t('categories.noUsage')}</span>
        </span>
        {monthTotal > 0 && (
          <span className="shrink-0 text-right">
            <span className="block text-[12px] text-label-3 capitalize">{monthLabel}</span>
            <Amount cents={monthTotal} className="text-[14px] font-semibold" />
          </span>
        )}
      </button>
      <Menu>
        <MenuButton
          className="grid size-8 shrink-0 place-items-center rounded-full text-label-3 transition-colors hover:bg-fill hover:text-label data-open:bg-fill"
          aria-label={t('common.more')}
        >
          <LuEllipsis className="size-4" aria-hidden />
        </MenuButton>
        <MenuItems anchor="bottom end" transition className={menuPanel}>
          <MenuItem>
            <button type="button" className={menuItem} onClick={onEdit}>
              <LuPencil className="size-4" aria-hidden />
              {t('common.edit')}
            </button>
          </MenuItem>
          {count > 0 && (
            <MenuItem>
              <button
                type="button"
                className={menuItem}
                onClick={() => navigate('/transactions', { kind: category.kind, category: category.id })}
              >
                <LuListOrdered className="size-4" aria-hidden />
                {t('categories.viewEntries')}
              </button>
            </MenuItem>
          )}
          <MenuItem>
            <button type="button" className={cn(menuItem, 'text-expense data-focus:bg-expense')} onClick={onDelete}>
              <LuTrash2 className="size-4" aria-hidden />
              {t('common.delete')}
            </button>
          </MenuItem>
        </MenuItems>
      </Menu>
    </li>
  )
}
