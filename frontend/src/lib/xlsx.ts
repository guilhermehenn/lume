// Gerador mínimo de planilhas .xlsx (Office Open XML) usando JSZip.
// Abre no Excel, LibreOffice, Numbers e Google Planilhas.

import JSZip from 'jszip'

export type XlsxColumnType = 'text' | 'money' | 'date' | 'number' | 'percent'

export interface XlsxColumn {
  header: string
  type?: XlsxColumnType
  width?: number
}

export type XlsxCell = string | number | boolean | null | undefined

export interface XlsxSheet {
  name: string
  columns: XlsxColumn[]
  rows: XlsxCell[][]
  /** Linha final em negrito (ex.: totais). */
  totalRow?: XlsxCell[]
  /** Aba de texto (ex.: instruções): sem filtro no cabeçalho. */
  plain?: boolean
}

const STYLE = { header: 1, money: 2, date: 3, percent: 4, bold: 5, boldMoney: 6 } as const

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// Caracteres que precisam de troca no XML (controle inválido some; &, <, > e " viram entidades).
const XML_SPECIAL = /[&<>"\u0000-\u0008\u000B\u000C\u000E-\u001F]/
const XML_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g

function escapeXml(text: string): string {
  // A maioria dos textos não tem nada para trocar: sai sem passar pelas cinco substituições.
  if (!XML_SPECIAL.test(text)) return text
  return text
    .replace(XML_CONTROL, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function columnLetter(index: number): string {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

/** Data AAAA-MM-DD para o número serial de data do Excel (1 = 01/01/1900). */
export function excelSerial(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number)
  const serial = Date.UTC(y, m - 1, d) / 86_400_000 + 25_569
  // O Excel conta um 29/02/1900 que não existiu (herança do Lotus 1-2-3): antes de 01/03/1900 a
  // conta acima dá um dia a mais do que ele mostra.
  return serial < 61 ? serial - 1 : serial
}

export function safeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Planilha'
  let candidate = base
  let i = 2
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${i++})`
    candidate = base.slice(0, 31 - suffix.length) + suffix
  }
  used.add(candidate.toLowerCase())
  base = candidate
  return base
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function cellXml(ref: string, value: XlsxCell, type: XlsxColumnType, bold: boolean): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'boolean') value = value ? '✓' : ''
  if (type === 'money' && typeof value === 'number') {
    return `<c r="${ref}" s="${bold ? STYLE.boldMoney : STYLE.money}"><v>${(value / 100).toFixed(2)}</v></c>`
  }
  if (type === 'date' && typeof value === 'string' && ISO_DATE.test(value)) {
    return `<c r="${ref}" s="${STYLE.date}"><v>${excelSerial(value)}</v></c>`
  }
  if (type === 'percent' && typeof value === 'number') {
    return `<c r="${ref}" s="${STYLE.percent}"><v>${value / 100}</v></c>`
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"${bold ? ` s="${STYLE.bold}"` : ''}><v>${value}</v></c>`
  }
  const text = escapeXml(String(value))
  return `<c r="${ref}" t="inlineStr"${bold ? ` s="${STYLE.bold}"` : ''}><is><t xml:space="preserve">${text}</t></is></c>`
}

function sheetXml(sheet: XlsxSheet): string {
  const cols = sheet.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 16}" customWidth="1"/>`)
    .join('')
  const header = sheet.columns
    .map((c, i) => `<c r="${columnLetter(i)}1" t="inlineStr" s="${STYLE.header}"><is><t xml:space="preserve">${escapeXml(c.header)}</t></is></c>`)
    .join('')
  const rows: string[] = [`<row r="1">${header}</row>`]
  const allRows = sheet.totalRow ? [...sheet.rows, sheet.totalRow] : sheet.rows
  // Letras e tipos das colunas calculados uma vez (antes: a cada célula).
  const letters = sheet.columns.map((_, i) => columnLetter(i))
  const types = sheet.columns.map((c) => c.type ?? 'text')
  allRows.forEach((row, r) => {
    const bold = Boolean(sheet.totalRow) && r === allRows.length - 1
    const line = r + 2
    let cells = ''
    for (let i = 0; i < letters.length; i++) cells += cellXml(`${letters[i]}${line}`, row[i], types[i], bold)
    rows.push(`<row r="${line}">${cells}</row>`)
  })
  const lastCol = columnLetter(Math.max(0, sheet.columns.length - 1))
  const lastRow = Math.max(1, sheet.rows.length + 1)
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols>` +
    `<sheetData>${rows.join('')}</sheetData>` +
    (sheet.rows.length && !sheet.plain ? `<autoFilter ref="A1:${lastCol}${lastRow}"/>` : '') +
    `</worksheet>`
  )
}

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="${MAIN_NS}">` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FFEDEDF2"/><bgColor indexed="64"/></patternFill></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="7">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
  `<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`

export function buildXlsxZip(sheets: XlsxSheet[]): JSZip {
  if (sheets.length === 0) throw new Error('Planilha sem abas')
  const zip = new JSZip()
  const used = new Set<string>()
  const names = sheets.map((s) => safeSheetName(s.name, used))

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      sheets
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join('') +
      `</Types>`,
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  )
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets>` +
      names.map((n, i) => `<sheet name="${escapeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      `</sheets></workbook>`,
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="${PKG_REL_NS}">` +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="${REL_NS}/styles" Target="styles.xml"/>` +
      `</Relationships>`,
  )
  zip.file('xl/styles.xml', STYLES_XML)
  sheets.forEach((sheet, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet)))
  return zip
}

export async function buildXlsx(sheets: XlsxSheet[]): Promise<Blob> {
  return buildXlsxZip(sheets).generateAsync({ type: 'blob', mimeType: XLSX_MIME, compression: 'DEFLATE' })
}
