import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultOpenAIProfile, normalizeSettings } from './apiProfiles'
import {
  callAliyunQwenImageApi,
  createAliyunQwenImageEndpoint,
  createAliyunQwenImageRequestBody,
} from './aliyunQwenImageApi'

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createProfile(overrides: Partial<ReturnType<typeof createDefaultOpenAIProfile>> = {}) {
  return createDefaultOpenAIProfile({
    id: 'aliyun-profile',
    apiKey: 'dashscope-key',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    model: 'qwen-image-3.0-pro',
    ...overrides,
  })
}

function createSettings(profile: ReturnType<typeof createDefaultOpenAIProfile>) {
  return normalizeSettings({
    profiles: [profile],
    activeProfileId: profile.id,
  })
}

describe('Aliyun Qwen-Image native API', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('builds a native endpoint from DashScope and workspace base URLs', () => {
    expect(createAliyunQwenImageEndpoint('https://dashscope.aliyuncs.com/api/v1'))
      .toBe('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')
    expect(createAliyunQwenImageEndpoint('https://workspace.cn-beijing.maas.aliyuncs.com/v1'))
      .toBe('https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')
    expect(createAliyunQwenImageEndpoint('https://dashscope.aliyuncs.com/compatible-mode/v1'))
      .toBe('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')
  })

  it('sends Qwen native messages and keeps prompt_extend enabled', () => {
    const profile = createProfile()
    const body = createAliyunQwenImageRequestBody({
      settings: createSettings(profile),
      prompt: 'edit prompt',
      params: { ...DEFAULT_PARAMS, size: '1024x1536', n: 2 },
      inputImageDataUrls: ['data:image/png;base64,aW1hZ2Ux', 'data:image/png;base64,aW1hZ2Uy'],
    }, profile)

    expect(body).toEqual({
      model: 'qwen-image-3.0-pro',
      input: {
        messages: [{
          role: 'user',
          content: [
            { image: 'data:image/png;base64,aW1hZ2Ux' },
            { image: 'data:image/png;base64,aW1hZ2Uy' },
            { text: 'edit prompt' },
          ],
        }],
      },
      parameters: {
        prompt_extend: true,
        n: 2,
        watermark: false,
        size: '1024*1536',
      },
    })
  })

  it('routes the request through the native endpoint and parses PNG output', async () => {
    const profile = createProfile()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      output: {
        choices: [{
          message: {
            content: [{ image: 'data:image/png;base64,aW1hZ2U=' }],
          },
        }],
      },
      usage: { output_width: 1024, output_height: 1536 },
    }))

    const result = await callAliyunQwenImageApi({
      settings: createSettings(profile),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, size: '1024x1536' },
      inputImageDataUrls: [],
    }, profile)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result.images).toEqual(['data:image/png;base64,aW1hZ2U='])
    expect(result.actualParams).toMatchObject({ size: '1024x1536', output_format: 'png', n: 1 })
  })

  it('falls back to the same-origin proxy for Alibaba result URLs blocked by CORS', async () => {
    const profile = createProfile()
    const resultUrl = 'https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/result.png'
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        output: { choices: [{ message: { content: [{ image: resultUrl }] } }] },
      }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(new Blob(['image'], { type: 'image/png' }), {
        status: 200,
        headers: { 'Content-Type': 'image/png', 'X-Image-Proxy': '1' },
      }))

    const result = await callAliyunQwenImageApi({
      settings: createSettings(profile),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    }, profile)

    expect(fetchMock.mock.calls[2][0]).toBe('/image-proxy/')
    expect((fetchMock.mock.calls[2][1] as RequestInit).headers).toEqual({ 'X-Image-Url': resultUrl })
    expect(result.images[0]).toMatch(/^data:image\/png;base64,/)
    expect(result.rawImageUrls).toEqual([resultUrl])
  })

  it('rejects unsupported mask editing and more than three reference images locally', async () => {
    const profile = createProfile()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const baseOptions = {
      settings: createSettings(profile),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
    }

    await expect(callAliyunQwenImageApi({
      ...baseOptions,
      inputImageDataUrls: ['data:image/png;base64,aW1hZ2U='],
      maskDataUrl: 'data:image/png;base64,bWFzaw==',
    }, profile)).rejects.toThrow('暂不支持遮罩编辑')

    await expect(callAliyunQwenImageApi({
      ...baseOptions,
      inputImageDataUrls: ['1', '2', '3', '4'],
    }, profile)).rejects.toThrow('最多支持 3 张参考图')

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

