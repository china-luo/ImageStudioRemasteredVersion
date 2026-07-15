export interface PlannerStyleReferenceState {
  requiredForSubmit: boolean
  hasStyleReference: boolean
  uploadedReferenceCount: number
  maxUploadedReferences: number
}

export type PlannerStyleReferenceIssue = 'missing' | 'uploaded-limit' | null

export interface PlannerStyleReferencePolicy {
  attach: boolean
  issue: PlannerStyleReferenceIssue
}

export function resolvePlannerStyleReference(state: PlannerStyleReferenceState): PlannerStyleReferencePolicy {
  const attach = state.requiredForSubmit && state.hasStyleReference
  const issue: PlannerStyleReferenceIssue = state.uploadedReferenceCount > state.maxUploadedReferences
    ? 'uploaded-limit'
    : state.requiredForSubmit && !state.hasStyleReference
      ? 'missing'
      : null

  return {
    attach,
    issue,
  }
}
