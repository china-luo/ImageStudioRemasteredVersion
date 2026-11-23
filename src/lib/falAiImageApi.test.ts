import { createFalClient } from '@fal-ai/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultFalProfile, DEFAULT_FAL_BASE_URL, DEFAULT_SETTINGS } from './apiProfiles'
import { callFalAiImageApi, getFalQueuedImageResult } from './falAiImageApi'

vi.mock('@fal-ai/client', () => ({ createFalClient: vi.fn() }))

function mockClient(image: string) {
  const result = { requestId: 'req-1', data: { images: [{ b64_json: image }] } }
  return {
    subscribe: vi.fn(async () => result),
    queue: { subscribeToStatus: vi.fn(async () => undefined), result: vi.fn(async () => result) },
  }
}

const createClient = vi.mocked(createFalClient)
const asFalClient = (client: ReturnType<typeof mockClient>) => client as unknown as ReturnType<typeof createFalClient>

describe('callFalAiImageApi', () => {
  beforeEach(() => {
    createClient.mockReset().mockReturnValue(asFalClient(mockClient('aW1hZ2U=')))
  })

  it('uses the default fal endpoint without proxyUrl', async () => {
    await callFalAiImageApi(
      {
        settings: DEFAULT_SETTINGS,
        prompt: 'prompt',
        params: { ...DEFAULT_PARAMS },
        inputImageDataUrls: [],
      },
      createDefaultFalProfile({ apiKey: 'fal-key', baseUrl: DEFAULT_FAL_BASE_URL }),
    )

    expect(createClient).toHaveBeenCalledWith({
      credentials: 'fal-key',
      suppressLocalCredentialsWarning: true,
      fetch,
    })
  })

  it('passes custom fal API URL to the SDK proxyUrl option', async () => {
    await callFalAiImageApi(
      {
        settings: DEFAULT_SETTINGS,
        prompt: 'prompt',
        params: { ...DEFAULT_PARAMS },
        inputImageDataUrls: [],
      },
      createDefaultFalProfile({
        apiKey: 'fal-key',
        baseUrl: 'https://fal-proxy.example.com/api/fal/',
      }),
    )

    expect(createClient).toHaveBeenCalledWith({
      credentials: 'fal-key',
      suppressLocalCredentialsWarning: true,
      fetch,
      proxyUrl: 'https://fal-proxy.example.com/api/fal',
    })
  })

  it('passes the recovery signal through status and result queries', async () => {
    const client = mockClient('YQ==')
    createClient.mockReturnValue(asFalClient(client))
    const controller = new AbortController()
    await getFalQueuedImageResult(
      createDefaultFalProfile({ apiKey: 'key' }),
      'model',
      'same-remote',
      DEFAULT_PARAMS,
      controller.signal,
    )
    expect(client.queue.subscribeToStatus).toHaveBeenCalledWith('model', {
      requestId: 'same-remote',
      logs: true,
      abortSignal: controller.signal,
    })
    expect(client.queue.result).toHaveBeenCalledWith('model', {
      requestId: 'same-remote',
      abortSignal: controller.signal,
    })
  })

  it('does not start result queries after cancellation even when the SDK status call resolves late', async () => {
    const client = mockClient('YQ==')
    const controller = new AbortController()
    client.queue.subscribeToStatus.mockImplementation(async () => {
      controller.abort()
    })
    createClient.mockReturnValue(asFalClient(client))
    await expect(
      getFalQueuedImageResult(createDefaultFalProfile(), 'model', 'remote', DEFAULT_PARAMS, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(client.queue.result).not.toHaveBeenCalled()
  })

  it('isolates the client for each concurrent submission and recovery', async () => {
    const a = mockClient('YQ==')
    const b = mockClient('Yg==')
    const recovery = mockClient('Yw==')
    createClient.mockImplementation((config) =>
      asFalClient(config?.credentials === 'a' ? a : config?.credentials === 'b' ? b : recovery),
    )
    const opts = { settings: DEFAULT_SETTINGS, prompt: 'prompt', params: DEFAULT_PARAMS, inputImageDataUrls: [] }
    const [resultA, resultB, resultRecovered] = await Promise.all([
      callFalAiImageApi(opts, createDefaultFalProfile({ apiKey: 'a', model: 'owner/model-a' })),
      callFalAiImageApi(opts, createDefaultFalProfile({ apiKey: 'b', model: 'owner/model-b' })),
      getFalQueuedImageResult(createDefaultFalProfile({ apiKey: 'r' }), 'owner/model-r', 'request-r', DEFAULT_PARAMS),
    ])

    expect(a.subscribe).toHaveBeenCalledWith('owner/model-a', expect.anything())
    expect(b.subscribe).toHaveBeenCalledWith('owner/model-b', expect.anything())
    expect(recovery.queue.subscribeToStatus).toHaveBeenCalledWith('owner/model-r', {
      requestId: 'request-r',
      logs: true,
    })
    expect(recovery.queue.result).toHaveBeenCalledWith('owner/model-r', { requestId: 'request-r' })
    expect([resultA, resultB, resultRecovered].map(({ images }) => images[0].split(',')[1])).toEqual([
      'YQ==',
      'Yg==',
      'Yw==',
    ])
  })
})
