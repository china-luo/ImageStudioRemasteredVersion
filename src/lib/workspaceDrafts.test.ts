import { describe, expect, it } from 'vitest'
import { extractEnglishImagePrompt, normalizeVocDraft } from './workspaceDrafts'

describe('SOP / VOC workspace guards', () => {
  it('returns empty when the English prompt chapter is missing', () => {
    expect(extractEnglishImagePrompt('## 1. 图位判断\n这是中文分析，没有英文提示词章节。')).toBe('')
  })

  it('extracts only the English prompt chapter', () => {
    const text = [
      '## 8. 中文说明',
      '不要复制这段。',
      '## 9. English AI Image Prompt',
      'A white-background product photo of a travel mug.',
      '## 10. English Negative Prompt',
      'watermark, logo',
    ].join('\n')
    expect(extractEnglishImagePrompt(text)).toBe('A white-background product photo of a travel mug.')
  })

  it('keeps existing VOC reviews and reports but ignores old online request state', () => {
    const reviewsEnvelope = {
      meta: { source: 'shulex', asin: 'B012345678' },
      reviews: [{ body: 'Good quality', rating: 5, title: '' }],
    }
    const draft = normalizeVocDraft({
      sourceMode: 'asin',
      limit: 100,
      analysisStatus: 'running',
      analysisOperation: 'fetch',
      analysisRequestId: 'old-request',
      error: '旧接口失败',
      aiReport: '旧报告',
      reviewsEnvelope,
    })
    expect(draft).toEqual({
      productName: '',
      csvText: '',
      archivedReport: '旧报告',
      reviewsEnvelope,
      error: '',
      updatedAt: 0,
    })
  })
})
