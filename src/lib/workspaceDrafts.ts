import type { VocReviewEnvelope } from './vocAmazonReviewsApi'

export interface SopForm {
  competitorDescription: string
  targetPlatform: string
  imageRole: string
  productName: string
  category: string
  sellingPoints: string
  audience: string
  evidence: string
  forbidden: string
  ratio: string
}

export interface SopReferenceImage {
  id: string
  name: string
  dataUrl: string
}

export interface SopWorkspaceDraft {
  form: SopForm
  referenceImages: SopReferenceImage[]
  output: string
  error: string
  updatedAt: number
}

export type VocSourceMode = 'asin' | 'csv'

export interface VocWorkspaceDraft {
  sourceMode: VocSourceMode
  asin: string
  market: string
  limit: number
  productName: string
  csvText: string
  reviewsEnvelope: VocReviewEnvelope | null
  aiReport: string
  statusText: string
  error: string
  updatedAt: number
}

export const DEFAULT_SOP_FORM: SopForm = {
  competitorDescription: '',
  targetPlatform: 'TikTok Shop',
  imageRole: '卖点图',
  productName: '',
  category: '',
  sellingPoints: '',
  audience: '',
  evidence: '',
  forbidden: '',
  ratio: '1:1',
}

export const DEFAULT_SOP_DRAFT: SopWorkspaceDraft = {
  form: { ...DEFAULT_SOP_FORM },
  referenceImages: [],
  output: '',
  error: '',
  updatedAt: 0,
}

export const DEFAULT_VOC_DRAFT: VocWorkspaceDraft = {
  sourceMode: 'asin',
  asin: '',
  market: 'US',
  limit: 100,
  productName: '',
  csvText: '',
  reviewsEnvelope: null,
  aiReport: '',
  statusText: '',
  error: '',
  updatedAt: 0,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export function normalizeSopDraft(value: unknown): SopWorkspaceDraft {
  const draft = isRecord(value) ? value : {}
  const form = isRecord(draft.form) ? draft.form : {}
  const images = Array.isArray(draft.referenceImages) ? draft.referenceImages : []
  return {
    form: {
      competitorDescription: readString(form.competitorDescription),
      targetPlatform: readString(form.targetPlatform, DEFAULT_SOP_FORM.targetPlatform),
      imageRole: readString(form.imageRole, DEFAULT_SOP_FORM.imageRole),
      productName: readString(form.productName),
      category: readString(form.category),
      sellingPoints: readString(form.sellingPoints),
      audience: readString(form.audience),
      evidence: readString(form.evidence),
      forbidden: readString(form.forbidden),
      ratio: readString(form.ratio, DEFAULT_SOP_FORM.ratio),
    },
    referenceImages: images
      .filter(
        (image): image is Record<string, unknown> =>
          isRecord(image) && typeof image.id === 'string' && image.id.trim().length > 0,
      )
      .map((image) => ({
        id: String(image.id),
        name: readString(image.name, 'image'),
        dataUrl: readString(image.dataUrl),
      })),
    output: readString(draft.output),
    error: readString(draft.error),
    updatedAt: typeof draft.updatedAt === 'number' && Number.isFinite(draft.updatedAt) ? draft.updatedAt : 0,
  }
}

export function normalizeVocDraft(value: unknown): VocWorkspaceDraft {
  const draft = isRecord(value) ? value : {}
  const sourceMode = draft.sourceMode === 'csv' ? 'csv' : 'asin'
  const limit =
    typeof draft.limit === 'number' && Number.isFinite(draft.limit) ? Math.max(1, Math.min(100, draft.limit)) : 100
  const reviewsEnvelope =
    isRecord(draft.reviewsEnvelope) && Array.isArray(draft.reviewsEnvelope.reviews)
      ? (draft.reviewsEnvelope as unknown as VocReviewEnvelope)
      : null
  return {
    sourceMode,
    asin: readString(draft.asin),
    market: readString(draft.market, 'US'),
    limit,
    productName: readString(draft.productName),
    csvText: readString(draft.csvText),
    reviewsEnvelope,
    aiReport: readString(draft.aiReport),
    statusText: readString(draft.statusText),
    error: readString(draft.error),
    updatedAt: typeof draft.updatedAt === 'number' && Number.isFinite(draft.updatedAt) ? draft.updatedAt : 0,
  }
}

export function persistableSopDraft(draft: SopWorkspaceDraft): SopWorkspaceDraft {
  return {
    ...draft,
    form: { ...draft.form },
    referenceImages: draft.referenceImages.map((image) => ({ id: image.id, name: image.name, dataUrl: '' })),
  }
}

export function collectSopDraftImageIds(draft: SopWorkspaceDraft | null | undefined): string[] {
  return (draft?.referenceImages ?? []).map((image) => image.id).filter((id) => id.trim().length > 0)
}

export function collectAmazonPlannerSessionImageIds(session: {
  referenceImageIds?: string[]
  styleImages?: Array<{ imageId?: string }>
}): string[] {
  return [...(session.referenceImageIds || []), ...(session.styleImages || []).map((image) => image.imageId)].filter(
    (id): id is string => typeof id === 'string' && Boolean(id.trim()),
  )
}

export const VOC_NO_VALID_REVIEWS_ERROR =
  '没有可用的有效评论。请确认文件或数据源包含至少 1 条正文不少于 3 个字符的评论。'

export function assertVocHasValidReviews(envelope: { reviews?: unknown[] } | null | undefined): void {
  if (!envelope || !Array.isArray(envelope.reviews) || envelope.reviews.length === 0) {
    throw new Error(VOC_NO_VALID_REVIEWS_ERROR)
  }
}

export function extractEnglishImagePrompt(text: string): string {
  const source = text.trim()
  if (!source) return ''
  const promptMatch = source.match(
    /(?:^|\n)#{1,3}\s*(?:9[.、]?\s*)?(?:English\s+AI\s+Image\s+Prompt|英文\s*AI\s*图片提示词)[^\n]*\n([\s\S]*?)(?=\n#{1,3}\s*(?:10|English\s+Negative\s+Prompt|负面)|$)/i,
  )
  const direct = promptMatch?.[1]?.trim()
  if (!direct) return ''
  return direct
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```$/i, '')
    .trim()
}
