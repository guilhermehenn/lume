// Mensagens de erro das telas de entrada, a partir do código que o servidor devolve.

import { ApiError } from '../../api/client'
import type { TKey } from '../../i18n'

type T = (key: TKey, params?: Record<string, string | number>) => string

export function gateError(err: unknown, t: T): string {
  if (!(err instanceof ApiError)) return t('gate.errors.generic')
  switch (err.code) {
    case 'bad-credentials':
      return t('gate.errors.badCredentials')
    case 'bad-recovery':
      return t('gate.errors.badRecovery')
    case 'throttled':
      return t('gate.errors.throttled', { seconds: err.retryAfter ?? 30 })
    case 'not-found':
      return t('gate.errors.notFound')
    case 'too-new':
      return t('gate.errors.tooNew')
    case 'unreadable':
    case 'corrupted':
      return t('gate.errors.unreadable')
    case 'storage':
      return t('gate.errors.storage')
    default:
      return err.status === 0 ? t('gate.offlineTitle') : t('gate.errors.generic')
  }
}
