import type { GenerationProject, TaskRecord } from '../types'
import { createEmptyPlannerWorkspace, type PlannerWorkspaceDraft } from '../components/planner/plannerWorkspaceDraft'

export const ACTIVE_PROJECT_KEY = 'amazon-image-studio:active-project:v1'
export const PROJECT_JOURNAL_KEY = 'amazon-image-studio:project-journal:v1'
export const PROJECT_WRITER_KEY = 'amazon-image-studio:project-writer:v1'
export const PROJECT_DATA_EVENT = 'generation-projects-changed'
export const PROJECT_DATA_RESET_EVENT = 'generation-projects-resetting'
export const PROJECT_DATA_IMPORTED_EVENT = 'generation-projects-imported'

// Browser tabs keep independent selections; the desktop window resumes after exit.
export function readActiveProjectId(): string | null {
  const sessionId = sessionStorage.getItem(ACTIVE_PROJECT_KEY)
  if (sessionId) return sessionId
  try {
    return typeof window !== 'undefined' && window.imageStudioDesktop?.isDesktop
      ? localStorage.getItem(ACTIVE_PROJECT_KEY)
      : null
  } catch {
    return null
  }
}

export function rememberActiveProject(id: string | null): void {
  if (id) sessionStorage.setItem(ACTIVE_PROJECT_KEY, id)
  else sessionStorage.removeItem(ACTIVE_PROJECT_KEY)
  try {
    if (typeof window !== 'undefined' && window.imageStudioDesktop?.isDesktop) {
      if (id) localStorage.setItem(ACTIVE_PROJECT_KEY, id)
      else localStorage.removeItem(ACTIVE_PROJECT_KEY)
    }
  } catch {
    // The current session remains usable when durable storage is unavailable.
  }
}

export function readProjectJournal(): GenerationProject | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PROJECT_JOURNAL_KEY) ?? 'null')
    return value &&
      typeof value.id === 'string' &&
      value.workspace &&
      Array.isArray(value.referenceImageIds) &&
      value.finals
      ? value
      : null
  } catch {
    return null
  }
}

export function persistableProjectWorkspace(workspace: PlannerWorkspaceDraft): PlannerWorkspaceDraft {
  return { ...workspace, styleImages: workspace.styleImages.map(({ dataUrl: _dataUrl, ...image }) => image) }
}

export function projectSnapshotSignature(value: unknown): string {
  return JSON.stringify(value, (_key, field) =>
    field && typeof field === 'object' && !Array.isArray(field)
      ? Object.fromEntries(Object.entries(field).sort(([a], [b]) => a.localeCompare(b)))
      : field,
  )
}

// Project and writer identities are local IDs, not credentials. getRandomValues is
// available on HTTP LAN deployments where the secure-context randomUUID API is not.
export function createProjectId(): string {
  if (typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID()
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function createGenerationProject(
  workspace = createEmptyPlannerWorkspace(),
  referenceImageIds: string[] = [],
): GenerationProject {
  const now = Date.now()
  return {
    id: createProjectId(),
    name: workspace.draft.productTitle.trim() || '未命名项目',
    createdAt: now,
    updatedAt: now,
    revision: 0,
    workspace: persistableProjectWorkspace(workspace),
    referenceImageIds,
    finals: {},
  }
}

export function collectProjectImageIds(project: GenerationProject): string[] {
  return [
    ...new Set([
      ...project.referenceImageIds,
      ...project.workspace.styleImages.flatMap((image) => (image.imageId ? [image.imageId] : [])),
      ...Object.values(project.finals).map((final) => final.imageId),
    ]),
  ]
}

// A plan set ID distinguishes re-planning and module changes; titles and list indexes are never identifiers.
export function projectSlotId(
  workspace: Pick<
    PlannerWorkspaceDraft,
    'plannerPlatform' | 'plannerMode' | 'tiktokDesignType' | 'aPlusType' | 'marketplaceId' | 'currentPlannerSessionId'
  >,
  slot: string,
): string {
  return JSON.stringify([
    workspace.plannerPlatform,
    workspace.marketplaceId,
    workspace.plannerPlatform === 'tiktok' ? workspace.tiktokDesignType : workspace.plannerMode,
    workspace.plannerMode === 'aplus' ? workspace.aPlusType : '',
    workspace.currentPlannerSessionId ?? 'draft',
    slot,
  ])
}

export function projectTasks(tasks: TaskRecord[], projectId: string, slotId?: string): TaskRecord[] {
  return tasks
    .filter((task) => task.category?.projectId === projectId && (!slotId || task.category.projectSlotId === slotId))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

export function canSelectProjectFinal(project: GenerationProject, task: TaskRecord, imageId: string): boolean {
  return (
    task.category?.projectId === project.id &&
    Boolean(task.category.projectSlotId) &&
    task.status === 'done' &&
    task.outputImages.includes(imageId)
  )
}

export function projectFinalEntries(project: GenerationProject, tasks: TaskRecord[]) {
  return Object.entries(project.finals)
    .map(([slotId, final]) => {
      const task = tasks.find((item) => item.id === final.taskId)
      if (!task || task.category?.projectSlotId !== slotId || !canSelectProjectFinal(project, task, final.imageId)) {
        throw new Error('部分定稿对应的生成记录已不存在，请重新选择或取消这些定稿。')
      }
      return { slotId, task, imageId: final.imageId }
    })
    .sort((a, b) => a.slotId.localeCompare(b.slotId))
}
