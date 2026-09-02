import type { AgentConversation, AmazonPlannerSession, InputImage, TaskRecord } from '../types'
import type { SopWorkspaceDraft } from './workspaceDrafts'

export function collectTaskImageIds(
  task: Pick<TaskRecord, 'inputImageIds' | 'maskImageId' | 'outputImages'>,
): string[] {
  return [
    ...(task.inputImageIds || []),
    ...(task.maskImageId ? [task.maskImageId] : []),
    ...(task.outputImages || []),
  ].filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
}

export function addTaskImageReferences(
  target: Set<string>,
  task: Pick<TaskRecord, 'inputImageIds' | 'maskImageId' | 'outputImages'>,
): void {
  for (const id of collectTaskImageIds(task)) target.add(id)
}

export function addAgentImageReferences(
  target: Set<string>,
  conversations: AgentConversation[] = [],
  inputDrafts: Array<{ inputImages: InputImage[] }> = [],
): void {
  for (const conversation of conversations) {
    for (const round of conversation.rounds) {
      for (const id of round.inputImageIds) target.add(id)
      if (round.maskImageId) target.add(round.maskImageId)
    }
    for (const message of conversation.messages) {
      if (message.maskImageId) target.add(message.maskImageId)
    }
  }
  for (const draft of inputDrafts) {
    for (const image of draft.inputImages) target.add(image.id)
  }
}

export function collectReferencedImageIds(options: {
  tasks?: TaskRecord[]
  inputImages?: InputImage[]
  galleryInputDraft?: { inputImages: InputImage[] } | null
  sopDraftImageIds?: string[]
  agentConversations?: AgentConversation[]
  agentInputDrafts?: Array<{ inputImages: InputImage[] }>
  plannerSessions?: AmazonPlannerSession[]
  collectPlannerSessionImageIds?: (session: AmazonPlannerSession) => string[]
}): Set<string> {
  const referenced = new Set<string>()
  for (const image of options.inputImages ?? []) referenced.add(image.id)
  for (const image of options.galleryInputDraft?.inputImages ?? []) referenced.add(image.id)
  for (const id of options.sopDraftImageIds ?? []) referenced.add(id)
  for (const task of options.tasks ?? []) addTaskImageReferences(referenced, task)
  addAgentImageReferences(referenced, options.agentConversations, options.agentInputDrafts)
  if (options.collectPlannerSessionImageIds) {
    for (const session of options.plannerSessions ?? []) {
      for (const id of options.collectPlannerSessionImageIds(session)) referenced.add(id)
    }
  }
  return referenced
}

export function collectUnreferencedImageIds(candidates: Iterable<string>, referenced: ReadonlySet<string>): string[] {
  return Array.from(new Set(Array.from(candidates).filter((id) => Boolean(id) && !referenced.has(id))))
}

export function collectReferencedImageIdsFromState(options: {
  tasks: TaskRecord[]
  inputImages: InputImage[]
  galleryInputDraft?: { inputImages: InputImage[] } | null
  sopDraftImageIds?: string[]
  agentConversations: AgentConversation[]
  agentInputDrafts: Array<{ inputImages: InputImage[] }>
  plannerSessions?: AmazonPlannerSession[]
  collectPlannerSessionImageIds?: (session: AmazonPlannerSession) => string[]
}): Set<string> {
  return collectReferencedImageIds(options)
}

export function collectSopImageIds(draft: SopWorkspaceDraft | null | undefined): string[] {
  return (draft?.referenceImages ?? []).map((image) => image.id).filter((id) => Boolean(id?.trim()))
}
