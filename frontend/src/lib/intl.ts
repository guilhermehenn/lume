// Formatadores do Intl guardados para reaproveitar. Criar um Intl.DateTimeFormat custa caro
// (dezenas de microssegundos); a exportação formata centenas de milhares de datas e valores.

const formatters = new Map<string, unknown>()

/** O formatador de `key` (ex.: "date|pt-BR|short"), criado na primeira vez por `make`. */
export function cachedFormatter<T>(key: string, make: () => T): T {
  let formatter = formatters.get(key) as T | undefined
  if (formatter === undefined) {
    formatter = make()
    formatters.set(key, formatter)
  }
  return formatter
}
