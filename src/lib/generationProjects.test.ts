import { afterEach, describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import {
  canSelectProjectFinal,
  collectProjectImageIds,
  createGenerationProject,
  persistableProjectWorkspace,
  projectFinalEntries,
  projectSlotId,
  projectTasks,
  ACTIVE_PROJECT_KEY,
  readActiveProjectId,
  rememberActiveProject,
} from './generationProjects'
import { buildProjectArchive } from './projectExport'
import { collectReferencedImageIds } from './taskImageReferences'

const task = (projectId: string, overrides: Partial<TaskRecord> = {}): TaskRecord => ({
  id: 'task-1',
  category: {
    projectId,
    projectSlotId: 'slot-1',
    productTitle: '同名商品',
    amazonSlot: 'MAIN',
    workflow: 'amazon-listing',
  },
  prompt: 'A mug',
  params: DEFAULT_PARAMS,
  inputImageIds: [],
  outputImages: ['image-1'],
  status: 'done',
  error: null,
  createdAt: 1,
  finishedAt: 2,
  elapsed: 1,
  ...overrides,
})

describe('generation projects', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('restores the desktop project after a new session and clears it on reset', () => {
    const durable = new Map<string, string>(),
      session = new Map<string, string>()
    const storage = (data: Map<string, string>) => ({
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    })
    vi.stubGlobal('window', { imageStudioDesktop: { isDesktop: true } })
    vi.stubGlobal('sessionStorage', storage(session))
    vi.stubGlobal('localStorage', storage(durable))
    rememberActiveProject('saved-project')
    session.clear()
    expect(readActiveProjectId()).toBe('saved-project')
    rememberActiveProject(null)
    expect(readActiveProjectId()).toBeNull()
    expect(durable.has(ACTIVE_PROJECT_KEY)).toBe(false)
  })

  it('keeps new browser tabs independent of a durable desktop selection', () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: vi.fn() })
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { getItem: () => 'another-window-project', setItem })
    expect(readActiveProjectId()).toBeNull()
    rememberActiveProject('this-tab')
    expect(setItem).not.toHaveBeenCalled()
  })

  it('isolates same-title projects and ignores unassociated legacy tasks', () => {
    const a = createGenerationProject(),
      b = createGenerationProject()
    expect(a.id).not.toBe(b.id)
    const tasks = [
      task(a.id),
      task(b.id, { id: 'other' }),
      task(a.id, { id: 'legacy', category: { productTitle: '同名商品', amazonSlot: 'MAIN' } }),
    ]
    a.name = 'Renamed'
    expect(projectTasks(tasks, a.id).map((item) => item.id)).toEqual(['task-1'])
    expect(projectTasks(tasks, a.id, 'different-slot')).toEqual([])
  })

  it('keeps slot identity across title/prompt edits, separates replans, marketplaces and A+ types', () => {
    const workspace = createGenerationProject().workspace
    const slot = projectSlotId(workspace, 'MAIN')
    workspace.draft.productTitle = 'New title'
    workspace.promptOverrides = { 'listing:0:MAIN': 'Edited' }
    expect(projectSlotId(workspace, 'MAIN')).toBe(slot)
    expect(projectSlotId({ ...workspace, currentPlannerSessionId: 'new-plan' }, 'MAIN')).not.toBe(slot)
    expect(projectSlotId({ ...workspace, marketplaceId: 'de' }, 'MAIN')).not.toBe(slot)
    expect(projectSlotId({ ...workspace, plannerMode: 'aplus', aPlusType: 'standard' }, 'A1')).not.toBe(
      projectSlotId({ ...workspace, plannerMode: 'aplus', aPlusType: 'premium' }, 'A1'),
    )
  })

  it('retains all project image references while excluding image bytes from the workspace', () => {
    const project = createGenerationProject()
    project.referenceImageIds = ['ref']
    project.workspace.styleImages = [{ candidateIndex: 0, status: 'done', imageId: 'style', dataUrl: 'huge-bytes' }]
    project.finals = { slot: { taskId: 'deleted-task', imageId: 'final' } }
    expect(collectProjectImageIds(project)).toEqual(['ref', 'style', 'final'])
    expect(collectReferencedImageIds({ generationProjects: [project] })).toEqual(new Set(['ref', 'style', 'final']))
    expect(JSON.stringify(persistableProjectWorkspace(project.workspace))).not.toContain('huge-bytes')
  })

  it('accepts only a completed output belonging to this project', () => {
    const project = createGenerationProject(),
      result = task(project.id)
    expect(canSelectProjectFinal(project, result, 'image-1')).toBe(true)
    expect(canSelectProjectFinal(project, result, 'foreign-image')).toBe(false)
    expect(canSelectProjectFinal(project, { ...result, status: 'running' }, 'image-1')).toBe(false)
    expect(canSelectProjectFinal(project, task('other-project'), 'image-1')).toBe(false)
    project.finals = { 'slot-1': { taskId: result.id, imageId: 'image-1' } }
    expect(projectFinalEntries(project, [result])).toHaveLength(1)
    expect(() => projectFinalEntries(project, [])).toThrow('重新选择')
  })

  it('exports only selected finals with slot filenames and a traceable manifest', async () => {
    const project = createGenerationProject()
    project.name = 'Travel/Mug'
    const selected = task(project.id),
      unselected = task(project.id, { id: 'task-2', outputImages: ['image-2'] })
    project.finals = { 'slot-1': { taskId: selected.id, imageId: 'image-1' } }
    const requested: string[] = []
    const archive = await buildProjectArchive(project, [selected, unselected, task('other')], async (id) => {
      requested.push(id)
      return 'data:image/png;base64,AQID'
    })
    const files = unzipSync(archive.bytes)
    expect(requested).toEqual(['image-1'])
    expect(archive.fileName).toBe('Travel_Mug_定稿.zip')
    expect(Object.keys(files)).toEqual(['01_amazon-listing_MAIN.png', 'manifest.json'])
    expect(JSON.parse(strFromU8(files['manifest.json']))).toMatchObject({
      projectId: project.id,
      images: [{ taskId: selected.id, imageId: 'image-1' }],
    })
    await expect(buildProjectArchive(project, [selected], async () => undefined)).rejects.toThrow('丢失')
  })
})
