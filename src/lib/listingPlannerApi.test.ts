import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOpenAIProfile } from './apiProfiles'
import { DEFAULT_AMAZON_PROMPT_DRAFT } from './amazonPrompt'
import { callAmazonPlannerApi, callAmazonProductExtractionApi } from './listingPlannerApi'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function createPlannerPayload() {
  return {
    product: {
      title: 'Travel mug',
      category: 'Kitchen',
      brand: '',
      color: 'black',
      material: 'steel',
      audience: 'commuters',
      packageIncludes: 'mug and lid',
    },
    sellingPoints: ['leak resistant'],
    seriesStyleGuide: 'Clean commercial product photography.',
    styleCandidates: Array.from({ length: 3 }, (_, index) => ({
      label: `风格 ${index + 1}`,
      description: '简洁商业风格',
      prompt: 'Clean commercial style board.',
      negativePrompt: 'blur',
    })),
    imagePlans: ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06'].map((slot) => ({
      slot,
      label: slot,
      planMarkdown: `${slot} plan`,
      prompt: `${slot} product image`,
      negativePrompt: 'blur',
    })),
  }
}

describe('Amazon planner API lifecycle', () => {
  it('extracts product fields without requesting image plans', async () => {
    const onStage = vi.fn()
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              product: {
                title: 'Travel mug',
                category: 'Kitchen',
                brand: 'Acme T1',
                color: 'black',
                material: 'stainless steel',
                audience: 'commuters',
                packageIncludes: 'mug and lid',
              },
              sellingPoints: ['leak resistant', 'keeps drinks cold'],
              scene: 'Office desk and commuting use.',
              forbidden: 'Do not add a straw or gift box.',
            }),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const profile = createDefaultOpenAIProfile({ apiMode: 'responses', apiKey: 'test', timeout: 5 })

    const result = await callAmazonProductExtractionApi({
      listingText: 'Travel mug listing',
      profile,
      marketplaceId: 'de',
      onStage,
    })

    expect(result).toEqual({
      productTitle: 'Travel mug',
      category: 'Kitchen',
      brand: 'Acme T1',
      color: 'black',
      material: 'stainless steel',
      audience: 'commuters',
      sellingPoints: 'leak resistant\nkeeps drinks cold',
      packageIncludes: 'mug and lid',
      scene: 'Office desk and commuting use.',
      forbidden: 'Do not add a straw or gift box.',
    })
    expect(onStage.mock.calls).toEqual([['requesting'], ['parsing']])
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body.text.format.name).toBe('commerce_product_information')
    expect(body.instructions).toContain('德国站 (Amazon.de)')
    expect(body.instructions).toContain('Do not return image plans')
  })

  it('reports request and parsing stages', async () => {
    const onStage = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ choices: [{ message: { content: JSON.stringify(createPlannerPayload()) } }] }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
      ),
    )
    const profile = createDefaultOpenAIProfile({ apiMode: 'chat', apiKey: 'test', timeout: 5 })

    const result = await callAmazonPlannerApi({
      listingText: 'Travel mug listing',
      baseDraft: DEFAULT_AMAZON_PROMPT_DRAFT,
      profile,
      onStage,
    })

    expect(result.plans).toHaveLength(7)
    expect(onStage.mock.calls).toEqual([['requesting'], ['parsing']])
  })

  it('stops a stalled request at the configured timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
              once: true,
            })
          }),
      ),
    )
    const profile = createDefaultOpenAIProfile({ apiMode: 'chat', apiKey: 'test', timeout: 2 })
    const request = callAmazonPlannerApi({
      listingText: 'Travel mug listing',
      baseDraft: DEFAULT_AMAZON_PROMPT_DRAFT,
      profile,
    })

    const rejection = expect(request).rejects.toThrow('AI 策划请求超过 2 秒，已自动停止')
    await vi.advanceTimersByTimeAsync(2_000)
    await rejection
  })
})
