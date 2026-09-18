export type WorkspaceAnalysisKind = 'sop' | 'voc'

type ActiveAnalysis = { requestId: string; controller: AbortController }

const activeAnalyses = new Map<WorkspaceAnalysisKind, ActiveAnalysis>()

export function startWorkspaceAnalysis(kind: WorkspaceAnalysisKind): ActiveAnalysis {
  activeAnalyses.get(kind)?.controller.abort()
  const analysis = {
    requestId: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    controller: new AbortController(),
  }
  activeAnalyses.set(kind, analysis)
  return analysis
}

export function getWorkspaceAnalysis(kind: WorkspaceAnalysisKind) {
  return activeAnalyses.get(kind) ?? null
}

export function isWorkspaceAnalysisCurrent(kind: WorkspaceAnalysisKind, requestId: string) {
  return activeAnalyses.get(kind)?.requestId === requestId
}

export function stopWorkspaceAnalysis(kind: WorkspaceAnalysisKind) {
  const active = activeAnalyses.get(kind)
  active?.controller.abort()
  activeAnalyses.delete(kind)
  return active?.requestId ?? null
}

export function finishWorkspaceAnalysis(kind: WorkspaceAnalysisKind, requestId: string) {
  if (isWorkspaceAnalysisCurrent(kind, requestId)) activeAnalyses.delete(kind)
}
