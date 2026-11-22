// Períodos dos relatórios ("Este mês", "Últimos 3 meses"…), sem React: usados pela tela, pelo
// modelo dos relatórios salvos e pelos testes.

import { addMonths, currentMonth, lastMonths, monthRange, todayISO, yearRange, type ISODate, type MonthKey } from './dates'

export type PeriodPreset = 'thisMonth' | 'lastMonth' | 'last3' | 'last12' | 'thisYear' | 'lastYear' | 'custom'
export const PERIOD_PRESETS: PeriodPreset[] = ['thisMonth', 'lastMonth', 'last3', 'last12', 'thisYear', 'lastYear', 'custom']

export interface Period {
  preset: PeriodPreset
  from: ISODate
  to: ISODate
}

export function periodFor(preset: PeriodPreset, now = new Date(), custom?: { from: ISODate; to: ISODate }): Period {
  const month = currentMonth(now)
  const year = now.getFullYear()
  switch (preset) {
    case 'thisMonth':
      return { preset, ...monthRange(month) }
    case 'lastMonth':
      return { preset, ...monthRange(addMonths(month, -1)) }
    case 'last3': {
      const months = lastMonths(3, month)
      return { preset, from: monthRange(months[0]).from, to: monthRange(month).to }
    }
    case 'last12': {
      const months = lastMonths(12, month)
      return { preset, from: monthRange(months[0]).from, to: monthRange(month).to }
    }
    case 'thisYear':
      return { preset, ...yearRange(year) }
    case 'lastYear':
      return { preset, ...yearRange(year - 1) }
    case 'custom':
      return { preset, from: custom?.from ?? monthRange(month).from, to: custom?.to ?? todayISO(now) }
  }
}

/**
 * Meses (AAAA-MM) cobertos por um período, em ordem. Sem teto: quem desenha um gráfico escolhe
 * quantos mostrar (antes o teto de 36 cortava os meses mais recentes e distorcia as médias).
 */
export function monthsBetween(from: ISODate, to: ISODate): MonthKey[] {
  const out: MonthKey[] = []
  let m = from.slice(0, 7)
  const end = to.slice(0, 7)
  while (m <= end) {
    out.push(m)
    m = addMonths(m, 1)
  }
  return out
}

/**
 * Período de um relatório salvo: o relativo ("Este mês") é recalculado para hoje; datas fixas
 * valem como estão. Relatórios de antes da v0.3.8 não têm `preset` e abrem com as datas salvas.
 */
export function reportPeriod(filters: { preset?: PeriodPreset; from?: ISODate; to?: ISODate }, now = new Date()): Period | null {
  if (filters.preset && filters.preset !== 'custom') return periodFor(filters.preset, now)
  if (filters.from && filters.to) return { preset: 'custom', from: filters.from, to: filters.to }
  return null
}
