import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import {
  UNCATEGORIZED_PRODUCT_FILTER,
  getTaskHistoryCategory,
  getTaskProductFilterOptions,
  getWorkflowLabel,
  matchesTaskHistoryFilters,
} from './taskHistory'

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: 'Create a professional Amazon product listing image.\n\nProduct facts:\n- Product title: Large Folding Umbrella\n',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
    ...overrides,
  }
}

describe('task history categories', () => {
  it('uses explicit Amazon Listing metadata when present', () => {
    const category = getTaskHistoryCategory(task({
      category: {
        productTitle: 'Large Folding Umbrella',
        workflow: 'amazon-listing',
        amazonSlot: 'MAIN',
      },
    }))

    expect(category).toMatchObject({
      productTitle: 'Large Folding Umbrella',
      workflow: 'amazon-listing',
      amazonSlot: 'MAIN',
      aspect: 'square',
    })
  })

  it('uses explicit A+ metadata and detects landscape size', () => {
    const category = getTaskHistoryCategory(task({
      prompt: 'Create A+ module for the product.\n\nA+ module requirements:\n- Final Seller Central recommended upload size: 970x300px.',
      params: { ...DEFAULT_PARAMS, size: '3536x1184' },
      category: {
        productTitle: 'LED Desk Lamp',
        workflow: 'amazon-aplus',
        amazonSlot: 'A+S01',
        aPlusType: 'standard',
      },
    }))

    expect(category).toMatchObject({
      productTitle: 'LED Desk Lamp',
      workflow: 'amazon-aplus',
      amazonSlot: 'A+S01',
      aPlusType: 'standard',
      aspect: 'landscape',
    })
  })

  it('infers product and workflow from legacy prompts', () => {
    const category = getTaskHistoryCategory(task())

    expect(category.productTitle).toBe('Large Folding Umbrella')
    expect(category.workflow).toBe('amazon-listing')
  })

  it('keeps tasks without product title under the uncategorized product filter', () => {
    expect(matchesTaskHistoryFilters(task({
      prompt: 'A regular creative prompt',
      category: { workflow: 'gallery' },
    }), {
      searchQuery: '',
      filterStatus: 'all',
      filterFavorite: false,
      filterProductTitle: UNCATEGORIZED_PRODUCT_FILTER,
      filterWorkflow: 'all',
      filterAspect: 'all',
    })).toBe(true)
  })

  it('combines product, workflow, aspect, status, favorite, and text filters', () => {
    const record = task({
      prompt: 'Create a premium Amazon A+ hero banner for a desk lamp.',
      params: { ...DEFAULT_PARAMS, size: '3536x1184' },
      isFavorite: true,
      category: {
        productTitle: 'LED Desk Lamp',
        workflow: 'amazon-aplus',
        amazonSlot: 'A+P01',
        aPlusType: 'premium',
      },
    })

    expect(matchesTaskHistoryFilters(record, {
      searchQuery: 'hero',
      filterStatus: 'done',
      filterFavorite: true,
      filterProductTitle: 'LED Desk Lamp',
      filterWorkflow: 'amazon-aplus',
      filterAspect: 'landscape',
    })).toBe(true)

    expect(matchesTaskHistoryFilters(record, {
      searchQuery: 'hero',
      filterStatus: 'done',
      filterFavorite: true,
      filterProductTitle: 'LED Desk Lamp',
      filterWorkflow: 'amazon-listing',
      filterAspect: 'landscape',
    })).toBe(false)
  })

  it('filters and labels TikTok main and detail image tasks', () => {
    const mainRecord = task({
      prompt: 'TikTok main image prompt',
      category: {
        productTitle: 'Travel Mug',
        workflow: 'tiktok-main',
        platform: 'tiktok',
        tiktokDesignType: 'main',
      },
    })
    const detailRecord = task({
      prompt: 'TikTok detail image prompt',
      params: { ...DEFAULT_PARAMS, size: '1536x2048' },
      category: {
        productTitle: 'Travel Mug',
        workflow: 'tiktok-detail',
        platform: 'tiktok',
        tiktokDesignType: 'detail',
      },
    })

    expect(getWorkflowLabel('tiktok-main')).toBe('TikTok 商品主图')
    expect(getWorkflowLabel('tiktok-detail')).toBe('TikTok 商品详情图')
    expect(getTaskHistoryCategory(detailRecord)).toMatchObject({
      workflow: 'tiktok-detail',
      aspect: 'portrait',
    })
    expect(matchesTaskHistoryFilters(mainRecord, {
      searchQuery: '',
      filterStatus: 'all',
      filterFavorite: false,
      filterProductTitle: '',
      filterWorkflow: 'tiktok-main',
      filterAspect: 'all',
    })).toBe(true)
    expect(matchesTaskHistoryFilters(detailRecord, {
      searchQuery: '',
      filterStatus: 'all',
      filterFavorite: false,
      filterProductTitle: '',
      filterWorkflow: 'tiktok-main',
      filterAspect: 'all',
    })).toBe(false)
  })

  it('sorts product filter options by most recent task', () => {
    const options = getTaskProductFilterOptions([
      task({ id: 'old-lamp', createdAt: 1, category: { productTitle: 'LED Desk Lamp', workflow: 'amazon-aplus' } }),
      task({ id: 'umbrella', createdAt: 3, category: { productTitle: 'Large Folding Umbrella', workflow: 'amazon-listing' } }),
      task({ id: 'new-lamp', createdAt: 5, category: { productTitle: 'LED Desk Lamp', workflow: 'amazon-listing' } }),
    ])

    expect(options.map((option) => [option.label, option.count])).toEqual([
      ['LED Desk Lamp', 2],
      ['Large Folding Umbrella', 1],
    ])
  })
})

