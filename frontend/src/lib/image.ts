// Foto de perfil: recorta no centro, reduz para 256×256 e devolve um JPEG em data URL (bem menor que o limite de 300 KB).

async function decode(file: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file)
  // Alternativa: data URL (a CSP permite img-src data:, mas não blob:).
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
  const img = new Image()
  img.src = url
  await img.decode()
  return img
}

export async function resizePhoto(file: Blob, size = 256): Promise<string> {
  if (!/^image\/(jpeg|png|webp|gif|bmp)$/.test(file.type)) throw new Error('type')
  if (file.size > 25 * 1024 * 1024) throw new Error('size')
  const source = await decode(file)
  const side = Math.min(source.width, source.height)
  if (!side) throw new Error('empty')
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  ctx.drawImage(source, (source.width - side) / 2, (source.height - side) / 2, side, side, 0, 0, size, size)
  if ('close' in source && typeof source.close === 'function') source.close()
  return canvas.toDataURL('image/jpeg', 0.86)
}
