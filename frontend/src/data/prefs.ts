// O pouco que fica no navegador desde a v0.3: idioma e tema para as telas antes de entrar,
// o último e-mail usado em cada cofre e os dados antigos (v0.2) para importar num cofre novo.

import { newId } from '../lib/ids'
import { parseData, parseSettings } from './backup'
import type { DataState, Language, Settings, Theme } from './types'

const PREFS_KEY = 'lume.prefs.v1'
const LAST_EMAIL_PREFIX = 'lume.lastEmail.'
/** Onde a v0.2 guardava tudo. Nunca é apagado pelo app. */
export const LEGACY_DATA_KEY = 'lume.data.v1'
export const LEGACY_SETTINGS_KEY = 'lume.settings.v1'
const LEGACY_IMPORTED_KEY = 'lume.data.v1.importedTo'
/** Cópias que a v0.2 guardava quando não conseguia ler os dados. */
const LEGACY_CORRUPT_PREFIX = 'lume.data.corrupt.'

function storage(): Storage | null {
  try {
    // Só no navegador: no Node (testes), só olhar para `localStorage` já gera um aviso.
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function read(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    storage()?.setItem(key, value)
  } catch {
    /* sem espaço ou bloqueado: são só conveniências */
  }
}

export function detectLanguage(): Language {
  const lang = (typeof navigator !== 'undefined' ? navigator.language : 'pt').slice(0, 2).toLowerCase()
  return lang === 'en' ? 'en' : lang === 'es' ? 'es' : 'pt'
}

export interface LocalPrefs {
  language: Language
  theme: Theme
}

export function readPrefs(): LocalPrefs {
  const fallback: LocalPrefs = { language: detectLanguage(), theme: 'dark' }
  const legacy = read(LEGACY_SETTINGS_KEY)
  const raw = read(PREFS_KEY) ?? legacy
  if (!raw) return fallback
  try {
    const value = JSON.parse(raw) as Partial<LocalPrefs>
    return {
      language: value.language === 'pt' || value.language === 'en' || value.language === 'es' ? value.language : fallback.language,
      theme: value.theme === 'dark' || value.theme === 'light' || value.theme === 'system' ? value.theme : fallback.theme,
    }
  } catch {
    return fallback
  }
}

export function writePrefs(prefs: LocalPrefs): void {
  write(PREFS_KEY, JSON.stringify(prefs))
}

export function lastEmail(vaultId: string): string {
  return read(LAST_EMAIL_PREFIX + vaultId) ?? ''
}

export function rememberEmail(vaultId: string, email: string): void {
  write(LAST_EMAIL_PREFIX + vaultId, email)
}

export interface LegacyData {
  data: DataState
  settings: Partial<Settings> & { name?: string }
  entries: number
  /** Id do cofre para onde já foi importado (se foi). */
  importedTo: string | null
}

type Loose = Record<string, unknown>

/**
 * Conserta dados da v0.2 afetados por um erro: bancos criados pela tela ficavam sem id (e os
 * lançamentos neles, sem banco). O app antigo então não conseguia mais ler os dados e guardava
 * uma cópia à parte. Aqui os bancos ganham id e os lançamentos órfãos vão para o primeiro deles.
 */
export function repairLegacy(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as Loose).banks)) return raw
  const data = JSON.parse(JSON.stringify(raw)) as { banks: Loose[]; transactions?: Loose[]; investments?: Loose[] }
  const missing = data.banks.filter((b) => b && typeof b === 'object' && typeof b.id !== 'string')
  if (missing.length === 0) return raw
  for (const bank of missing) bank.id = newId()
  const target = missing[0].id
  for (const list of [data.transactions ?? [], data.investments ?? []]) {
    for (const item of list) if (item && typeof item === 'object' && typeof item.bankId !== 'string') item.bankId = target
  }
  return data
}

function parseLegacy(text: string | null): DataState | null {
  if (!text) return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  try {
    return parseData(raw)
  } catch {
    try {
      return parseData(repairLegacy(raw))
    } catch {
      return null
    }
  }
}

function legacyCandidates(): string[] {
  const keys: string[] = []
  try {
    const ls = storage()
    if (!ls) return keys
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i)
      if (key?.startsWith(LEGACY_CORRUPT_PREFIX)) keys.push(key)
    }
  } catch {
    /* sem acesso */
  }
  // a mais recente primeiro
  return [LEGACY_DATA_KEY, ...keys.sort((a, b) => Number(b.slice(LEGACY_CORRUPT_PREFIX.length)) - Number(a.slice(LEGACY_CORRUPT_PREFIX.length)))]
}

/**
 * Dados da v0.2 neste navegador, se houver. Entre os dados atuais e as cópias guardadas pela v0.2,
 * fica com a que tem mais lançamentos (em empate, a atual).
 */
export function readLegacy(): LegacyData | null {
  let best: { data: DataState; entries: number } | null = null
  for (const key of legacyCandidates()) {
    const data = parseLegacy(read(key))
    if (!data) continue
    const entries = data.transactions.length + data.investments.length
    if (!best || entries > best.entries) best = { data, entries }
  }
  if (!best) return null
  const { data, entries } = best
  let settings: LegacyData['settings'] = {}
  const rawSettings = read(LEGACY_SETTINGS_KEY)
  if (rawSettings) {
    try {
      const parsed = JSON.parse(rawSettings) as { name?: unknown }
      settings = parseSettings(parsed, {} as Settings)
      if (typeof parsed.name === 'string') settings.name = parsed.name.slice(0, 40)
    } catch {
      /* configurações ilegíveis: importa só os dados */
    }
  }
  return { data, settings, entries, importedTo: read(LEGACY_IMPORTED_KEY) }
}

export function markLegacyImported(vaultId: string): void {
  write(LEGACY_IMPORTED_KEY, vaultId)
}
