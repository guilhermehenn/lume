// Data de hoje e período do dia que se atualizam sozinhos: com o app aberto de um dia para o
// outro (ou da manhã para a tarde), o Início troca a saudação, a data e o mês do resumo.

import { useEffect, useState } from 'react'
import { todayISO, type ISODate } from './dates'

export type DayPart = 'morning' | 'afternoon' | 'evening'

export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  return 'evening'
}

function read(): string {
  const now = new Date()
  return `${todayISO(now)}|${dayPart(now.getHours())}`
}

export function useToday(): { today: ISODate; part: DayPart } {
  // Um texto só: o React não redesenha quando nada mudou.
  const [key, setKey] = useState(read)
  useEffect(() => {
    const update = () => setKey(read())
    const timer = window.setInterval(update, 30_000)
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('focus', update)
    }
  }, [])
  const [today, part] = key.split('|') as [ISODate, DayPart]
  return { today, part }
}
