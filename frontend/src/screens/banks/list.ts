// Regras da lista de bancos: busca sem acento (ou pelo código), ordem e o que está em uso.
// Sem React, para testar direto.

import type { Bank, ID } from '../../data/types'
import { normalize } from '../../lib/text'

/** Em uso: principal, com saldo inicial ou com lançamentos. Os outros ficam recolhidos. */
export function isBankInUse(bank: Bank, count: number): boolean {
  return bank.isPrimary || bank.initialBalance !== 0 || count > 0
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/**
 * Bancos que batem com a busca (já normalizada), em ordem: o principal, depois os mais usados,
 * depois pelo nome. A busca acha "itau" em "Itaú" e "341" pelo código.
 */
export function listBanks(banks: Bank[], usage: Map<ID, number>, query: string): Bank[] {
  const found = query ? banks.filter((b) => normalize(b.name).includes(query) || (b.code ?? '').includes(query)) : [...banks]
  return found.sort(
    (a, b) => Number(b.isPrimary) - Number(a.isPrimary) || (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) || collator.compare(a.name, b.name),
  )
}

/** Separa a lista entre bancos em uso e sem uso, mantendo a ordem. */
export function splitByUse(banks: Bank[], usage: Map<ID, number>): { used: Bank[]; unused: Bank[] } {
  const used: Bank[] = []
  const unused: Bank[] = []
  for (const b of banks) (isBankInUse(b, usage.get(b.id) ?? 0) ? used : unused).push(b)
  return { used, unused }
}
