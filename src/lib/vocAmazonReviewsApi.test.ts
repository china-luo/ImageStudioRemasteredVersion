import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalVocSummary, fetchShulexReviews, normalizeVocMarket, parseReviewsCsv } from './vocAmazonReviewsApi'

describe('VOC Amazon reviews helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('normalizes supported Amazon market aliases', () => {
    expect(normalizeVocMarket('amazon.com')).toBe('US')
    expect(normalizeVocMarket('uk')).toBe('GB')
    expect(normalizeVocMarket('de')).toBe('DE')
    expect(() => normalizeVocMarket('BR')).toThrow()
  })

  it('parses pasted review CSV with quoted commas and detected columns', () => {
    const envelope = parseReviewsCsv(`title,rating,body,date
"Great, compact",5,"Works great, easy to use",2026-01-01
Bad,1,"Broke after two days and packaging was damaged",2026-01-02
Empty,5,,2026-01-03`, 'paste')

    expect(envelope.meta.source).toBe('paste')
    expect(envelope.meta.rowsInFile).toBe(3)
    expect(envelope.meta.rowsUsed).toBe(2)
    expect(envelope.meta.rowsDropped).toBe(1)
    expect(envelope.meta.columnsDetected?.body).toBe('body')
    expect(envelope.reviews[0]).toMatchObject({
      title: 'Great, compact',
      rating: 5,
      body: 'Works great, easy to use',
      date: '2026-01-01',
    })
  })

  it('creates a local summary with sentiment, pain points, and selling points', () => {
    const envelope = parseReviewsCsv(`title,rating,body,date
Great,5,Works great and very easy to use,2026-01-01
Bad,1,Broke after two days and packaging was damaged,2026-01-02
Good,4,Good value and sturdy design,2026-01-03`, 'csv')

    const summary = createLocalVocSummary(envelope)

    expect(summary.sentiment).toEqual({ positive: 67, neutral: 0, negative: 33 })
    expect(summary.painPoints.some((item) => item.count > 0)).toBe(true)
    expect(summary.sellingPoints.some((item) => item.count > 0)).toBe(true)
    expect(summary.summary).toContain('3')
  })

  it('fetches Shulex review pages and records response diagnostics', async () => {
    const pageOneReviews = Array.from({ length: 10 }, (_, index) => ({
      rating: 5,
      title: `Good ${index + 1}`,
      body: `Review body ${index + 1}`,
      reviewId: `r${index + 1}`,
    }))
    const pageTwoReviews = [{
      rating: 4,
      title: 'Good 11',
      body: 'Review body 11',
      reviewId: 'r11',
    }]

    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url)
      if (href.includes('RtTask01')) {
        return new Response(JSON.stringify({ code: 0, data: { taskId: 'task-1' } }))
      }
      const pageNo = new URL(href).searchParams.get('pageNo')
      return new Response(JSON.stringify({
        code: 0,
        data: {
          status: 'SUCCESS',
          asin: 'B0DFC2G8NG',
          market: 'US',
          total: 11,
          reviews: pageNo === '2' ? pageTwoReviews : pageOneReviews,
        },
      }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const envelope = await fetchShulexReviews({
      asin: 'B0DFC2G8NG',
      market: 'US',
      limit: 100,
      apiKey: 'test-key',
    })

    expect(envelope.reviews).toHaveLength(11)
    expect(envelope.meta.totalAvailable).toBe(11)
    expect(envelope.meta.pagesFetched).toBe(2)
    expect(envelope.meta.diagnostics?.reviewArrayPath).toBe('data.reviews')
    expect(envelope.meta.diagnostics?.pages?.map((page) => page.rawReviewCount)).toEqual([10, 1])
  })

  it('caps Shulex realtime maxPage at the API limit', async () => {
    let submitMaxPage: unknown = null
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url)
      if (href.includes('RtTask01')) {
        submitMaxPage = (JSON.parse(String(init?.body)) as Record<string, unknown>).maxPage
        return new Response(JSON.stringify({ code: 0, data: { taskId: 'task-1' } }))
      }
      return new Response(JSON.stringify({
        code: 0,
        data: {
          status: 'SUCCESS',
          asin: 'B0DFC2G8NG',
          market: 'US',
          total: 1,
          reviews: [{ rating: 5, title: 'Good', body: 'Review body', reviewId: 'r1' }],
        },
      }))
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchShulexReviews({
      asin: 'B0DFC2G8NG',
      market: 'US',
      limit: 1000,
      apiKey: 'test-key',
    })

    expect(submitMaxPage).toBe(10)
  })

})
