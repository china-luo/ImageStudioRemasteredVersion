import { describe, expect, it } from 'vitest'
import { buildPlannerImageRequest, getPlannerSourceIssue, type PlannerSource } from './plannerImageRequest'
import { buildAmazonStyleCandidatePrompt } from './listingPlanner'
import type { AmazonMarketplaceId } from './amazonMarketplaces'

const base: Parameters<typeof buildPlannerImageRequest>[0] = {
  platform: 'amazon',
  mode: 'listing',
  plan: { slot: 'PT01', prompt: 'Show the approved product.', negativePrompt: 'No watermarks.' },
  marketplaceId: 'de',
  styleDensityMode: 'rich',
  seriesStyleGuide: 'Preserve product proportions.',
  styleImageId: 'style',
  inputImages: [{ id: 'product' }],
}

const languages: Array<[AmazonMarketplaceId, string]> = [
  ['de', 'German'],
  ['jp', 'Japanese'],
  ['fr', 'French'],
  ['it', 'Italian'],
  ['es', 'Spanish'],
]

describe('final planner requests', () => {
  it.each(languages)('uses only the chosen visible-copy language for %s', (marketplaceId, language) => {
    for (const mode of ['listing', 'aplus'] as const) {
      for (const styleDensityMode of ['rich', 'minimal'] as const) {
        const request = buildPlannerImageRequest({ ...base, marketplaceId, mode, styleDensityMode })
        expect(request.prompt).toContain(`natural ${language}`)
        expect(request.prompt).toContain('copy in the target marketplace language')
        expect(request.prompt).not.toContain('US-English')
      }
    }
  })

  it('builds MAIN with authoritative white and no-added-text rules even with an override', () => {
    const request = buildPlannerImageRequest({
      ...base,
      plan: { ...base.plan, slot: 'MAIN' },
      override: 'Add a headline.',
    })
    expect(request.prompt).toMatch(/^Mandatory Amazon MAIN image rules \(override conflicting/)
    expect(request.prompt).toContain('RGB 255,255,255')
    expect(request.prompt).toContain('85%')
    expect(request.prompt).toContain('Do not add any overlay text')
    expect(request.prompt).not.toContain('Layout density:')
    expect(request.ids).toEqual(['product'])
  })

  it('updates layout and style wording for manually edited legacy text and keeps reference indices', () => {
    const legacy = [
      'Show the lid closed.',
      'Layout density:\n- Use information-rich US-English copy.',
      'Negative prompt:\nNo extra lids.',
      'Style reference rule:\n- The last input image is a hidden style reference.',
    ].join('\n\n')
    const request = buildPlannerImageRequest({
      ...base,
      styleDensityMode: 'minimal',
      inputImages: [{ id: 'style' }, { id: 'product' }],
      override: legacy,
    })
    expect(request.ids).toEqual(['style', 'product'])
    expect(request.styleIndex).toBe(0)
    expect(request.prompt).toContain('Input image 1 is a hidden style reference')
    expect(request.prompt).toContain('Show the lid closed.')
    expect(request.prompt).toContain('refined minimal Amazon layout')
    expect(request.prompt).toContain('Negative prompt:\nNo extra lids.')
    expect(request.prompt).not.toContain('US-English')
    expect(request.prompt).not.toContain('The last input image')
  })

  it('preserves TikTok first-image rules and attaches the selected style board', () => {
    const request = buildPlannerImageRequest({
      ...base,
      platform: 'tiktok',
      plan: { ...base.plan, slot: 'TTM01' },
      override: 'Show the front.\n\nNegative prompt:\nNo logos.',
    })
    expect(request.prompt).toMatch(/^Mandatory TikTok Shop US main image generation rules \(override conflicting/)
    expect(request.prompt).toContain('one small real brand-name mark or real brand logo')
    expect(request.ids).toEqual(['product', 'style'])
    expect(request.styleIndex).toBe(1)
  })

  it('blocks changed facts, missing references, additions and changes to image order', () => {
    const source: PlannerSource = { listingText: 'The real product', referenceImageIds: ['front', 'back'] }
    expect(getPlannerSourceIssue(source, 'The real product', ['front', 'back'])).toBe('')
    expect(getPlannerSourceIssue(source, 'Other product', ['front', 'back'])).toContain('已变化')
    expect(getPlannerSourceIssue(source, 'The real product', ['back'])).toContain('1 张参考图')
    expect(getPlannerSourceIssue(source, 'The real product', ['back', 'front'])).toContain('顺序')
    expect(getPlannerSourceIssue(source, 'The real product', ['front', 'back', 'extra'])).toContain('已变化')
  })

  it('does not claim it has product references when the style board has none', () => {
    const candidate = {
      label: 'Test',
      description: 'Test',
      prompt: 'Make a style board.',
      negativePrompt: 'No words, numbers, or icons.',
    }
    const withoutReferences = buildAmazonStyleCandidatePrompt(candidate)
    expect(withoutReferences).toMatch(/^Mandatory style reference board requirements \(override conflicting/)
    expect(withoutReferences).toContain('No product image is attached')
    expect(withoutReferences).not.toContain('from the uploaded product references')
    expect(buildAmazonStyleCandidatePrompt(candidate, '', true)).toContain('from the uploaded product references')
  })
})
