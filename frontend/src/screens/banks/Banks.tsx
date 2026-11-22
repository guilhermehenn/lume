// Bancos: saldo de hoje (e o previsto), lista com o principal e os mais usados primeiro, bancos
// sem uso recolhidos, busca sem acento ou pelo código, cadastro e exclusão com junção.

import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { useMemo, useState } from 'react'
import { LuChevronDown, LuEllipsis, LuLandmark, LuListOrdered, LuPencil, LuPlus, LuStar, LuTrash2 } from 'react-icons/lu'
import { navigate } from '../../app/router'
import { cn } from '../../lib/cn'
import { normalize } from '../../lib/text'
import { useToday } from '../../lib/useToday'
import { balanceOverview, bankUsageCounts } from '../../data/selectors'
import { actions, useData } from '../../data/store'
import type { Bank } from '../../data/types'
import { useI18n } from '../../i18n'
import { Amount, BankAvatar } from '../../ui/display'
import { Badge, Button, Card, EmptyState, PageHeader, SearchField } from '../../ui/primitives'
import { toast } from '../../ui/toast'
import { BankSheet } from './BankSheet'
import { DeleteBankDialog } from './DeleteBankDialog'
import { listBanks, splitByUse } from './list'

const menuPanel =
  'glass z-[70] min-w-52 rounded-xl p-1 shadow-[0_16px_48px_rgba(0,0,0,0.35)] ring-1 ring-sep/60 [--anchor-gap:6px] origin-top-right transition duration-200 ease-apple outline-none data-closed:scale-95 data-closed:opacity-0'
const menuItem = 'flex w-full items-center gap-3 rounded-[9px] px-3 py-2 text-[15px] data-focus:bg-accent data-focus:text-white'

export function Banks() {
  const data = useData()
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [showUnused, setShowUnused] = useState(false)
  const [editing, setEditing] = useState<{ bank?: Bank; seq: number } | null>(null)
  const [deleting, setDeleting] = useState<Bank | null>(null)
  const { today } = useToday()
  // Mesmo saldo do Início: até hoje, com o previsto quando há lançamentos futuros.
  const overview = useMemo(() => balanceOverview(data, today), [data, today])
  const { transactions, investments } = data
  const usage = useMemo(() => bankUsageCounts({ transactions, investments }), [transactions, investments])
  const q = normalize(query.trim())
  const list = useMemo(() => listBanks(data.banks, usage, q), [data.banks, usage, q])
  const { used, unused } = useMemo(() => splitByUse(list, usage), [list, usage])
  const total = overview.total

  const togglePrimary = (bank: Bank) => {
    actions.setPrimaryBank(bank.isPrimary ? null : bank.id)
    if (!bank.isPrimary) toast(t('banks.primarySet', { name: bank.name }))
  }
  const row = (bank: Bank, i: number) => (
    <BankRow
      key={bank.id}
      bank={bank}
      index={i}
      balance={overview.byBank.get(bank.id) ?? 0}
      count={usage.get(bank.id) ?? 0}
      onEdit={() => setEditing({ bank, seq: Date.now() })}
      onTogglePrimary={() => togglePrimary(bank)}
      onDelete={() => setDeleting(bank)}
    />
  )
  // Na busca, e num cofre sem nada em uso ainda, a lista vai inteira; senão, os sem uso ficam
  // recolhidos embaixo.
  const flat = q !== '' || used.length === 0

  return (
    <div>
      <PageHeader
        title={t('banks.title')}
        subtitle={t('banks.subtitle')}
        actions={
          <Button variant="primary" onClick={() => setEditing({ seq: Date.now() })}>
            <LuPlus className="size-4" aria-hidden />
            {t('banks.add')}
          </Button>
        }
      />

      <div className="fx-rise mb-4 flex flex-wrap items-center gap-3" style={{ animationDelay: '40ms' }}>
        <Card className="flex items-center gap-4 px-6 py-3.5">
          <div>
            <p className="text-[13px] font-medium text-label-2">{t('home.totalBalance')}</p>
            <Amount cents={total} animate className={cn('text-[24px] font-bold tracking-[-0.02em]', total < 0 && 'text-expense')} />
            {overview.futureCount > 0 && overview.projected !== total && (
              <p className="text-[12.5px] text-label-2">
                {t('home.projected')} <Amount cents={overview.projected} className={cn('font-semibold text-label', overview.projected < 0 && 'text-expense')} />
              </p>
            )}
          </div>
        </Card>
        <SearchField value={query} onChange={setQuery} placeholder={t('banks.searchPlaceholder')} className="ml-auto w-full sm:w-64" />
      </div>

      {list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<LuLandmark />}
            title={q ? t('common.noResults') : t('banks.empty')}
            action={
              q ? (
                <Button onClick={() => setQuery('')}>{t('banks.clearSearch')}</Button>
              ) : (
                <Button variant="primary" onClick={() => setEditing({ seq: Date.now() })}>
                  <LuPlus className="size-4" aria-hidden />
                  {t('banks.add')}
                </Button>
              )
            }
          />
        </Card>
      ) : flat ? (
        <section className="fx-rise" style={{ animationDelay: '80ms' }} aria-label={t('banks.title')}>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-sep/50">{list.map(row)}</ul>
          </Card>
        </section>
      ) : (
        <div className="space-y-5">
          <section className="fx-rise" style={{ animationDelay: '80ms' }} aria-labelledby="banks-used">
            <h2 id="banks-used" className="mb-2 px-1 text-[13px] font-medium tracking-wide text-label-2 uppercase">
              {t('banks.inUseTitle')}
            </h2>
            <Card className="overflow-hidden">
              <ul className="divide-y divide-sep/50">{used.map(row)}</ul>
            </Card>
          </section>
          {unused.length > 0 && (
            <section className="fx-rise" style={{ animationDelay: '140ms' }} aria-labelledby={showUnused ? 'banks-unused' : undefined}>
              <button
                type="button"
                aria-expanded={showUnused}
                aria-controls="banks-unused-list"
                onClick={() => setShowUnused((v) => !v)}
                className="mb-2 flex items-center gap-1.5 rounded-lg px-1 text-[13.5px] font-medium text-accent hover:underline"
              >
                <LuChevronDown className={cn('size-4 transition-transform duration-300 ease-apple', showUnused && 'rotate-180')} aria-hidden />
                {showUnused ? t('banks.hideUnused') : t('banks.showUnused', { count: unused.length })}
              </button>
              {showUnused && (
                <div id="banks-unused-list" className="fx-fade">
                  <h2 id="banks-unused" className="sr-only">
                    {t('banks.unusedTitle')}
                  </h2>
                  <Card className="overflow-hidden bg-surface/60">
                    <ul className="divide-y divide-sep/50">{unused.map(row)}</ul>
                  </Card>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {editing && <BankSheet key={editing.seq} bank={editing.bank} onClose={() => setEditing(null)} onDelete={(b) => setDeleting(b)} />}
      <DeleteBankDialog bank={deleting} count={deleting ? (usage.get(deleting.id) ?? 0) : 0} onClose={() => setDeleting(null)} onDeleted={() => setEditing(null)} />
    </div>
  )
}

function BankRow({
  bank,
  balance,
  count,
  index,
  onEdit,
  onTogglePrimary,
  onDelete,
}: {
  bank: Bank
  balance: number
  count: number
  index: number
  onEdit: () => void
  onTogglePrimary: () => void
  onDelete: () => void
}) {
  const { t } = useI18n()
  return (
    <li className="fx-rise group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-fill-2/60" style={{ animationDelay: `${100 + Math.min(index, 14) * 20}ms` }}>
      <button type="button" onClick={onEdit} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <BankAvatar name={bank.name} color={bank.color} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[15.5px] font-medium">{bank.name}</span>
            {bank.isPrimary && (
              // No celular, só a estrela: o nome do banco não pode sumir atrás do selo.
              <Badge className="shrink-0 bg-gold/15 text-gold">
                <LuStar className="size-3 fill-current" aria-hidden />
                <span className="max-sm:sr-only">{t('banks.primary')}</span>
              </Badge>
            )}
          </span>
          {/* No celular cabe só o uso (o que mais importa); tipo e código aparecem a partir do tablet. */}
          <span className="block truncate text-[13px] text-label-2">
            <span className="max-sm:hidden">{t(`bankKinds.${bank.kind}`)} · </span>
            {count ? t('banks.usage', { count }) : t('banks.noUsage')}
            {bank.code && <span className="max-sm:hidden"> · {t('banks.codeShort', { code: bank.code })}</span>}
          </span>
        </span>
        <Amount cents={balance} className={cn('shrink-0 text-[15.5px] font-semibold', balance < 0 && 'text-expense', balance === 0 && 'text-label-3')} />
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
              <button type="button" className={menuItem} onClick={() => navigate('/transactions', { bank: bank.id })}>
                <LuListOrdered className="size-4" aria-hidden />
                {t('banks.viewEntries')}
              </button>
            </MenuItem>
          )}
          <MenuItem>
            <button type="button" className={menuItem} onClick={onTogglePrimary}>
              <LuStar className="size-4" aria-hidden />
              {bank.isPrimary ? t('banks.unsetPrimary') : t('banks.setPrimary')}
            </button>
          </MenuItem>
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
