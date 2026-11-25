import { useCallback, useRef } from 'react'
import { deleteAmazonPlannerSession, putAmazonPlannerSession } from '../../lib/db'
import { storeImage } from '../../lib/db'
import { callImageApi } from '../../lib/api'
import { callAmazonPlannerApi } from '../../lib/listingPlannerApi'
import type { PlannerApiResult } from '../../lib/listingPlannerApi'
import { buildAmazonStyleCandidatePrompt } from '../../lib/listingPlanner'
import { prepareReferenceImagePayload } from '../../lib/referenceImagePayload'
import type { AmazonPlannerSession, ApiProfile, AppSettings, TaskParams } from '../../types'
import {
  createPlannerSessionSnapshot,
  sortPlannerSessions,
  type APlusModuleSpecsByType,
  type StyleImageState,
  getStyleGenerationFailureDetail,
} from './plannerHelpers'
import type { AmazonPromptDraft } from '../../lib/amazonPrompt'
import type {
  AmazonAPlusPlan,
  AmazonAPlusModuleSpec,
  APlusContentType,
  AmazonImagePlan,
  AmazonPlannerMode,
  AmazonStyleCandidate,
  AmazonStyleDensityMode,
  CommercePlannerPlatform,
  TiktokDesignType,
} from '../../lib/listingPlanner'
import type { AmazonMarketplaceId } from '../../lib/amazonMarketplaces'

export async function requestAmazonPlannerPlan(options: {
  listingText: string
  baseDraft: AmazonPromptDraft
  profile: ApiProfile
  referenceImageDataUrls: string[]
  mode: AmazonPlannerMode
  platform: CommercePlannerPlatform
  marketplaceId: AmazonMarketplaceId
  tiktokDesignType: TiktokDesignType
  aPlusType: APlusContentType
  aPlusModuleSpecs: AmazonAPlusModuleSpec[]
  aPlusGenerationTier: '2K' | '4K'
  signal: AbortSignal
  onStage?: (stage: 'requesting' | 'parsing') => void
}) {
  return callAmazonPlannerApi(options)
}

export async function requestPlannerStyleImage(options: {
  settings: AppSettings
  prompt: string
  params: TaskParams
  inputImageDataUrls: string[]
  signal: AbortSignal
}) {
  const result = await callImageApi(options)
  const dataUrl = result.images[0]
  if (options.signal.aborted) throw options.signal.reason
  if (!dataUrl) throw new Error('风格板接口没有返回图片')
  const imageId = await storeImage(dataUrl, 'generated')
  return { imageId, dataUrl }
}

export async function generatePlannerStyleImages(options: {
  settings: AppSettings
  candidates: AmazonStyleCandidate[]
  seriesStyleGuide: string
  params: TaskParams
  referenceImageDataUrls: string[]
  signal: AbortSignal
}) {
  const referencePayload = await prepareReferenceImagePayload(options.referenceImageDataUrls, {
    signal: options.signal,
  })
  const settled = await Promise.allSettled(
    options.candidates.map(async (candidate, candidateIndex) => ({
      candidateIndex,
      ...(await requestPlannerStyleImage({
        settings: options.settings,
        prompt: buildAmazonStyleCandidatePrompt(
          candidate,
          options.seriesStyleGuide,
          referencePayload.dataUrls.length > 0,
        ),
        params: options.params,
        inputImageDataUrls: referencePayload.dataUrls,
        signal: options.signal,
      })),
    })),
  )
  const styleImages: StyleImageState[] = settled.map((result, candidateIndex) =>
    result.status === 'fulfilled'
      ? { ...result.value, status: 'done' }
      : { candidateIndex, status: 'error', error: getStyleGenerationFailureDetail(result.reason) },
  )
  return { styleImages, referencePayloadNotice: referencePayload.notice }
}

export async function retryPlannerStyleImage(options: {
  settings: AppSettings
  candidate: AmazonStyleCandidate
  candidateIndex: number
  seriesStyleGuide: string
  params: TaskParams
  referenceImageDataUrls: string[]
  signal: AbortSignal
}) {
  const referencePayload = await prepareReferenceImagePayload(options.referenceImageDataUrls, {
    signal: options.signal,
  })
  const result = await requestPlannerStyleImage({
    settings: options.settings,
    prompt: buildAmazonStyleCandidatePrompt(
      options.candidate,
      options.seriesStyleGuide,
      referencePayload.dataUrls.length > 0,
    ),
    params: options.params,
    inputImageDataUrls: referencePayload.dataUrls,
    signal: options.signal,
  })
  const styleImage: StyleImageState = { candidateIndex: options.candidateIndex, status: 'done', ...result }
  return { styleImage, referencePayloadNotice: referencePayload.notice }
}

export async function createAmazonPlannerPlan(
  options: Omit<Parameters<typeof requestAmazonPlannerPlan>[0], 'referenceImageDataUrls'> & {
    referenceImageDataUrls: string[]
    onStage?: (stage: 'preparing' | 'requesting' | 'parsing') => void
  },
): Promise<{ result: PlannerApiResult; referencePayloadNotice: string }> {
  options.onStage?.('preparing')
  const referencePayload = await prepareReferenceImagePayload(options.referenceImageDataUrls, {
    signal: options.signal,
  })
  const result = await requestAmazonPlannerPlan({ ...options, referenceImageDataUrls: referencePayload.dataUrls })
  return { result, referencePayloadNotice: referencePayload.notice }
}

export type PlannerControllerSnapshot = {
  currentPlannerSessionId: string | null
  plannerSessions: AmazonPlannerSession[]
  draft: AmazonPromptDraft
  listingText: string
  plannerPlatform: CommercePlannerPlatform
  marketplaceId: AmazonMarketplaceId
  tiktokDesignType: TiktokDesignType
  plannerMode: AmazonPlannerMode
  aPlusType: APlusContentType
  aPlusModuleSpecsByType: APlusModuleSpecsByType
  resolution: '2k' | '4k'
  referenceImageIds: string[]
  seriesStyleGuides: { listing: string; aplus: string; tiktokMain: string; tiktokDetail: string }
  styleCandidates: AmazonStyleCandidate[]
  styleImages: StyleImageState[]
  selectedStyleIndex: number | null
  styleDensityMode: AmazonStyleDensityMode
  promptOverrides?: Record<string, string>
  imagePlans: AmazonImagePlan[]
  aPlusPlans: AmazonAPlusPlan[]
  selectedPlanIndex: number | null
  selectedAPlusPlanIndex: number | null
}

export function useAmazonPlannerController(
  snapshot: PlannerControllerSnapshot,
  setPlannerSessions: (updater: (current: AmazonPlannerSession[]) => AmazonPlannerSession[]) => void,
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void,
) {
  const latestSnapshotRef = useRef(snapshot)
  latestSnapshotRef.current = snapshot
  const deletedSessionIdsRef = useRef(new Set<string>())
  const pendingSavesRef = useRef(new Map<string, Promise<unknown>>())
  const getSnapshot = useCallback((overrides: Partial<AmazonPlannerSession> = {}) => {
    const current = latestSnapshotRef.current
    return createPlannerSessionSnapshot(
      {
        ...current,
        existingSession: current.plannerSessions.find((session) => session.id === current.currentPlannerSessionId),
      },
      overrides,
    )
  }, [])

  const savePlannerSession = useCallback(
    async (overrides: Partial<AmazonPlannerSession> = {}) => {
      const session = getSnapshot(overrides)
      // 同一历史串行保存；删除先封禁后等待，避免在途保存将记录复活。
      const pending = (pendingSavesRef.current.get(session.id) ?? Promise.resolve())
        .catch(() => undefined)
        .then(async () => {
          if (deletedSessionIdsRef.current.has(session.id)) return session
          await putAmazonPlannerSession(session)
          if (!deletedSessionIdsRef.current.has(session.id)) {
            setPlannerSessions((current) =>
              sortPlannerSessions([session, ...current.filter((item) => item.id !== session.id)]),
            )
          }
          return session
        })
      pendingSavesRef.current.set(session.id, pending)
      try {
        return await pending
      } finally {
        if (pendingSavesRef.current.get(session.id) === pending) pendingSavesRef.current.delete(session.id)
      }
    },
    [getSnapshot, setPlannerSessions],
  )

  const updateCurrentPlannerSession = useCallback(
    (overrides: Partial<AmazonPlannerSession>) => {
      const id = snapshot.currentPlannerSessionId
      if (
        !id ||
        deletedSessionIdsRef.current.has(id) ||
        latestSnapshotRef.current.currentPlannerSessionId !== id ||
        !latestSnapshotRef.current.plannerSessions.some((session) => session.id === id)
      )
        return
      void savePlannerSession(overrides).catch((error) => {
        showToast(`策划历史保存失败：${error instanceof Error ? error.message : String(error)}`, 'error')
      })
    },
    [savePlannerSession, showToast, snapshot.currentPlannerSessionId],
  )

  const deletePlannerSessionHistory = useCallback(
    async (id: string) => {
      deletedSessionIdsRef.current.add(id)
      try {
        await pendingSavesRef.current.get(id)?.catch(() => undefined)
        await deleteAmazonPlannerSession(id)
        setPlannerSessions((current) => current.filter((session) => session.id !== id))
      } catch (error) {
        deletedSessionIdsRef.current.delete(id)
        throw error
      }
    },
    [setPlannerSessions],
  )

  return {
    getPlannerSessionSnapshot: getSnapshot,
    savePlannerSession,
    updateCurrentPlannerSession,
    deletePlannerSessionHistory,
  }
}
