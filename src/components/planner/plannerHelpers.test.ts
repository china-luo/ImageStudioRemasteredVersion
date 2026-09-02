import { describe, expect, it } from 'vitest'
import { DEFAULT_AMAZON_PROMPT_DRAFT } from '../../lib/amazonPrompt'
import {
  createPlannerSessionSnapshot,
  getAmazonListingPlannerChecks,
  getPlanSummary,
  getPlannerActionKey,
} from './plannerHelpers'

describe('plannerHelpers', () => {
  it('builds listing compliance checks without the planner DOM', () => {
    const checks = getAmazonListingPlannerChecks(
      { ...DEFAULT_AMAZON_PROMPT_DRAFT, productTitle: 'Travel mug' },
      '2048x2048',
      2,
      true,
      true,
    )
    expect(checks.find((item) => item.label === '商品名称')?.status).toBe('ready')
    expect(checks.find((item) => item.label === '风格板')?.status).toBe('ready')
  })

  it('derives action keys and plan summaries', () => {
    expect(getPlannerActionKey('listing', 0, 'MAIN')).toBe('listing:0:MAIN')
    expect(getPlanSummary('## 主图\n白底产品')).toBe('主图')
  })

  it('creates a serializable planner session without component state or DOM', () => {
    const session = createPlannerSessionSnapshot(
      {
        currentPlannerSessionId: null,
        draft: { ...DEFAULT_AMAZON_PROMPT_DRAFT, productTitle: 'Travel mug' },
        listingText: 'Travel mug listing',
        plannerPlatform: 'amazon',
        marketplaceId: 'us',
        tiktokDesignType: 'main',
        plannerMode: 'listing',
        aPlusType: 'standard-large',
        aPlusModuleSpecsByType: {},
        resolution: '2k',
        referenceImageIds: ['ref-1'],
        seriesStyleGuides: { listing: 'guide', aplus: '', tiktokMain: '', tiktokDetail: '' },
        styleCandidates: [],
        styleImages: [{ candidateIndex: 0, status: 'done', imageId: 'style-1' }],
        selectedStyleIndex: 0,
        styleDensityMode: 'rich',
        imagePlans: [],
        aPlusPlans: [],
        selectedPlanIndex: 0,
        selectedAPlusPlanIndex: null,
      },
      {},
      100,
    )

    expect(session.id).toMatch(/^amazon-planner-/)
    expect(session.title).toBe('Travel mug')
    expect(session.referenceImageIds).toEqual(['ref-1'])
    expect(session.styleImages).toEqual([{ candidateIndex: 0, imageId: 'style-1' }])
    expect(session.createdAt).toBe(100)
  })
})
