import type { AmazonPlannerSession, InputImage } from '../../types'
import { sortPlannerSessions, type StyleImageState } from './plannerHelpers'

/** A storage read must not overwrite sessions saved while that read was pending. */
export function mergePlannerSessionHistory(current: AmazonPlannerSession[], loaded: AmazonPlannerSession[]) {
  const byId = new Map(loaded.map((session) => [session.id, session]))
  for (const session of current) {
    const stored = byId.get(session.id)
    if (!stored || session.updatedAt >= stored.updatedAt) byId.set(session.id, session)
  }
  return sortPlannerSessions([...byId.values()])
}

export interface RestoredPlannerSession {
  session: AmazonPlannerSession
  references: InputImage[]
  styleImages: StyleImageState[]
}

/** A restore may warm the image cache after cancellation, but must never commit stale UI/global state. */
export function createPlannerSessionRestorer(deps: {
  ensureImageCached: (id: string) => Promise<string | null | undefined>
  commit: (restored: RestoredPlannerSession) => void
  setLoading: (loading: boolean) => void
  onError: (error: unknown) => void
}) {
  let current: object | null = null
  let disposed = false

  const cancel = () => {
    const wasLoading = current !== null
    current = null
    if (!disposed && wasLoading) deps.setLoading(false)
  }

  const restore = async (session: AmazonPlannerSession) => {
    if (disposed) return
    const request = {}
    current = request
    deps.setLoading(true)
    const isCurrent = () => !disposed && current === request
    try {
      const references: InputImage[] = []
      for (const id of session.referenceImageIds) {
        const dataUrl = await deps.ensureImageCached(id)
        if (!isCurrent()) return
        if (dataUrl) references.push({ id, dataUrl })
      }
      const styleImages: StyleImageState[] = []
      for (const image of session.styleImages) {
        const dataUrl = await deps.ensureImageCached(image.imageId)
        if (!isCurrent()) return
        if (dataUrl)
          styleImages.push({ candidateIndex: image.candidateIndex, status: 'done', imageId: image.imageId, dataUrl })
      }
      if (isCurrent()) deps.commit({ session, references, styleImages })
    } catch (error) {
      if (isCurrent()) deps.onError(error)
    } finally {
      if (isCurrent()) {
        current = null
        deps.setLoading(false)
      }
    }
  }

  return {
    restore,
    cancel,
    dispose: () => {
      disposed = true
      current = null
    },
  }
}
