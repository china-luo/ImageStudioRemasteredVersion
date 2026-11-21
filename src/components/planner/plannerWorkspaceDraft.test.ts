import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createEmptyPlannerWorkspace,
  PLANNER_WORKSPACE_KEY,
  readPlannerWorkspaceDraft,
  savePlannerWorkspaceDraft,
} from './plannerWorkspaceDraft'

describe('planner workspace recovery', () => {
  let items: Map<string, string>
  beforeEach(() => {
    items = new Map()
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps unfinished input independently of planner history', () => {
    const draft = { ...createEmptyPlannerWorkspace(), listingText: 'Unsaved mug listing', resolution: '4k' as const }
    savePlannerWorkspaceDraft(draft)
    expect(readPlannerWorkspaceDraft()).toEqual(draft)
    expect(readPlannerWorkspaceDraft().currentPlannerSessionId).toBeNull()
  })

  it('keeps edited prompts, selected plans and completed style image IDs without image bytes', () => {
    const draft = createEmptyPlannerWorkspace()
    draft.currentPlannerSessionId = 'session-1'
    draft.selectedPlanIndex = 0
    draft.selectedStyleIndex = 0
    draft.promptOverrides = { 'listing:0:MAIN': 'Edited prompt' }
    draft.actionProgress = { 'listing:0:MAIN': 'submitted' }
    draft.imagePlans = [{ slot: 'MAIN', label: '主图', prompt: 'Mug', negativePrompt: '', planMarkdown: 'White mug' }]
    draft.styleImages = [{ candidateIndex: 0, status: 'done', imageId: 'style-1', dataUrl: 'large-image-bytes' }]
    savePlannerWorkspaceDraft(draft)
    expect(items.get(PLANNER_WORKSPACE_KEY)).not.toContain('large-image-bytes')
    expect(readPlannerWorkspaceDraft()).toEqual({
      ...draft,
      styleImages: [{ candidateIndex: 0, status: 'done', imageId: 'style-1' }],
    })
  })

  it('restores interrupted styles as stopped instead of showing an endless running state', () => {
    const draft = createEmptyPlannerWorkspace()
    draft.styleImages = [{ candidateIndex: 0, status: 'running' }]
    savePlannerWorkspaceDraft(draft)
    expect(readPlannerWorkspaceDraft().styleImages[0]).toMatchObject({ status: 'stopped' })
  })

  it.each(['invalid JSON', 'null', '{"listingText":"old"}', '{"styleImages":null}'])(
    'handles corrupted or incomplete storage: %s',
    (raw) => {
      items.set(PLANNER_WORKSPACE_KEY, raw)
      expect(readPlannerWorkspaceDraft()).toEqual(createEmptyPlannerWorkspace())
    },
  )

  it('allows the caller to report storage failure while initial loading remains usable', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('Storage blocked')
      },
      setItem: () => {
        throw new Error('Quota exceeded')
      },
    })
    expect(readPlannerWorkspaceDraft()).toEqual(createEmptyPlannerWorkspace())
    expect(() => savePlannerWorkspaceDraft(createEmptyPlannerWorkspace())).toThrow('Quota exceeded')
  })

  it('persists an intentional clear instead of resurrecting the previous plan', () => {
    savePlannerWorkspaceDraft({ ...createEmptyPlannerWorkspace(), listingText: 'Old listing' })
    savePlannerWorkspaceDraft(createEmptyPlannerWorkspace())
    expect(readPlannerWorkspaceDraft().listingText).toBe('')
  })
})
