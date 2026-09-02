import type { AgentConversation, AmazonPlannerSession, InputImage, TaskRecord } from '../types'
import { collectAmazonPlannerSessionImageIds, collectSopDraftImageIds } from './workspaceDrafts'
import { collectReferencedImageIdsFromState, collectUnreferencedImageIds } from './taskImageReferences'

export interface ImageReferenceState {
  tasks: TaskRecord[]
  inputImages: InputImage[]
  galleryInputDraft?: { inputImages: InputImage[] } | null
  sopDraft: Parameters<typeof collectSopDraftImageIds>[0]
  agentConversations: AgentConversation[]
  agentInputDrafts: Array<{ inputImages: InputImage[] }>
}

export function collectStateImageReferences(
  state: ImageReferenceState,
  plannerSessions: AmazonPlannerSession[] = [],
): Set<string> {
  return collectReferencedImageIdsFromState({
    tasks: state.tasks,
    inputImages: state.inputImages,
    galleryInputDraft: state.galleryInputDraft,
    sopDraftImageIds: collectSopDraftImageIds(state.sopDraft),
    agentConversations: state.agentConversations,
    agentInputDrafts: state.agentInputDrafts,
    plannerSessions,
    collectPlannerSessionImageIds: collectAmazonPlannerSessionImageIds,
  })
}

export async function deleteUnreferencedImageCandidates(options: {
  candidates: Iterable<string>
  state: ImageReferenceState
  getPlannerSessions: () => Promise<AmazonPlannerSession[]>
  deleteImage: (imageId: string) => Promise<unknown>
  forgetCachedImage: (imageId: string) => void
}): Promise<string[]> {
  const candidates = Array.from(new Set(Array.from(options.candidates).filter(Boolean)))
  if (candidates.length === 0) return []
  const plannerSessions = await options.getPlannerSessions()
  const referenced = collectStateImageReferences(options.state, plannerSessions)
  const deleted = collectUnreferencedImageIds(candidates, referenced)
  for (const imageId of deleted) {
    await options.deleteImage(imageId)
    options.forgetCachedImage(imageId)
  }
  return deleted
}

export async function deleteImageIfUnreferenced(options: {
  imageId: string
  state: ImageReferenceState
  getPlannerSessions: () => Promise<AmazonPlannerSession[]>
  deleteImage: (imageId: string) => Promise<unknown>
  forgetCachedImage: (imageId: string) => void
}): Promise<boolean> {
  options.forgetCachedImage(options.imageId)
  const deleted = await deleteUnreferencedImageCandidates({ ...options, candidates: [options.imageId] })
  return deleted.includes(options.imageId)
}
