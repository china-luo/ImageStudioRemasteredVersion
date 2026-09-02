import { describe, expect, it } from 'vitest'
import { bytesToDataUrl, dataUrlToBytes } from './backupCodec'

describe('backupCodec', () => {
  it('round-trips a PNG data URL without going through the store', () => {
    const original = 'data:image/png;base64,YQ=='
    const { ext, bytes } = dataUrlToBytes(original)
    expect(ext).toBe('png')
    expect(bytesToDataUrl(bytes, 'images/demo.png')).toBe(original)
  })
})
