import { formatNumber } from './money'

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // O navegador lê o arquivo depois do clique; com arquivos grandes, 2 s às vezes não bastavam.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function downloadText(text: string, filename: string, type: string): void {
  downloadBlob(new Blob([text], { type }), filename)
}

/** Tamanho de arquivo para mensagens: "23,4 MB", "820 KB". */
export function formatFileSize(bytes: number, locale: string): string {
  if (bytes < 1024 * 1024) return `${formatNumber(Math.max(1, Math.round(bytes / 1024)), locale, 0)} KB`
  return `${formatNumber(bytes / (1024 * 1024), locale, 1)} MB`
}
