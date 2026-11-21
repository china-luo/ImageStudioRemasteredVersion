import { describe, expect, it } from 'vitest'
import { assertVocHasValidReviews, extractEnglishImagePrompt, VOC_NO_VALID_REVIEWS_ERROR } from './workspaceDrafts'

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

  it('rejects empty VOC review envelopes before AI analysis', () => {
    expect(() => assertVocHasValidReviews(null)).toThrow(VOC_NO_VALID_REVIEWS_ERROR)
    expect(() => assertVocHasValidReviews({ reviews: [] })).toThrow(VOC_NO_VALID_REVIEWS_ERROR)
    expect(() => assertVocHasValidReviews({ reviews: [{ body: 'Great bottle, no leaks.' }] })).not.toThrow()
  })
})
