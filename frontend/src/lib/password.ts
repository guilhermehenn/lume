// Regras da senha do cofre (as mesmas do back-end) e um medidor simples de força.

export type PasswordProblem = 'short' | 'long' | 'spaces'

export function passwordProblem(password: string): PasswordProblem | null {
  if (password.length < 8) return 'short'
  if (password.length > 200) return 'long'
  if (password !== password.trim()) return 'spaces'
  return null
}

/** 0 fraca · 1 razoável · 2 boa · 3 forte. Comprimento pesa mais que variedade. */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 {
  if (passwordProblem(password)) return 0
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length
  const unique = new Set(password.toLowerCase()).size
  if (unique < 4) return 0
  let score = password.length >= 16 ? 2 : password.length >= 12 ? 1 : 0
  if (kinds >= 3) score += 1
  if (password.includes(' ') && password.length >= 14) score += 1
  return Math.max(1, Math.min(3, score)) as 1 | 2 | 3
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()) && email.trim().length <= 254
}

const COMMON_DOMAINS = [
  'gmail.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.com.br',
  'icloud.com',
  'me.com',
  'uol.com.br',
  'bol.com.br',
  'terra.com.br',
  'proton.me',
  'protonmail.com',
]

/** Distância de edição com troca de letras vizinhas (gmial → gmail = 1). */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

/** "gui@gmial.com" → "gui@gmail.com". Só para domínios muito usados e erros pequenos. */
export function suggestEmail(email: string): string | null {
  const clean = email.trim()
  const at = clean.lastIndexOf('@')
  if (at < 1) return null
  const domain = clean.slice(at + 1).toLowerCase()
  if (domain.length < 4 || COMMON_DOMAINS.includes(domain)) return null
  let best: string | null = null
  let bestScore = 3
  for (const known of COMMON_DOMAINS) {
    const score = distance(domain, known)
    if (score < bestScore) {
      best = known
      bestScore = score
    }
  }
  return best ? `${clean.slice(0, at)}@${best}` : null
}
