import { describe, expect, it } from 'vitest'
import {
  getSyntheticPerformerMediaFormat,
  getSyntheticPerformerMediaValidationError,
  isSupportedSyntheticPerformerMedia,
  MAX_SYNTHETIC_PERFORMER_BATCH_BYTES,
  MAX_SYNTHETIC_PERFORMER_FILE_BYTES,
  processSyntheticPerformerFile,
  SYNTHETIC_PERFORMER_KEYWORD,
  tagSyntheticPerformerBytes,
  verifySyntheticPerformerTag,
} from './syntheticPerformerMetadata'

const encoder = new TextEncoder()

function ascii(value: string) {
  return encoder.encode(value)
}

function u32be(value: number) {
  return new Uint8Array([
    Math.floor(value / 0x1000000) & 0xff,
    Math.floor(value / 0x10000) & 0xff,
    Math.floor(value / 0x100) & 0xff,
    value & 0xff,
  ])
}

function u32le(value: number) {
  return new Uint8Array([
    value & 0xff,
    Math.floor(value / 0x100) & 0xff,
    Math.floor(value / 0x10000) & 0xff,
    Math.floor(value / 0x1000000) & 0xff,
  ])
}

function join(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

function pngChunk(type: string, data: Uint8Array) {
  // The writer intentionally does not require an input CRC to be valid. A
  // zero CRC keeps this fixture small while preserving the chunk boundaries.
  return join(u32be(data.length), ascii(type), data, new Uint8Array(4))
}

function makePng() {
  return join(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', new Uint8Array(13)),
    pngChunk('IEND', new Uint8Array()),
  )
}

function makeWebp() {
  const imageChunk = join(ascii('VP8L'), u32le(5), new Uint8Array([0x2f, 0, 0, 0, 0]), new Uint8Array([0]))
  return join(ascii('RIFF'), u32le(4 + imageChunk.length), ascii('WEBP'), imageChunk)
}

function makeIsoBox(type: string, payload: Uint8Array) {
  return join(u32be(8 + payload.length), ascii(type), payload)
}

function makeVideo() {
  return join(makeIsoBox('ftyp', ascii('isom\0\0\0\0isom')), makeIsoBox('mdat', new Uint8Array([1, 2, 3, 4, 5, 6])))
}

function createXmp(subjects: string[]) {
  return [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:custom="urn:custom">',
    '<dc:subject><rdf:Bag>',
    ...subjects.map((subject) => `<rdf:li>${subject}</rdf:li>`),
    '</rdf:Bag></dc:subject>',
    '<custom:keep>preserve-me</custom:keep>',
    '</rdf:Description></rdf:RDF></x:xmpmeta>',
    '<?xpacket end="w"?>',
  ].join('\n')
}

function makeJpegWithXmp(packet: string) {
  const signature = ascii('http://ns.adobe.com/xap/1.0/\0')
  const payload = join(signature, ascii(packet))
  const length = payload.length + 2
  const segment = new Uint8Array(length + 2)
  segment.set([0xff, 0xe1, Math.floor(length / 0x100), length & 0xff])
  segment.set(payload, 4)
  return join(new Uint8Array([0xff, 0xd8]), segment, new Uint8Array([0xff, 0xd9]))
}

describe('synthetic performer metadata', () => {
  it.each([
    ['product.JPG', 'jpeg'],
    ['product.jpeg', 'jpeg'],
    ['product.png', 'png'],
    ['product.webp', 'webp'],
    ['product.mp4', 'mp4'],
    ['product.MOV', 'mov'],
  ] as const)('recognizes %s as %s', (fileName, format) => {
    expect(getSyntheticPerformerMediaFormat(fileName)).toBe(format)
    expect(isSupportedSyntheticPerformerMedia(fileName)).toBe(true)
  })

  it('exposes the selected safety limits', () => {
    expect(MAX_SYNTHETIC_PERFORMER_FILE_BYTES).toBe(500 * 1024 * 1024)
    expect(MAX_SYNTHETIC_PERFORMER_BATCH_BYTES).toBe(1024 * 1024 * 1024)
    expect(
      getSyntheticPerformerMediaValidationError({
        name: 'x.jpg',
        size: MAX_SYNTHETIC_PERFORMER_FILE_BYTES + 1,
      } as File),
    ).toContain('500 MB')
    expect(getSyntheticPerformerMediaValidationError({ name: 'x.gif', size: 1 } as File)).toContain('不支持')
  })

  it.each([
    ['image.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xd9])],
    ['image.png', makePng()],
    ['image.webp', makeWebp()],
    ['video.mp4', makeVideo()],
    ['video.mov', makeVideo()],
  ] as const)('writes and verifies the tag for %s', (fileName, source) => {
    const tagged = tagSyntheticPerformerBytes(source, fileName)
    const verification = verifySyntheticPerformerTag(tagged.bytes, fileName)

    expect(tagged.verification.valid).toBe(true)
    expect(verification).toMatchObject({ valid: true, keywordCount: 1 })
    expect(verification.xmp).toContain(`<rdf:li>${SYNTHETIC_PERFORMER_KEYWORD}</rdf:li>`)
    expect(tagged.bytes.length).toBeGreaterThan(source.length)
  })

  it('keeps existing subject values and custom XMP fields while deduplicating the target', () => {
    const source = makeJpegWithXmp(
      createXmp(['existing-keyword', SYNTHETIC_PERFORMER_KEYWORD, SYNTHETIC_PERFORMER_KEYWORD]),
    )
    const tagged = tagSyntheticPerformerBytes(source, 'existing.jpg')
    const taggedAgain = tagSyntheticPerformerBytes(tagged.bytes, 'existing.jpg')

    expect(tagged.xmp).toContain('<rdf:li>existing-keyword</rdf:li>')
    expect(tagged.xmp).toContain('<custom:keep>preserve-me</custom:keep>')
    expect(tagged.xmp.match(new RegExp(SYNTHETIC_PERFORMER_KEYWORD, 'g'))).toHaveLength(1)
    expect(verifySyntheticPerformerTag(taggedAgain.bytes, 'existing.jpg')).toMatchObject({
      valid: true,
      keywordCount: 1,
    })
  })

  it('does not alter the original video bytes when appending its XMP UUID box', () => {
    const source = makeVideo()
    const tagged = tagSyntheticPerformerBytes(source, 'video.mp4')
    expect(Array.from(tagged.bytes.slice(0, source.length))).toEqual(Array.from(source))
    expect(verifySyntheticPerformerTag(tagged.bytes, 'video.mp4').valid).toBe(true)
  })

  it('skips a file that already contains one valid synthetic performer tag', async () => {
    const tagged = tagSyntheticPerformerBytes(makeVideo(), 'video.mp4')
    const copy = new Uint8Array(tagged.bytes.length)
    copy.set(tagged.bytes)
    const file = new File([copy.buffer], 'video.mp4', { type: 'video/mp4' })
    const result = await processSyntheticPerformerFile(file)

    expect(result).toMatchObject({
      kind: 'already-tagged',
      verification: { valid: true, keywordCount: 1 },
    })
    expect('output' in result).toBe(false)
  })

  it('returns a safe failure for malformed or unsupported input', () => {
    expect(() => tagSyntheticPerformerBytes(new Uint8Array([1, 2, 3]), 'broken.jpg')).toThrow('JPEG')
    expect(verifySyntheticPerformerTag(new Uint8Array([1, 2, 3]), 'broken.gif')).toMatchObject({
      valid: false,
      keywordCount: 0,
    })
  })
})
