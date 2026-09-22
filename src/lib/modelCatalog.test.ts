import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildModelsEndpoint, fetchUpstreamModels, normalizeModelsResponse } from './modelCatalog'

describe('model catalog', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes OpenAI and array response formats', () => {
    expect(normalizeModelsResponse({ data: [{ id: 'gpt-a' }, { id: ' gpt-b ' }, { id: 'gpt-a' }] })).toEqual([
      'gpt-a',
      'gpt-b',
    ])
    expect(normalizeModelsResponse(['model-a', ' ', { id: 'model-b' }, { name: 'ignored' }])).toEqual([
      'model-a',
      'model-b',
    ])
  })

  it('builds the models endpoint without duplicating /v1', () => {
    expect(buildModelsEndpoint({ baseUrl: 'https://example.com/v1', apiProxy: false })).toBe(
      'https://example.com/v1/models',
    )
    expect(buildModelsEndpoint({ baseUrl: 'https://example.com', apiProxy: false })).toBe(
      'https://example.com/v1/models',
    )
  })

  it('fetches and returns model ids', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'gpt-5.5' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    await expect(
      fetchUpstreamModels({ baseUrl: 'https://example.com/v1', apiKey: 'test-key', apiProxy: false }),
    ).resolves.toEqual(['gpt-5.5'])
    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/v1/models',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-key' }) }),
    )
  })

  it('reports upstream HTTP errors and empty catalogs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad gateway', { status: 502 })),
    )
    await expect(
      fetchUpstreamModels({ baseUrl: 'https://example.com', apiKey: 'test-key', apiProxy: false }),
    ).rejects.toThrow('HTTP 502')

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
    )
    await expect(
      fetchUpstreamModels({ baseUrl: 'https://example.com', apiKey: 'test-key', apiProxy: false }),
    ).rejects.toThrow('模型列表为空')
  })
})
