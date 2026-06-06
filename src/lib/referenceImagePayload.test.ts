import { describe, expect, it, vi } from 'vitest'
import {
  prepareReferenceImageAndMaskPayload,
  prepareReferenceImagePayload,
  type PlannerReferenceImageCompressionRequest,
} from './referenceImagePayload'

function dataUrlOfLength(length: number, prefix = 'data:image/png;base64,') {
  return `${prefix}${'a'.repeat(Math.max(0, length - prefix.length))}`
}

describe('prepareReferenceImagePayload', () => {
  it('returns an empty payload without compressing when there are no reference images', async () => {
    const compressor = vi.fn()

    const result = await prepareReferenceImagePayload([], {
      maxPayloadBytes: 10,
      compressor,
    })

    expect(compressor).not.toHaveBeenCalled()
    expect(result).toEqual({
      dataUrls: [],
      originalBytes: 0,
      payloadBytes: 0,
      compressedCount: 0,
      pass: 'none',
      notice: '',
    })
  })

  it('compresses multiple reference images on the primary pass', async () => {
    const compressor = vi.fn(async (_dataUrl: string, request: PlannerReferenceImageCompressionRequest) =>
      dataUrlOfLength(request.maxEdge === 1024 ? 80 : 40, 'data:image/webp;base64,'),
    )

    const result = await prepareReferenceImagePayload([dataUrlOfLength(200), dataUrlOfLength(300)], {
      maxPayloadBytes: 200,
      compressor,
    })

    expect(compressor).toHaveBeenCalledTimes(2)
    expect(result.dataUrls).toHaveLength(2)
    expect(result.pass).toBe('primary')
    expect(result.compressedCount).toBe(2)
    expect(result.originalBytes).toBe(500)
    expect(result.payloadBytes).toBe(160)
    expect(result.notice).toContain('本次已压缩 2 张参考图')
  })

  it('falls back to smaller compression when the primary pass is still too large', async () => {
    const compressor = vi.fn(async (_dataUrl: string, request: PlannerReferenceImageCompressionRequest) =>
      dataUrlOfLength(request.maxEdge === 1024 ? 80 : 40, 'data:image/webp;base64,'),
    )

    const result = await prepareReferenceImagePayload([dataUrlOfLength(200), dataUrlOfLength(300)], {
      maxPayloadBytes: 100,
      compressor,
    })

    expect(compressor).toHaveBeenCalledTimes(4)
    expect(result.pass).toBe('fallback')
    expect(result.payloadBytes).toBe(80)
    expect(result.notice).toContain('已自动降级压缩')
  })

  it('throws locally when the fallback payload is still too large', async () => {
    const compressor = vi.fn(async () => dataUrlOfLength(80, 'data:image/webp;base64,'))

    await expect(prepareReferenceImagePayload([dataUrlOfLength(200), dataUrlOfLength(300)], {
      maxPayloadBytes: 100,
      compressor,
    })).rejects.toThrow('参考图压缩后仍过大')

    expect(compressor).toHaveBeenCalledTimes(4)
  })

  it('honors an already aborted signal before compressing', async () => {
    const compressor = vi.fn()
    const controller = new AbortController()
    controller.abort()

    await expect(prepareReferenceImagePayload([dataUrlOfLength(200)], {
      signal: controller.signal,
      compressor,
    })).rejects.toMatchObject({ name: 'AbortError' })

    expect(compressor).not.toHaveBeenCalled()
  })
})

describe('prepareReferenceImageAndMaskPayload', () => {
  it('compresses the first image and mask as a matched pair', async () => {
    const compressor = vi.fn(async () => dataUrlOfLength(40, 'data:image/webp;base64,'))
    const maskCompressor = vi.fn(async () => ({
      imageDataUrl: dataUrlOfLength(50, 'data:image/webp;base64,'),
      maskDataUrl: dataUrlOfLength(30, 'data:image/png;base64,'),
    }))

    const result = await prepareReferenceImageAndMaskPayload([dataUrlOfLength(200), dataUrlOfLength(180)], dataUrlOfLength(160), {
      maxPayloadBytes: 140,
      compressor,
      maskCompressor,
    })

    expect(maskCompressor).toHaveBeenCalledTimes(1)
    expect(compressor).toHaveBeenCalledTimes(1)
    expect(result.dataUrls).toHaveLength(2)
    expect(result.maskDataUrl).toBe(dataUrlOfLength(30, 'data:image/png;base64,'))
    expect(result.payloadBytes).toBe(120)
    expect(result.pass).toBe('primary')
  })

  it('keeps a mask-only payload compatible for direct API callers', async () => {
    const result = await prepareReferenceImageAndMaskPayload([], dataUrlOfLength(80), {
      maxPayloadBytes: 100,
    })

    expect(result.dataUrls).toEqual([])
    expect(result.maskDataUrl).toBe(dataUrlOfLength(80))
    expect(result.compressedCount).toBe(0)
    expect(result.notice).toBe('')
  })
})
