import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOpenAIProfile } from './apiProfiles'
import {
  createLlmAuthHeaders,
  extractLlmText,
  postLlmRequest,
  readLlmResponseText,
  resolveLlmModel,
  resolveLlmRequestUrl,
} from './llmTransport'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('llmTransport', () => {
  it('builds chat and responses URLs from the same profile', () => {
    const profile = createDefaultOpenAIProfile({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'k',
      apiProxy: false,
    })
    expect(resolveLlmRequestUrl(profile, true)).toBe('https://api.openai.com/v1/chat/completions')
    expect(resolveLlmRequestUrl({ ...profile, apiMode: 'responses' }, false)).toBe(
      'https://api.openai.com/v1/responses',
    )
    expect(createLlmAuthHeaders('secret-key')).toEqual({
      Authorization: 'Bearer secret-key',
      'Content-Type': 'application/json',
    })
    expect(resolveLlmModel({ ...profile, model: '', apiMode: 'chat' }, true)).toBeTruthy()
  })

  it('extracts chat and responses text without copying provider-specific parsers', () => {
    expect(
      extractLlmText(
        {
          choices: [{ message: { content: 'chat result' } }],
        },
        true,
      ),
    ).toBe('chat result')
    expect(
      extractLlmText(
        {
          output_text: 'responses result',
        },
        false,
      ),
    ).toBe('responses result')
  })

  it('posts JSON through fetch and reads a chat completion payload', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'hello from transport' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const profile = createDefaultOpenAIProfile({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      apiMode: 'chat',
      apiProxy: false,
    })
    const response = await postLlmRequest({
      profile,
      body: { model: 'gpt-test', messages: [] },
    })
    await expect(readLlmResponseText(response, true, { emptyError: 'empty' })).resolves.toBe('hello from transport')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/chat/completions')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key')
  })
})
