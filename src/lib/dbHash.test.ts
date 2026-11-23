import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashDataUrl } from './db'

describe('image hashes without secure-context APIs', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps uploads deterministic and distinguishes image bytes without crypto.subtle', async () => {
    vi.stubGlobal('crypto', {})
    const image = 'data:image/png;base64,AQID'
    const hash = await hashDataUrl(image)
    expect(hash).toMatch(/^fallback-[\da-f]{16}$/)
    expect(await hashDataUrl(image)).toBe(hash)
    expect(await hashDataUrl('data:image/png;base64,AQIE')).not.toBe(hash)
  })

  it('preserves SHA-256 image identities in secure contexts', async () => {
    expect(await hashDataUrl('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
