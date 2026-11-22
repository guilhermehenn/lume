// Opções de banco e categoria para os seletores (lançamento, relatórios, Início, categorias).

import { categoriesByName } from '../../data/selectors'
import type { DataState, Kind } from '../../data/types'
import type { I18n } from '../../i18n'
import { BankAvatar, CategoryIcon } from '../../ui/display'
import type { SelectOption } from '../../ui/inputs'

/** Banco principal primeiro, depois em ordem alfabética. */
export function bankOptions(data: DataState): SelectOption<string>[] {
  return [...data.banks]
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name))
    .map((b) => ({ value: b.id, label: b.name, icon: <BankAvatar name={b.name} color={b.color} size="sm" /> }))
}

/** Categorias do tipo, em ordem alfabética, com as "Outras …" no fim. */
export function categoryOptions(data: DataState, kind: Kind, i18n: I18n): SelectOption<string>[] {
  return categoriesByName(data.categories, kind, i18n.categoryName, i18n.locale).map(({ category: c, name }) => ({
    value: c.id,
    label: name,
    icon: <CategoryIcon icon={c.icon} color={c.color} size="sm" />,
  }))
}
