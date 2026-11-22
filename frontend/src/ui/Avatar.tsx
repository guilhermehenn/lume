// Foto de perfil ou iniciais, em círculo.

import { cn } from '../lib/cn'

const SIZES = { sm: 'size-8 text-[13px]', md: 'size-10 text-[15px]', lg: 'size-14 text-[19px]', xl: 'size-24 text-[32px]' }

export function initialsOf(first: string, last = ''): string {
  const a = first.trim()[0] ?? ''
  const b = last.trim()[0] ?? first.trim().split(/\s+/)[1]?.[0] ?? ''
  return (a + b).toUpperCase() || '?'
}

export function Avatar({ photo, initials, size = 'md', className }: { photo?: string | null; initials: string; size?: keyof typeof SIZES; className?: string }) {
  return (
    <span
      className={cn(
        'relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-[linear-gradient(145deg,#64D2FF,#0A84FF_55%,#5E5CE6)] font-semibold tracking-tight text-white ring-1 ring-black/10 select-none dark:ring-white/10',
        SIZES[size],
        className,
      )}
      aria-hidden
    >
      {photo ? <img src={photo} alt="" className="size-full object-cover" draggable={false} /> : initials}
    </span>
  )
}
