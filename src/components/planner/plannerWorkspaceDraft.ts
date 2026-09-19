import { DEFAULT_AMAZON_PROMPT_DRAFT } from '../../lib/amazonPrompt'
import { DEFAULT_AMAZON_MARKETPLACE_ID } from '../../lib/amazonMarketplaces'
import type { PlannerControllerSnapshot } from './useAmazonPlannerController'
import type { PlannerActionProgressMap, PromptEditorState } from './plannerHelpers'

export const PLANNER_WORKSPACE_KEY = 'amazon-image-studio:planner-workspace:v1'

// Input images already belong to the persisted gallery draft. Keep this tab's
// planner separate from history, including work that has never been submitted.
export type PlannerWorkspaceDraft = Omit<PlannerControllerSnapshot, 'plannerSessions' | 'referenceImageIds'> & {
  actionProgress: PlannerActionProgressMap
  promptOverrides: Record<string, string>
  promptEditor: PromptEditorState | null
  batchSelectedIndexes: number[]
  plannerError: string
  styleError: string
}

export function createEmptyPlannerWorkspace(): PlannerWorkspaceDraft {
  return {
    currentPlannerSessionId: null,
    draft: { ...DEFAULT_AMAZON_PROMPT_DRAFT },
    listingText: '',
    plannerPlatform: 'amazon',
    marketplaceId: DEFAULT_AMAZON_MARKETPLACE_ID,
    tiktokDesignType: 'main',
    plannerMode: 'listing',
    aPlusType: 'standard-large',
    aPlusModuleSpecsByType: {},
    resolution: '2k',
    seriesStyleGuides: { listing: '', aplus: '', tiktokMain: '', tiktokDetail: '' },
    styleCandidates: [],
    styleImages: [],
    selectedStyleIndex: null,
    styleDensityMode: 'rich',
    imagePlans: [],
    aPlusPlans: [],
    selectedPlanIndex: null,
    selectedAPlusPlanIndex: null,
    actionProgress: {},
    promptOverrides: {},
    promptEditor: null,
    batchSelectedIndexes: [],
    plannerError: '',
    styleError: '',
  }
}

export function readPlannerWorkspaceDraft(): PlannerWorkspaceDraft {
  const empty = createEmptyPlannerWorkspace()
  try {
    const stored = sessionStorage.getItem(PLANNER_WORKSPACE_KEY)
    if (!stored) return empty
    const value = JSON.parse(stored)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return empty
    // Reject broken snapshots before React renders nested objects and arrays.
    for (const [key, fallback] of Object.entries(empty)) {
      const field = value[key]
      if (fallback === null) continue
      if (Array.isArray(fallback)) {
        if (!Array.isArray(field)) return empty
      } else if (typeof fallback === 'object') {
        if (!field || typeof field !== 'object' || Array.isArray(field)) return empty
        for (const [nestedKey, nestedValue] of Object.entries(fallback)) {
          if (typeof field[nestedKey] !== typeof nestedValue) return empty
        }
      } else if (typeof field !== typeof fallback) return empty
    }
    return {
      ...empty,
      ...value,
      styleImages: value.styleImages.map((image: PlannerWorkspaceDraft['styleImages'][number]) => ({
        ...image,
        // A reload cannot resume the old JavaScript request.
        ...(image.status === 'running' ? { status: 'stopped', error: '页面重新加载，风格板生成已中断，请重试。' } : {}),
      })),
    }
  } catch {
    return empty
  }
}

export function savePlannerWorkspaceDraft(draft: PlannerWorkspaceDraft): void {
  sessionStorage.setItem(
    PLANNER_WORKSPACE_KEY,
    JSON.stringify({
      ...draft,
      // Image bytes live in IndexedDB; duplicating them would exhaust storage.
      styleImages: draft.styleImages.map(({ dataUrl: _dataUrl, ...image }) => image),
    }),
  )
}
