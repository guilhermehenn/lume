// Lista de cofres da tela de entrada.

import { LuChevronRight, LuPlus, LuSparkles, LuTriangleAlert } from 'react-icons/lu'
import type { VaultSummary } from '../../api/vault'
import { useI18n, type TKey } from '../../i18n'
import { cn } from '../../lib/cn'
import { Avatar, initialsOf } from '../../ui/Avatar'

export function VaultList({ vaults, onPick, onCreate }: { vaults: VaultSummary[]; onPick: (vault: VaultSummary) => void; onCreate: () => void }) {
  const i18n = useI18n()
  const { t } = i18n
  return (
    <section className="w-full" aria-labelledby="gate-title">
      <header className="fx-rise mb-7 text-center">
        <h1 id="gate-title" className="text-[32px] font-bold tracking-[-0.025em]">
          {t('gate.title')}
        </h1>
        <p className="mx-auto mt-2 max-w-lg text-[16px] text-label-2">{t('gate.subtitle')}</p>
      </header>
      <ul className="grid gap-3 sm:grid-cols-2">
        {vaults.map((vault, i) => {
          const blocked = vault.status === 'error' || vault.status === 'too-new'
          const owner = `${vault.ownerFirstName} ${vault.ownerLastName}`.trim()
          return (
            <li key={vault.id} className="fx-rise" style={{ animationDelay: `${60 + Math.min(i, 8) * 40}ms` }}>
              <button
                type="button"
                onClick={() => onPick(vault)}
                disabled={blocked}
                className="group flex h-full w-full items-center gap-4 rounded-[20px] bg-surface p-5 text-left shadow-card ring-1 ring-sep/50 transition-[transform,box-shadow,background-color] duration-200 ease-apple hover:-translate-y-0.5 hover:ring-accent/50 active:scale-[0.985] disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:ring-sep/50"
              >
                <Avatar photo={vault.photo} initials={vault.initials || initialsOf(vault.ownerFirstName, vault.ownerLastName)} size="lg" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[18px] font-semibold tracking-tight">{vault.name}</span>
                  <span className="block truncate text-[14.5px] text-label-2">{owner || vault.emailHint}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-label-3">
                    <span>{t('gate.entries', { count: vault.entries })}</span>
                    <span aria-hidden>·</span>
                    <span>{vault.lastOpenedAt ? t('gate.lastOpened', { when: i18n.relative(vault.lastOpenedAt) }) : t('gate.neverOpened')}</span>
                  </span>
                  {vault.status !== 'ok' && (
                    <span className={cn('mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12.5px] font-medium', blocked ? 'bg-expense/15 text-expense' : 'bg-accent/15 text-accent')}>
                      {blocked ? <LuTriangleAlert className="size-3.5" aria-hidden /> : <LuSparkles className="size-3.5" aria-hidden />}
                      {t(`gate.status.${vault.status}` as TKey)}
                    </span>
                  )}
                  {vault.status === 'error' && <span className="mt-1 block text-[12.5px] text-label-3">{t('gate.damagedHint')}</span>}
                </span>
                {!blocked && <LuChevronRight className="size-5 shrink-0 text-label-3 transition-transform group-hover:translate-x-0.5 group-hover:text-label-2" aria-hidden />}
              </button>
            </li>
          )
        })}
        <li className="fx-rise" style={{ animationDelay: `${60 + Math.min(vaults.length, 8) * 40}ms` }}>
          <button
            type="button"
            onClick={onCreate}
            className="group flex h-full min-h-[104px] w-full items-center gap-4 rounded-[20px] border-[1.5px] border-dashed border-sep p-5 text-left transition-colors duration-200 hover:border-accent/60 hover:bg-fill-2"
          >
            <span className="grid size-14 place-items-center rounded-full bg-accent/15 text-accent transition-transform group-hover:scale-105">
              <LuPlus className="size-6" strokeWidth={2.4} aria-hidden />
            </span>
            <span>
              <span className="block text-[17px] font-semibold tracking-tight">{t('gate.create')}</span>
              <span className="block text-[14px] text-label-2">{t('gate.createHint')}</span>
            </span>
          </button>
        </li>
      </ul>
    </section>
  )
}
