/**
 * Lightweight, browser-local writer for Amazon's synthetic-performer XMP tag.
 *
 * The implementation only touches metadata containers. It never decodes or
 * re-encodes image pixels or audio/video streams.
 */

export const SYNTHETIC_PERFORMER_KEYWORD = 'contains-synthetic-performer'
export const MAX_SYNTHETIC_PERFORMER_FILE_BYTES = 500 * 1024 * 1024
export const MAX_SYNTHETIC_PERFORMER_BATCH_BYTES = 1024 * 1024 * 1024

export const SYNTHETIC_PERFORMER_MEDIA_FORMATS = ['jpeg', 'png', 'webp', 'mp4', 'mov'] as const

export type SyntheticPerformerMediaFormat = (typeof SYNTHETIC_PERFORMER_MEDIA_FORMATS)[number]

export interface SyntheticPerformerVerification {
  valid: boolean
  keywordCount: number
  xmp?: string
  error?: string
}

export interface TaggedSyntheticPerformerMedia {
  format: SyntheticPerformerMediaFormat
  bytes: Uint8Array
  xmp: string
  verification: SyntheticPerformerVerification
}

export interface TaggedSyntheticPerformerFile extends TaggedSyntheticPerformerMedia {
  blob: Blob
}

export type SyntheticPerformerFileProcessingResult =
  | {
      kind: 'already-tagged'
      verification: SyntheticPerformerVerification
    }
  | {
      kind: 'tagged'
      output: TaggedSyntheticPerformerFile
    }

const FORMAT_BY_EXTENSION: Record<string, SyntheticPerformerMediaFormat> = {
  jpg: 'jpeg',
  jpeg: 'jpeg',
  png: 'png',
  webp: 'webp',
  mp4: 'mp4',
  mov: 'mov',
}

const MIME_BY_FORMAT: Record<SyntheticPerformerMediaFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
}

const UTF8 = new TextEncoder()
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })
const LATIN1 = new TextDecoder('latin1')

const RDF_NAMESPACE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const DC_NAMESPACE = 'http://purl.org/dc/elements/1.1/'
const ADOBE_XMP_SIGNATURE = UTF8.encode('http://ns.adobe.com/xap/1.0/\0')
const ADOBE_XMP_EXTENSION_SIGNATURE = UTF8.encode('http://ns.adobe.com/xmp/extension/\0')
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_XMP_KEYWORD = 'XML:com.adobe.xmp'
const ADOBE_XMP_UUID = new Uint8Array([
  0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac,
])

type JpegSegment = {
  marker: number
  start: number
  end: number
  payloadStart: number
}

type PngChunk = {
  type: string
  start: number
  dataStart: number
  dataEnd: number
  end: number
}

type WebpChunk = {
  fourcc: string
  data: Uint8Array
}

type IsoBox = {
  type: string
  start: number
  end: number
}

type XmpCarrier = {
  packet: string
  start: number
  end: number
  kind: 'jpeg' | 'png' | 'webp' | 'video'
}

function makeError(message: string): Error {
  return new Error(message)
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0)
  const output = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

function fourCc(bytes: Uint8Array, offset: number): string {
  if (offset + 4 > bytes.length) throw makeError('媒体文件结构不完整')
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
}

function ascii(value: string): Uint8Array {
  return UTF8.encode(value)
}

function bytesEqualAt(bytes: Uint8Array, value: Uint8Array, offset: number): boolean {
  if (offset < 0 || offset + value.length > bytes.length) return false
  for (let index = 0; index < value.length; index++) {
    if (bytes[offset + index] !== value[index]) return false
  }
  return true
}

function readU16BE(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.length) throw makeError('媒体文件结构不完整')
  return bytes[offset] * 0x100 + bytes[offset + 1]
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) throw makeError('媒体文件结构不完整')
  return bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3]
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) throw makeError('媒体文件结构不完整')
  return bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000 + bytes[offset + 3] * 0x1000000
}

function writeU32BE(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = Math.floor(value / 0x1000000) & 0xff
  bytes[offset + 1] = Math.floor(value / 0x10000) & 0xff
  bytes[offset + 2] = Math.floor(value / 0x100) & 0xff
  bytes[offset + 3] = value & 0xff
}

function writeU32LE(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = Math.floor(value / 0x100) & 0xff
  bytes[offset + 2] = Math.floor(value / 0x10000) & 0xff
  bytes[offset + 3] = Math.floor(value / 0x1000000) & 0xff
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function _escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function xmlText(value: string): string {
  const cdata = value.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/)
  const raw = cdata ? cdata[1] : value.replace(/<[^>]+>/g, '')
  return raw
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .trim()
}

function decodeXmp(bytes: Uint8Array): string {
  try {
    return UTF8_DECODER.decode(bytes)
  } catch {
    throw makeError('XMP 元数据不是有效的 UTF-8 文本')
  }
}

function getExtension(fileName: string): string {
  const normalized = fileName.trim().toLowerCase()
  const separator = normalized.lastIndexOf('.')
  return separator < 0 ? '' : normalized.slice(separator + 1)
}

export function getSyntheticPerformerMediaFormat(fileName: string): SyntheticPerformerMediaFormat | null {
  return FORMAT_BY_EXTENSION[getExtension(fileName)] ?? null
}

export function isSupportedSyntheticPerformerMedia(file: Pick<File, 'name'> | string): boolean {
  return getSyntheticPerformerMediaFormat(typeof file === 'string' ? file : file.name) != null
}

export function getSyntheticPerformerMediaMimeType(fileName: string): string | null {
  const format = getSyntheticPerformerMediaFormat(fileName)
  return format ? MIME_BY_FORMAT[format] : null
}

export function getSyntheticPerformerMediaValidationError(file: Pick<File, 'name' | 'size'>): string | null {
  if (!isSupportedSyntheticPerformerMedia(file))
    return `不支持「${file.name || '未命名文件'}」的格式，仅支持 JPG、PNG、WebP、MP4、MOV`
  if (file.size <= 0) return `「${file.name || '未命名文件'}」是空文件`
  if (file.size > MAX_SYNTHETIC_PERFORMER_FILE_BYTES)
    return `「${file.name}」超过单文件 500 MB 限制，请使用本地桌面版处理`
  return null
}

function isBasicWellFormedXml(xml: string): boolean {
  const stack: string[] = []
  const token =
    /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/?([A-Za-z_][\w:.-]*)(?:\s[^<>]*?)?\s*\/?\s*>/g
  let match: RegExpExecArray | null
  while ((match = token.exec(xml))) {
    const full = match[0]
    const name = match[1]
    if (!name || full.startsWith('<?') || full.startsWith('<!')) continue
    if (full.startsWith('</')) {
      if (stack.pop() !== name) return false
    } else if (!/\/\s*>$/.test(full)) {
      stack.push(name)
    }
  }
  return stack.length === 0
}

function assertValidXmpPacket(packet: string) {
  if (!/<(?:[A-Za-z_][\w.-]*:)?xmpmeta\b/.test(packet) || !/<[A-Za-z_][\w.-]*:RDF\b/.test(packet)) {
    throw makeError('现有 XMP 不是可安全修改的标准 XMP 数据')
  }

  if (typeof DOMParser !== 'undefined') {
    const document = new DOMParser().parseFromString(packet, 'application/xml')
    if (document.getElementsByTagName('parsererror').length > 0)
      throw makeError('现有 XMP XML 无法解析，已停止处理以保护原文件')
    return
  }

  if (!isBasicWellFormedXml(packet)) throw makeError('现有 XMP XML 无法解析，已停止处理以保护原文件')
}

function getNamespacePrefix(packet: string, namespace: string): string | null {
  const expression = new RegExp(`xmlns:([A-Za-z_][\\w.-]*)\\s*=\\s*(["'])${escapeRegex(namespace)}\\2`)
  return packet.match(expression)?.[1] ?? null
}

function startTagWithAttribute(tag: string, attribute: string): string {
  const isSelfClosing = /\/\s*>$/.test(tag)
  const suffixLength = isSelfClosing ? (tag.match(/\/\s*>$/)?.[0].length ?? 2) : 1
  return `${tag.slice(0, -suffixLength)} ${attribute}${isSelfClosing ? '/>' : '>'}`
}

function createMinimalXmpPacket(): string {
  return [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Amazon Image Studio">',
    `<rdf:RDF xmlns:rdf="${RDF_NAMESPACE}">`,
    `<rdf:Description rdf:about="" xmlns:dc="${DC_NAMESPACE}">`,
    '<dc:subject><rdf:Bag>',
    `<rdf:li>${SYNTHETIC_PERFORMER_KEYWORD}</rdf:li>`,
    '</rdf:Bag></dc:subject>',
    '</rdf:Description>',
    '</rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>',
  ].join('\n')
}

function findDescriptionStart(packet: string, rdfPrefix: string): RegExpExecArray | null {
  const expression = new RegExp(`<${escapeRegex(rdfPrefix)}:Description\\b[^>]*\\/?\\s*>`)
  return expression.exec(packet)
}

function createSubjectXml(dcPrefix: string, rdfPrefix: string): string {
  return `<${dcPrefix}:subject><${rdfPrefix}:Bag><${rdfPrefix}:li>${SYNTHETIC_PERFORMER_KEYWORD}</${rdfPrefix}:li></${rdfPrefix}:Bag></${dcPrefix}:subject>`
}

function updateXmpPacket(existingPacket: string | null): string {
  if (!existingPacket) return createMinimalXmpPacket()

  assertValidXmpPacket(existingPacket)
  let packet = existingPacket
  const rdfPrefix = getNamespacePrefix(packet, RDF_NAMESPACE)
  if (!rdfPrefix) throw makeError('现有 XMP 未使用可识别的 RDF 命名空间，无法安全修改')

  let description = findDescriptionStart(packet, rdfPrefix)
  if (!description || description.index == null) throw makeError('现有 XMP 缺少 rdf:Description，无法安全修改')

  let dcPrefix = getNamespacePrefix(packet, DC_NAMESPACE)
  if (!dcPrefix) {
    dcPrefix = 'dc'
    const updatedDescription = startTagWithAttribute(description[0], `xmlns:${dcPrefix}="${DC_NAMESPACE}"`)
    packet = `${packet.slice(0, description.index)}${updatedDescription}${packet.slice(description.index + description[0].length)}`
    description = findDescriptionStart(packet, rdfPrefix)
    if (!description || description.index == null) throw makeError('无法更新 XMP 命名空间')
  }

  const subjectExpression = new RegExp(
    `<${escapeRegex(dcPrefix)}:subject\\b[^>]*>[\\s\\S]*?<\\/${escapeRegex(dcPrefix)}:subject\\s*>`,
    'g',
  )
  const bagExpression = new RegExp(
    `<${escapeRegex(rdfPrefix)}:Bag\\b[^>]*>[\\s\\S]*?<\\/${escapeRegex(rdfPrefix)}:Bag\\s*>`,
  )
  const liExpression = new RegExp(
    `<${escapeRegex(rdfPrefix)}:li\\b[^>]*>([\\s\\S]*?)<\\/${escapeRegex(rdfPrefix)}:li\\s*>`,
    'g',
  )
  let foundSubject = false
  let foundBag = false
  let inserted = false

  packet = packet.replace(subjectExpression, (subject) => {
    foundSubject = true
    const bag = subject.match(bagExpression)?.[0]
    if (!bag) return subject

    foundBag = true
    const openingEnd = bag.indexOf('>') + 1
    const closingStart = bag.lastIndexOf(`</${rdfPrefix}:Bag`)
    if (openingEnd <= 0 || closingStart < openingEnd) throw makeError('现有 XMP 的 rdf:Bag 结构无效')

    const cleanedItems = bag
      .slice(openingEnd, closingStart)
      .replace(liExpression, (item, value: string) => (xmlText(value) === SYNTHETIC_PERFORMER_KEYWORD ? '' : item))
    const nextItems = inserted
      ? cleanedItems
      : `${cleanedItems}${cleanedItems.includes('\n') ? '\n  ' : ''}<${rdfPrefix}:li>${SYNTHETIC_PERFORMER_KEYWORD}</${rdfPrefix}:li>`
    inserted = true
    const nextBag = `${bag.slice(0, openingEnd)}${nextItems}${bag.slice(closingStart)}`
    return subject.replace(bag, nextBag)
  })

  if (foundBag && inserted) return packet
  if (foundSubject) throw makeError('现有 dc:subject 不是 rdf:Bag，无法安全修改')

  const subjectXml = createSubjectXml(dcPrefix, rdfPrefix)
  const descriptionTag = description[0]
  const descriptionStart = description.index
  if (/\/\s*>$/.test(descriptionTag)) {
    const opening = descriptionTag.replace(/\/\s*>$/, '>')
    return `${packet.slice(0, descriptionStart)}${opening}${subjectXml}</${rdfPrefix}:Description>${packet.slice(descriptionStart + descriptionTag.length)}`
  }

  const closing = `</${rdfPrefix}:Description>`
  const closingIndex = packet.indexOf(closing, descriptionStart + descriptionTag.length)
  if (closingIndex < 0) throw makeError('现有 XMP 的 rdf:Description 结构无效')
  return `${packet.slice(0, closingIndex)}${packet.includes('\n') ? '\n  ' : ''}${subjectXml}${packet.slice(closingIndex)}`
}

function countKeywordInXmp(packet: string): number {
  const rdfPrefix = getNamespacePrefix(packet, RDF_NAMESPACE)
  const dcPrefix = getNamespacePrefix(packet, DC_NAMESPACE)
  if (!rdfPrefix || !dcPrefix) return 0

  const subjectExpression = new RegExp(
    `<${escapeRegex(dcPrefix)}:subject\\b[^>]*>[\\s\\S]*?<\\/${escapeRegex(dcPrefix)}:subject\\s*>`,
    'g',
  )
  const bagExpression = new RegExp(
    `<${escapeRegex(rdfPrefix)}:Bag\\b[^>]*>[\\s\\S]*?<\\/${escapeRegex(rdfPrefix)}:Bag\\s*>`,
  )
  const liExpression = new RegExp(
    `<${escapeRegex(rdfPrefix)}:li\\b[^>]*>([\\s\\S]*?)<\\/${escapeRegex(rdfPrefix)}:li\\s*>`,
    'g',
  )
  let count = 0
  let subject: RegExpExecArray | null

  while ((subject = subjectExpression.exec(packet))) {
    const bag = subject[0].match(bagExpression)?.[0]
    if (!bag) continue
    let item: RegExpExecArray | null
    while ((item = liExpression.exec(bag))) {
      if (xmlText(item[1]) === SYNTHETIC_PERFORMER_KEYWORD) count++
    }
  }

  return count
}

function parseJpegSegments(bytes: Uint8Array): { segments: JpegSegment[]; tailStart: number } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw makeError('文件不是有效的 JPEG')
  const segments: JpegSegment[] = []
  let offset = 2

  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) throw makeError('JPEG 元数据区结构无效')
    const start = offset
    while (offset + 1 < bytes.length && bytes[offset + 1] === 0xff) offset++
    const marker = bytes[offset + 1]
    if (marker === 0xd9 || marker === 0xda) return { segments, tailStart: start }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }

    const length = readU16BE(bytes, offset + 2)
    const end = offset + 2 + length
    if (length < 2 || end > bytes.length) throw makeError('JPEG 元数据区长度无效')
    segments.push({ marker, start, end, payloadStart: offset + 4 })
    offset = end
  }

  throw makeError('JPEG 文件缺少结束标记')
}

function getJpegXmpCarrier(bytes: Uint8Array): XmpCarrier | null {
  const { segments } = parseJpegSegments(bytes)
  const matches: XmpCarrier[] = []
  let hasExtendedXmp = false

  for (const segment of segments) {
    if (segment.marker !== 0xe1) continue
    if (bytesEqualAt(bytes, ADOBE_XMP_EXTENSION_SIGNATURE, segment.payloadStart)) hasExtendedXmp = true
    if (!bytesEqualAt(bytes, ADOBE_XMP_SIGNATURE, segment.payloadStart)) continue
    const packetStart = segment.payloadStart + ADOBE_XMP_SIGNATURE.length
    matches.push({
      packet: decodeXmp(bytes.slice(packetStart, segment.end)),
      start: segment.start,
      end: segment.end,
      kind: 'jpeg',
    })
  }

  if (hasExtendedXmp) throw makeError('JPEG 含有扩展 XMP，轻量打标器无法安全修改')
  if (matches.length > 1) throw makeError('JPEG 含有多个标准 XMP 段，轻量打标器无法安全修改')
  return matches[0] ?? null
}

function buildJpegXmpSegment(packet: string): Uint8Array {
  const payload = concatBytes([ADOBE_XMP_SIGNATURE, UTF8.encode(packet)])
  const length = payload.length + 2
  if (length > 0xffff) throw makeError('JPEG XMP 过大，需要扩展 XMP；为保护原文件已停止处理')
  const segment = new Uint8Array(length + 2)
  segment[0] = 0xff
  segment[1] = 0xe1
  segment[2] = Math.floor(length / 0x100) & 0xff
  segment[3] = length & 0xff
  segment.set(payload, 4)
  return segment
}

function writeJpegXmp(bytes: Uint8Array, packet: string): Uint8Array {
  const carrier = getJpegXmpCarrier(bytes)
  const segment = buildJpegXmpSegment(packet)
  if (carrier) return concatBytes([bytes.slice(0, carrier.start), segment, bytes.slice(carrier.end)])

  const { segments } = parseJpegSegments(bytes)
  const app0Segments = segments.filter((segmentItem) => segmentItem.marker === 0xe0)
  const insertion = app0Segments[app0Segments.length - 1]?.end ?? 2
  return concatBytes([bytes.slice(0, insertion), segment, bytes.slice(insertion)])
}

function isPngSignature(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value)
}

function parsePngChunks(bytes: Uint8Array): PngChunk[] {
  if (bytes.length < PNG_SIGNATURE.length || !isPngSignature(bytes)) throw makeError('文件不是有效的 PNG')
  const chunks: PngChunk[] = []
  let offset = PNG_SIGNATURE.length
  let foundEnd = false

  while (offset + 12 <= bytes.length) {
    const length = readU32BE(bytes, offset)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const end = dataEnd + 4
    if (end > bytes.length) throw makeError('PNG 区块长度无效')
    const type = fourCc(bytes, offset + 4)
    chunks.push({ type, start: offset, dataStart, dataEnd, end })
    offset = end
    if (type === 'IEND') {
      foundEnd = true
      break
    }
  }

  if (!foundEnd || offset !== bytes.length) throw makeError('PNG 文件结构无效')
  return chunks
}

function findNull(bytes: Uint8Array, offset: number, end = bytes.length): number {
  for (let index = offset; index < end; index++) {
    if (bytes[index] === 0) return index
  }
  return -1
}

function parsePngXmpChunk(bytes: Uint8Array, chunk: PngChunk): XmpCarrier | null {
  if (chunk.type !== 'iTXt') return null
  const keywordEnd = findNull(bytes, chunk.dataStart, chunk.dataEnd)
  if (keywordEnd < 0) throw makeError('PNG iTXt 区块无效')
  const keyword = LATIN1.decode(bytes.slice(chunk.dataStart, keywordEnd))
  if (keyword !== PNG_XMP_KEYWORD) return null
  let offset = keywordEnd + 1
  if (offset + 2 > chunk.dataEnd) throw makeError('PNG XMP 区块无效')
  const compressionFlag = bytes[offset]
  offset += 2
  if (compressionFlag !== 0) throw makeError('PNG 使用压缩 XMP，轻量打标器无法安全修改')
  const languageEnd = findNull(bytes, offset, chunk.dataEnd)
  if (languageEnd < 0) throw makeError('PNG XMP 语言字段无效')
  offset = languageEnd + 1
  const translatedKeywordEnd = findNull(bytes, offset, chunk.dataEnd)
  if (translatedKeywordEnd < 0) throw makeError('PNG XMP 翻译字段无效')
  offset = translatedKeywordEnd + 1
  return {
    packet: decodeXmp(bytes.slice(offset, chunk.dataEnd)),
    start: chunk.start,
    end: chunk.end,
    kind: 'png',
  }
}

function getPngXmpCarrier(bytes: Uint8Array): XmpCarrier | null {
  const chunks = parsePngChunks(bytes)
  const matches: XmpCarrier[] = []
  for (const chunk of chunks) {
    if (
      (chunk.type === 'tEXt' || chunk.type === 'zTXt' || chunk.type === 'iTXt') &&
      LATIN1.decode(bytes.slice(chunk.dataStart, Math.min(chunk.dataStart + 24, chunk.dataEnd))).startsWith(
        'Raw profile type xmp',
      )
    ) {
      throw makeError('PNG 含有非标准 XMP 配置文件，轻量打标器无法安全修改')
    }
    const parsed = parsePngXmpChunk(bytes, chunk)
    if (parsed) matches.push(parsed)
  }
  if (matches.length > 1) throw makeError('PNG 含有多个标准 XMP 区块，轻量打标器无法安全修改')
  return matches[0] ?? null
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const value of bytes) {
    crc ^= value
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function buildPngXmpChunk(packet: string): Uint8Array {
  const keyword = ascii(PNG_XMP_KEYWORD)
  const xmp = UTF8.encode(packet)
  const data = new Uint8Array(keyword.length + 5 + xmp.length)
  data.set(keyword)
  data.set(xmp, keyword.length + 5)

  const chunk = new Uint8Array(12 + data.length)
  writeU32BE(chunk, 0, data.length)
  chunk.set(ascii('iTXt'), 4)
  chunk.set(data, 8)
  writeU32BE(chunk, 8 + data.length, crc32(chunk.slice(4, 8 + data.length)))
  return chunk
}

function writePngXmp(bytes: Uint8Array, packet: string): Uint8Array {
  const carrier = getPngXmpCarrier(bytes)
  const xmpChunk = buildPngXmpChunk(packet)
  if (carrier) return concatBytes([bytes.slice(0, carrier.start), xmpChunk, bytes.slice(carrier.end)])

  const ihdr = parsePngChunks(bytes).find((chunk) => chunk.type === 'IHDR')
  if (!ihdr) throw makeError('PNG 缺少 IHDR 区块')
  return concatBytes([bytes.slice(0, ihdr.end), xmpChunk, bytes.slice(ihdr.end)])
}

function parseWebpChunks(bytes: Uint8Array): WebpChunk[] {
  if (bytes.length < 12 || fourCc(bytes, 0) !== 'RIFF' || fourCc(bytes, 8) !== 'WEBP')
    throw makeError('文件不是有效的 WebP')
  const end = 8 + readU32LE(bytes, 4)
  if (end !== bytes.length) throw makeError('WebP RIFF 长度无效')

  const chunks: WebpChunk[] = []
  let offset = 12
  while (offset < end) {
    if (offset + 8 > end) throw makeError('WebP 区块头无效')
    const fourcc = fourCc(bytes, offset)
    const length = readU32LE(bytes, offset + 4)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const nextOffset = dataEnd + (length & 1)
    if (nextOffset > end) throw makeError('WebP 区块长度无效')
    chunks.push({ fourcc, data: bytes.slice(dataStart, dataEnd) })
    offset = nextOffset
  }
  return chunks
}

function getWebpXmpPacket(chunks: readonly WebpChunk[]): string | null {
  const matches = chunks.filter((chunk) => chunk.fourcc === 'XMP ')
  if (matches.length > 1) throw makeError('WebP 含有多个 XMP 区块，轻量打标器无法安全修改')
  if (matches.length === 0) return null
  return decodeXmp(matches[0].data)
}

function getWebpDimensions(chunks: readonly WebpChunk[]): { width: number; height: number } {
  const lossy = chunks.find((chunk) => chunk.fourcc === 'VP8 ')
  if (lossy && lossy.data.length >= 10) {
    return {
      width: (lossy.data[6] + lossy.data[7] * 0x100) & 0x3fff,
      height: (lossy.data[8] + lossy.data[9] * 0x100) & 0x3fff,
    }
  }
  const lossless = chunks.find((chunk) => chunk.fourcc === 'VP8L')
  if (lossless && lossless.data.length >= 5 && lossless.data[0] === 0x2f) {
    const bits = lossless.data[1] + lossless.data[2] * 0x100 + lossless.data[3] * 0x10000 + lossless.data[4] * 0x1000000
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    }
  }
  throw makeError('无法读取 WebP 尺寸，已停止处理以保护原文件')
}

function buildVp8x(width: number, height: number): WebpChunk {
  if (width <= 0 || height <= 0) throw makeError('WebP 尺寸无效')
  const data = new Uint8Array(10)
  data[0] = 0x04
  const encodedWidth = width - 1
  const encodedHeight = height - 1
  data[4] = encodedWidth & 0xff
  data[5] = Math.floor(encodedWidth / 0x100) & 0xff
  data[6] = Math.floor(encodedWidth / 0x10000) & 0xff
  data[7] = encodedHeight & 0xff
  data[8] = Math.floor(encodedHeight / 0x100) & 0xff
  data[9] = Math.floor(encodedHeight / 0x10000) & 0xff
  return { fourcc: 'VP8X', data }
}

function serializeWebp(chunks: readonly WebpChunk[]): Uint8Array {
  const bodyLength = 4 + chunks.reduce((length, chunk) => length + 8 + chunk.data.length + (chunk.data.length & 1), 0)
  const output = new Uint8Array(8 + bodyLength)
  output.set(ascii('RIFF'))
  writeU32LE(output, 4, bodyLength)
  output.set(ascii('WEBP'), 8)
  let offset = 12
  for (const chunk of chunks) {
    output.set(ascii(chunk.fourcc), offset)
    writeU32LE(output, offset + 4, chunk.data.length)
    output.set(chunk.data, offset + 8)
    offset += 8 + chunk.data.length + (chunk.data.length & 1)
  }
  return output
}

function writeWebpXmp(bytes: Uint8Array, packet: string): Uint8Array {
  const sourceChunks = parseWebpChunks(bytes)
  getWebpXmpPacket(sourceChunks)
  let chunks: WebpChunk[] = sourceChunks
    .filter((chunk) => chunk.fourcc !== 'XMP ')
    .map((chunk): WebpChunk => ({ fourcc: chunk.fourcc, data: chunk.data.slice() }))
  const vp8xIndex = chunks.findIndex((chunk) => chunk.fourcc === 'VP8X')
  if (vp8xIndex < 0) {
    const { width, height } = getWebpDimensions(chunks)
    chunks = [buildVp8x(width, height), ...chunks]
  } else {
    if (vp8xIndex !== 0 || chunks[vp8xIndex].data.length < 10) throw makeError('WebP VP8X 区块无效，无法安全修改')
    chunks[vp8xIndex].data[0] |= 0x04
  }
  chunks.push({ fourcc: 'XMP ', data: UTF8.encode(packet) })
  return serializeWebp(chunks)
}

function parseIsoBoxes(bytes: Uint8Array): IsoBox[] {
  const boxes: IsoBox[] = []
  let offset = 0
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw makeError('MP4/MOV 容器结构不完整')
    const size = readU32BE(bytes, offset)
    if (size === 1) throw makeError('MP4/MOV 使用超大 atom，轻量打标器无法安全修改')
    const resolvedSize = size === 0 ? bytes.length - offset : size
    if (resolvedSize < 8 || offset + resolvedSize > bytes.length) throw makeError('MP4/MOV atom 长度无效')
    boxes.push({ type: fourCc(bytes, offset + 4), start: offset, end: offset + resolvedSize })
    offset += resolvedSize
  }
  if (!boxes.some((box) => box.type === 'ftyp')) throw makeError('文件不是有效的 MP4/MOV 容器')
  return boxes
}

function getVideoXmpCarrier(bytes: Uint8Array): XmpCarrier | null {
  const boxes = parseIsoBoxes(bytes)
  if (boxes.some((box) => box.type === 'XMP_')) throw makeError('视频含有非标准 XMP atom，轻量打标器无法安全修改')
  const matches = boxes.filter(
    (box) => box.type === 'uuid' && box.end - box.start >= 24 && bytesEqualAt(bytes, ADOBE_XMP_UUID, box.start + 8),
  )
  if (matches.length > 1) throw makeError('视频含有多个 Adobe XMP UUID atom，轻量打标器无法安全修改')
  const match = matches[0]
  if (!match) return null
  return {
    packet: decodeXmp(bytes.slice(match.start + 24, match.end)),
    start: match.start,
    end: match.end,
    kind: 'video',
  }
}

function buildVideoXmpBox(packet: string): Uint8Array {
  const xmp = UTF8.encode(packet)
  const size = 24 + xmp.length
  if (size > 0xffffffff) throw makeError('视频 XMP 过大')
  const box = new Uint8Array(size)
  writeU32BE(box, 0, size)
  box.set(ascii('uuid'), 4)
  box.set(ADOBE_XMP_UUID, 8)
  box.set(xmp, 24)
  return box
}

function writeVideoXmp(bytes: Uint8Array, packet: string): Uint8Array {
  const carrier = getVideoXmpCarrier(bytes)
  const nextBox = buildVideoXmpBox(packet)
  if (!carrier) return concatBytes([bytes, nextBox])

  const withoutActiveXmp = bytes.slice()
  withoutActiveXmp.set(ascii('free'), carrier.start + 4)
  return concatBytes([withoutActiveXmp, nextBox])
}

function readXmpCarrier(bytes: Uint8Array, format: SyntheticPerformerMediaFormat): XmpCarrier | null {
  switch (format) {
    case 'jpeg':
      return getJpegXmpCarrier(bytes)
    case 'png':
      return getPngXmpCarrier(bytes)
    case 'webp': {
      const packet = getWebpXmpPacket(parseWebpChunks(bytes))
      return packet ? { packet, start: 0, end: bytes.length, kind: 'webp' } : null
    }
    case 'mp4':
    case 'mov':
      return getVideoXmpCarrier(bytes)
  }
}

function writeXmpCarrier(bytes: Uint8Array, format: SyntheticPerformerMediaFormat, packet: string): Uint8Array {
  switch (format) {
    case 'jpeg':
      return writeJpegXmp(bytes, packet)
    case 'png':
      return writePngXmp(bytes, packet)
    case 'webp':
      return writeWebpXmp(bytes, packet)
    case 'mp4':
    case 'mov':
      return writeVideoXmp(bytes, packet)
  }
}

export function verifySyntheticPerformerTag(bytes: Uint8Array, fileName: string): SyntheticPerformerVerification {
  const format = getSyntheticPerformerMediaFormat(fileName)
  if (!format) return { valid: false, keywordCount: 0, error: '不支持的媒体格式' }
  try {
    const carrier = readXmpCarrier(bytes, format)
    if (!carrier) return { valid: false, keywordCount: 0, error: '未找到嵌入式 XMP 数据' }
    assertValidXmpPacket(carrier.packet)
    const keywordCount = countKeywordInXmp(carrier.packet)
    return keywordCount === 1
      ? { valid: true, keywordCount, xmp: carrier.packet }
      : {
          valid: false,
          keywordCount,
          xmp: carrier.packet,
          error: `XMP dc:subject rdf:Bag 中找到 ${keywordCount} 个目标标记`,
        }
  } catch (error) {
    return {
      valid: false,
      keywordCount: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function tagSyntheticPerformerBytes(bytes: Uint8Array, fileName: string): TaggedSyntheticPerformerMedia {
  const format = getSyntheticPerformerMediaFormat(fileName)
  if (!format) throw makeError('不支持的媒体格式，仅支持 JPG、PNG、WebP、MP4、MOV')
  if (bytes.length === 0) throw makeError('文件为空，无法写入 XMP 标记')

  const existingPacket = readXmpCarrier(bytes, format)?.packet ?? null
  const xmp = updateXmpPacket(existingPacket)
  assertValidXmpPacket(xmp)
  const output = writeXmpCarrier(bytes, format, xmp)
  const verification = verifySyntheticPerformerTag(output, fileName)
  if (!verification.valid) throw makeError(`XMP 写入验证失败：${verification.error ?? '未知原因'}`)
  return { format, bytes: output, xmp: verification.xmp ?? xmp, verification }
}

export async function tagSyntheticPerformerFile(file: File): Promise<TaggedSyntheticPerformerFile> {
  const validationError = getSyntheticPerformerMediaValidationError(file)
  if (validationError) throw makeError(validationError)
  const tagged = tagSyntheticPerformerBytes(new Uint8Array(await file.arrayBuffer()), file.name)
  const blobBytes = new Uint8Array(tagged.bytes.length)
  blobBytes.set(tagged.bytes)
  return {
    ...tagged,
    blob: new Blob([blobBytes.buffer], { type: getSyntheticPerformerMediaMimeType(file.name) ?? file.type }),
  }
}

export async function processSyntheticPerformerFile(file: File): Promise<SyntheticPerformerFileProcessingResult> {
  const validationError = getSyntheticPerformerMediaValidationError(file)
  if (validationError) throw makeError(validationError)

  const bytes = new Uint8Array(await file.arrayBuffer())
  const existingVerification = verifySyntheticPerformerTag(bytes, file.name)
  if (existingVerification.valid) {
    return { kind: 'already-tagged', verification: existingVerification }
  }

  const tagged = tagSyntheticPerformerBytes(bytes, file.name)
  const blobBytes = new Uint8Array(tagged.bytes.length)
  blobBytes.set(tagged.bytes)
  return {
    kind: 'tagged',
    output: {
      ...tagged,
      blob: new Blob([blobBytes.buffer], { type: getSyntheticPerformerMediaMimeType(file.name) ?? file.type }),
    },
  }
}
