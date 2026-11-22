// Texto para comparar e buscar: sem acento, sem diferença de maiúsculas e com espaços simples.

/** Sem acentos, minúsculas e espaços simples: "Café  Bom" e "cafe bom" são iguais. */
export function normalize(text: string): string {
  // Texto só com ASCII (a maioria) não precisa da decomposição Unicode, que é a parte cara.
  const plain = /[^\x00-\x7f]/.test(text) ? text.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : text
  return plain.toLowerCase().replace(/\s+/g, ' ')
}
