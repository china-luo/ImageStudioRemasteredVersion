import { afterEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { createLocalVocSummary, parseReviewsCsv, parseReviewsXlsx, renderVocDashboardHtml } from './vocAmazonReviewsApi'

function workbookBytes(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Reviews')
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

describe('local VOC analysis', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('imports quoted CSV and discards rows with no valid review body', () => {
    const envelope = parseReviewsCsv(
      `title,rating,body,date
"Great, compact",5,"Works great, easy to use",2026-01-01
Bad,1,"Broke after two days and packaging was damaged",2026-01-02
Empty,5,,2026-01-03`,
      'paste',
    )
    expect(envelope.meta).toMatchObject({
      source: 'paste',
      rowsInFile: 3,
      rowsUsed: 2,
      rowsDropped: 1,
      columnsDetected: { body: 'body' },
    })
    expect(envelope.reviews[0]).toMatchObject({
      title: 'Great, compact',
      rating: 5,
      body: 'Works great, easy to use',
      date: '2026-01-01',
    })
    expect(() => parseReviewsCsv('title,rating,body\nToo short,1,x')).toThrow('没有可用的有效评论')
    expect(() => parseReviewsCsv('body\n"No closing quote')).toThrow('未闭合的引号')
  })

  it('accepts pasted Excel cells and uses the review body rather than the title or ID', () => {
    const envelope = parseReviewsCsv(
      'review_id\treview_title\tstar rating\treview_text\r\nID01\t满意\t5.0 out of 5 stars\t"做工不错\n外观好看"',
      'paste',
    )
    expect(envelope.reviews[0]).toMatchObject({ title: '满意', rating: 5, body: '做工不错\n外观好看' })
  })

  it('parses, analyzes, and exports XLSX without calling fetch', () => {
    const fetchMock = vi.fn(() => {
      throw new Error('网络不可用')
    })
    vi.stubGlobal('fetch', fetchMock)
    const envelope = parseReviewsXlsx(
      workbookBytes([
        ['标题', '评分', '内容', '日期'],
        ['Great', 5, 'Works great and feels sturdy', '2026-01-01'],
        ['Bad', 1, 'Broke quickly after delivery <example>', '2026-01-02'],
        ['Empty', 5, '', '2026-01-03'],
      ]),
    )
    expect(envelope.meta).toMatchObject({ source: 'xlsx', rowsUsed: 2, rowsDropped: 1 })
    expect(envelope.reviews[1]).toMatchObject({ title: 'Bad', rating: 1, date: '2026-01-02' })
    const summary = createLocalVocSummary(envelope)
    expect(summary.ratings).toEqual({ high: 1, medium: 0, low: 1, unrated: 0 })
    expect(summary.lowRatingTopics[0]).toMatchObject({ label: '质量或耐用性', count: 1 })
    expect(summary.highRatingTopics[0]).toMatchObject({ label: '质量或耐用性', count: 1 })
    const html = renderVocDashboardHtml('<SKU>', summary)
    expect(html).toContain('&lt;SKU&gt;')
    expect(html).toContain('&lt;example&gt;')
    expect(html).not.toContain('<example>')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps invalid and missing ratings separate and does not label a topic as sentiment', () => {
    const envelope = parseReviewsCsv(
      'rating,body\n,Good value for the price\n0,Not rated\n6,Invalid score\n3,Just okay\n5,Not durable after all',
    )
    const summary = createLocalVocSummary(envelope)
    expect(summary.ratings).toEqual({ high: 1, medium: 1, low: 0, unrated: 3 })
    expect(summary.lowRatingTopics).toEqual([])
    expect(summary.otherTopics[0]).toMatchObject({ label: '价格或性价比', count: 1 })
    expect(summary.highRatingTopics[0]).toEqual({ label: '质量或耐用性', count: 1, quote: 'Not durable after all' })
  })
})
