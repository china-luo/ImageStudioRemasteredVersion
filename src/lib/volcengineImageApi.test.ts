import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import {
  createDefaultVolcengineProfile,
  DEFAULT_VOLCENGINE_BASE_URL,
  DEFAULT_VOLCENGINE_MODEL,
  normalizeSettings,
} from './apiProfiles'
import { callVolcengineImageApi } from './volcengineImageApi'

const SEEDREAM_LITE_MODEL = 'doubao-seedream-5-0-260128'

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createProfile(overrides: Partial<ReturnType<typeof createDefaultVolcengineProfile>> = {}) {
  return createDefaultVolcengineProfile({
    id: 'volcengine-profile',
    apiKey: 'ark-key',
    ...overrides,
  })
}

function createSettings(profile: ReturnType<typeof createDefaultVolcengineProfile>) {
  return normalizeSettings({
    profiles: [profile],
    activeProfileId: profile.id,
  })
}

describe('callVolcengineImageApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('posts text-to-image requests to /api/v3/images/generations without adding /v1', async () => {
    const profile = createProfile()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        data: [{ url: 'data:image/png;base64,aW1hZ2U=' }],
      }),
    )

    const result = await callVolcengineImageApi(
      {
        settings: createSettings(profile),
        prompt: 'prompt',
        params: { ...DEFAULT_PARAMS, size: '2048x2048', output_format: 'png' },
        inputImageDataUrls: [],
      },
      profile,
    )

    expect(fetchMock).toHaveBeenCalledWith(
      `${DEFAULT_VOLCENGINE_BASE_URL}/images/generations`,
      expect.objectContaining({ method: 'POST' }),
    )
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body).toEqual({
      model: DEFAULT_VOLCENGINE_MODEL,
      prompt: 'prompt',
      size: '2K',
      watermark: false,
      response_format: 'url',
      stream: false,
    })
    expect(result.images).toEqual(['data:image/png;base64,aW1hZ2U='])
  })

  it('sends reference images as JSON image_urls and group image options for n > 1', async () => {
    const profile = createProfile({ model: SEEDREAM_LITE_MODEL })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        data: [{ b64_json: 'aW1hZ2U=' }],
      }),
    )

    await callVolcengineImageApi(
      {
        settings: createSettings(profile),
        prompt: 'edit prompt',
        params: { ...DEFAULT_PARAMS, size: 'auto', output_format: 'webp', n: 3 },
        inputImageDataUrls: ['data:image/png;base64,aW5wdXQ='],
      },
      profile,
    )

    expect(fetchMock.mock.calls[0][0]).toBe(`${DEFAULT_VOLCENGINE_BASE_URL}/images/generations`)
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).not.toBeInstanceOf(FormData)
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body).toMatchObject({
      size: '2048x2048',
      output_format: 'jpeg',
      image_urls: ['data:image/png;base64,aW5wdXQ='],
      sequential_image_generation: 'auto',
      sequential_image_generation_options: { max_images: 3 },
    })
  })

  it('switches response_format to b64_json and parses Base64 images', async () => {
    const profile = createProfile({ model: SEEDREAM_LITE_MODEL, responseFormatB64Json: true })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        data: [{ b64_json: 'aW1hZ2U=' }],
      }),
    )

    const result = await callVolcengineImageApi(
      {
        settings: createSettings(profile),
        prompt: 'prompt',
        params: { ...DEFAULT_PARAMS },
        inputImageDataUrls: [],
      },
      profile,
    )

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.response_format).toBe('b64_json')
    expect(result.images).toEqual(['data:image/jpeg;base64,aW1hZ2U='])
  })

  it('uses official Seedream Pro image payload fields', async () => {
    const profile = createProfile({ model: 'doubao-seedream-5-0-pro-260628' })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        data: [{ url: 'data:image/png;base64,aW1hZ2U=' }],
      }),
    )

    await callVolcengineImageApi(
      {
        settings: createSettings(profile),
        prompt: 'edit prompt',
        params: { ...DEFAULT_PARAMS, size: '2048x2048', output_format: 'png' },
        inputImageDataUrls: ['data:image/png;base64,aW5wdXQ='],
      },
      profile,
    )

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body).toEqual({
      model: 'doubao-seedream-5-0-pro-260628',
      prompt: 'edit prompt',
      size: '2K',
      watermark: false,
      response_format: 'url',
      stream: false,
      image: 'data:image/png;base64,aW5wdXQ=',
    })
  })

  it('forces URL response format for Seedream Pro even when Base64 is enabled', async () => {
    const profile = createProfile({ model: 'doubao-seedream-5-0-pro-260628', responseFormatB64Json: true })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        data: [{ url: 'data:image/png;base64,aW1hZ2U=' }],
      }),
    )

    await callVolcengineImageApi(
      {
        settings: createSettings(profile),
        prompt: 'prompt',
        params: { ...DEFAULT_PARAMS },
        inputImageDataUrls: [],
      },
      profile,
    )

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.response_format).toBe('url')
  })

  it('sends multiple Seedream Pro references with image array', async () => {
    const profile = createProfile({ model: 'doubao-seedream-5-0-pro-260628' })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        data: [{ url: 'data:image/png;base64,aW1hZ2U=' }],
      }),
    )

    await callVolcengineImageApi(
      {
        settings: createSettings(profile),
        prompt: 'edit prompt',
        params: { ...DEFAULT_PARAMS, size: '4096x4096' },
        inputImageDataUrls: ['data:image/png;base64,Zmlyc3Q=', 'data:image/png;base64,c2Vjb25k'],
      },
      profile,
    )

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.size).toBe('4K')
    expect(body.image).toEqual(['data:image/png;base64,Zmlyc3Q=', 'data:image/png;base64,c2Vjb25k'])
    expect(body).not.toHaveProperty('image_urls')
    expect(body).not.toHaveProperty('sequential_image_generation')
  })

  it('downloads URL responses and returns raw image URLs', async () => {
    const profile = createProfile()
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ url: 'https://img.example.com/result.png' }],
        }),
      )
      .mockResolvedValueOnce(new Response(new Blob(['image'], { type: 'image/png' }), { status: 200 }))

    const result = await callVolcengineImageApi(
      {
        settings: createSettings(profile),
        prompt: 'prompt',
        params: { ...DEFAULT_PARAMS, output_format: 'png' },
        inputImageDataUrls: [],
      },
      profile,
    )

    expect(fetchMock.mock.calls[1][0]).toBe('https://img.example.com/result.png')
    expect(result.images[0]).toMatch(/^data:image\/png;base64,/)
    expect(result.rawImageUrls).toEqual(['https://img.example.com/result.png'])
  })

  it('falls back to the same-origin image proxy when URL download is blocked by CORS', async () => {
    const profile = createProfile()
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ url: 'https://ark-project.tos-cn-beijing.volces.com/result.png' }],
        }),
      )
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
        new Response(new Blob(['image'], { type: 'image/png' }), {
          status: 200,
          headers: {
            'Content-Type': 'image/png',
            'X-Image-Proxy': '1',
          },
        }),
      )

    const result = await callVolcengineImageApi(
      {
        settings: createSettings(profile),
        prompt: 'prompt',
        params: { ...DEFAULT_PARAMS, output_format: 'png' },
        inputImageDataUrls: [],
      },
      profile,
    )

    expect(fetchMock.mock.calls[2][0]).toBe('/image-proxy/')
    expect((fetchMock.mock.calls[2][1] as RequestInit).headers).toEqual({
      'X-Image-Url': 'https://ark-project.tos-cn-beijing.volces.com/result.png',
    })
    expect(result.images[0]).toMatch(/^data:image\/png;base64,/)
    expect(result.rawImageUrls).toEqual(['https://ark-project.tos-cn-beijing.volces.com/result.png'])
  })

  it('rejects mask editing locally', async () => {
    const profile = createProfile()
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(
      callVolcengineImageApi(
        {
          settings: createSettings(profile),
          prompt: 'prompt',
          params: { ...DEFAULT_PARAMS },
          inputImageDataUrls: ['data:image/png;base64,aW5wdXQ='],
          maskDataUrl: 'data:image/png;base64,bWFzaw==',
        },
        profile,
      ),
    ).rejects.toThrow('当前火山 Seedream 接入暂不支持遮罩编辑')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects Seedream Pro group image requests locally', async () => {
    const profile = createProfile({ model: 'doubao-seedream-5-0-pro-260628' })
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(
      callVolcengineImageApi(
        {
          settings: createSettings(profile),
          prompt: 'prompt',
          params: { ...DEFAULT_PARAMS, n: 2 },
          inputImageDataUrls: [],
        },
        profile,
      ),
    ).rejects.toThrow('当前火山 Seedream Pro 模型不支持组图生成')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
