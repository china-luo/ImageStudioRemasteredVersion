import type { ApiProfile } from '../types'
import { DEFAULT_CHAT_MODEL, DEFAULT_RESPONSES_MODEL } from './apiProfiles'
import { formatAmazonAPlusReferenceMaterial, formatAmazonListingReferenceMaterial } from './amazonKnowledge'
import {
  getAmazonMarketplace,
  normalizeAmazonMarketplaceId,
  type AmazonMarketplaceId,
} from './amazonMarketplaces'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from './devProxy'
import { getApiErrorMessage } from './imageApiShared'
import type { AmazonPromptDraft } from './amazonPrompt'
import {
  getAPlusContentTypeLabel,
  getAPlusModuleGenerationSize,
  getAPlusModuleSpecs,
  getAPlusModuleUploadSize,
  type APlusContentType,
  type AmazonAPlusPlan,
  type AmazonImagePlan,
  type AmazonPlannerMode,
  type AmazonStyleCandidate,
  type CommercePlannerPlatform,
  type ListingParseResult,
  type TiktokDesignType,
} from './listingPlanner'
import { isEventStreamResponse, looksLikeServerSentEvents, readJsonServerSentEvents, readJsonServerSentEventText } from './serverSentEvents'
import type { SizeTier } from './size'

interface PlannerApiPayload {
  product?: {
    title?: string
    category?: string
    brand?: string
    color?: string
    material?: string
    audience?: string
    packageIncludes?: string
  }
  sellingPoints?: string[]
  seriesStyleGuide?: string
  styleCandidates?: AmazonStyleCandidate[]
  imagePlans?: Array<Partial<AmazonImagePlan>>
  aPlusPlans?: Array<Partial<AmazonAPlusPlan>>
}

export interface PlannerApiResult {
  mode: AmazonPlannerMode
  marketplaceId?: AmazonMarketplaceId
  parsed: ListingParseResult
  seriesStyleGuide: string
  styleCandidates: AmazonStyleCandidate[]
  plans: AmazonImagePlan[]
  aPlusPlans: AmazonAPlusPlan[]
  aPlusType?: APlusContentType
}

const PRODUCT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    category: { type: 'string' },
    brand: { type: 'string' },
    color: { type: 'string' },
    material: { type: 'string' },
    audience: { type: 'string' },
    packageIncludes: { type: 'string' },
  },
  required: ['title', 'category', 'brand', 'color', 'material', 'audience', 'packageIncludes'],
} as const

const SELLING_POINTS_SCHEMA = {
  type: 'array',
  minItems: 1,
  maxItems: 5,
  items: { type: 'string' },
} as const

const CHINESE_LABEL_SCHEMA = {
  type: 'string',
  description: 'Concise Simplified Chinese label for UI display.',
} as const

const ENGLISH_ON_IMAGE_COPY_SCHEMA = {
  type: 'string',
  description: 'Short natural US-English on-image copy only, or an empty string. The image model should render it consistently when the final prompt includes it; never include Chinese characters.',
} as const

const ENGLISH_IMAGE_PROMPT_SCHEMA = {
  type: 'string',
  description: 'Professional English image-generation prompt only. Never include Chinese characters.',
} as const

const PLAN_MARKDOWN_SCHEMA = {
  type: 'string',
  description: 'Detailed Simplified Chinese planning write-up for this slot, similar to a ChatGPT agent response. Markdown is allowed.',
} as const

const NEGATIVE_PROMPT_SCHEMA = {
  type: 'string',
  description: 'English negative prompt for the image model. Never include Chinese characters.',
} as const

function getVisibleCopyLanguageRule(marketplaceId?: AmazonMarketplaceId): string {
  const marketplace = getAmazonMarketplace(marketplaceId)
  return marketplace.allowsCjkVisibleCopy
    ? `Visible customer-facing copy inside the prompt must be natural ${marketplace.onImageCopyLanguage} for ${marketplace.domain}; Japanese characters are allowed for visible copy, but do not include Simplified Chinese UI wording.`
    : `Visible customer-facing copy inside the prompt must be natural ${marketplace.onImageCopyLanguage} for ${marketplace.domain}; never include Chinese or Japanese characters in visible copy.`
}
function createAmazonImagePromptSchema(marketplaceId?: AmazonMarketplaceId) {
  return {
    type: 'string',
    description: `Professional English image-generation prompt. ${getVisibleCopyLanguageRule(marketplaceId)} The overall prompt instructions should remain English for image-model stability.`,
  } as const
}

function createAPlusExternalTextSchema(field: 'title' | 'body', marketplaceId?: AmazonMarketplaceId) {
  const marketplace = getAmazonMarketplace(marketplaceId)
  return {
    type: 'string',
    description: `External A+ ${field} text in natural ${marketplace.copyLanguage} for ${marketplace.domain}, or an empty string when not needed.`,
  } as const
}

const STYLE_CANDIDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    label: { type: 'string', description: 'Concise Simplified Chinese style option name.' },
    description: { type: 'string', description: 'Simplified Chinese explanation of the visual style option.' },
    prompt: {
      ...ENGLISH_IMAGE_PROMPT_SCHEMA,
      description: 'Professional English prompt for a 1024x1024 visual style reference board. Never include Chinese characters.',
    },
    negativePrompt: NEGATIVE_PROMPT_SCHEMA,
  },
  required: ['label', 'description', 'prompt', 'negativePrompt'],
} as const

function createListingPlannerSchema(marketplaceId?: AmazonMarketplaceId) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      product: PRODUCT_SCHEMA,
      sellingPoints: SELLING_POINTS_SCHEMA,
      seriesStyleGuide: {
        type: 'string',
        description: 'LLM-authored English visual guide for cross-image product consistency and factual continuity.',
      },
      styleCandidates: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: STYLE_CANDIDATE_SCHEMA,
      },
      imagePlans: {
        type: 'array',
        minItems: 7,
        maxItems: 7,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            slot: { type: 'string', enum: ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06'] },
            label: CHINESE_LABEL_SCHEMA,
            planMarkdown: PLAN_MARKDOWN_SCHEMA,
            prompt: createAmazonImagePromptSchema(marketplaceId),
            negativePrompt: NEGATIVE_PROMPT_SCHEMA,
          },
          required: ['slot', 'label', 'planMarkdown', 'prompt', 'negativePrompt'],
        },
      },
    },
    required: ['product', 'sellingPoints', 'seriesStyleGuide', 'styleCandidates', 'imagePlans'],
  } as const
}

const TIKTOK_MAIN_SLOTS = ['TTM01', 'TTM02', 'TTM03', 'TTM04', 'TTM05', 'TTM06'] as const
const TIKTOK_DETAIL_SLOTS = ['TTD01', 'TTD02', 'TTD03', 'TTD04', 'TTD05', 'TTD06', 'TTD07', 'TTD08'] as const

const TIKTOK_MAIN_SLOT_GUIDE = [
  'TikTok Shop US main-image slot strategy:',
  '- TTM01: pure-white front compliance main image. Use #FFFFFF background, complete centered product, high-quality commercial photography, no extra props, no promotional elements. It may include one small real brand-name mark or real brand logo only when the brand is provided by the product facts or reference images; do not invent brand artwork.',
  '- TTM02: scroll-stopping hero product visual. Keep the real product as the dominant subject, using stronger lighting, angle, depth, and material polish for mobile thumbnail appeal. Keep the background clean and do not add text.',
  '- TTM03: realistic US lifestyle usage image. Show the product naturally used in a truthful everyday US scenario such as kitchen, bathroom, bedroom, car, outdoor, desktop, or another scenario supported by the product facts.',
  '- TTM04: visual pain-point solution image. Communicate why the buyer needs it through the scene, such as organized, portable, space-saving, comfortable, protective, or cleaning use, without text, exaggerated before/after effects, or unsupported results.',
  '- TTM05: material and value perception image. Emphasize texture, craftsmanship, structure, capacity, durability, transparency, softness, metal finish, or other real value cues supported by the product information.',
  '- TTM06: device function and multi-scenario combination image. Combine the product core functions with several realistic usage scenarios in one clean multi-zone, split-scene, or cohesive collage-style composition. Do not invent functions, impossible use cases, extra accessories, or misleading results.',
].join('\n')

function getTikTokSlots(designType: TiktokDesignType) {
  return designType === 'detail' ? TIKTOK_DETAIL_SLOTS : TIKTOK_MAIN_SLOTS
}

function createTiktokPlannerSchema(designType: TiktokDesignType) {
  const slots = getTikTokSlots(designType)
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      product: PRODUCT_SCHEMA,
      sellingPoints: SELLING_POINTS_SCHEMA,
      seriesStyleGuide: {
        type: 'string',
        description: 'LLM-authored English visual style guide to keep the TikTok Shop image set coherent.',
      },
      styleCandidates: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: STYLE_CANDIDATE_SCHEMA,
      },
      imagePlans: {
        type: 'array',
        minItems: slots.length,
        maxItems: slots.length,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            slot: { type: 'string', enum: [...slots] },
            label: CHINESE_LABEL_SCHEMA,
            planMarkdown: PLAN_MARKDOWN_SCHEMA,
            prompt: ENGLISH_IMAGE_PROMPT_SCHEMA,
            negativePrompt: NEGATIVE_PROMPT_SCHEMA,
          },
          required: ['slot', 'label', 'planMarkdown', 'prompt', 'negativePrompt'],
        },
      },
    },
    required: ['product', 'sellingPoints', 'seriesStyleGuide', 'styleCandidates', 'imagePlans'],
  } as const
}

function createAPlusPlannerSchema(aPlusType: APlusContentType, marketplaceId?: AmazonMarketplaceId) {
  const specs = getAPlusModuleSpecs(aPlusType)
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      product: PRODUCT_SCHEMA,
      sellingPoints: SELLING_POINTS_SCHEMA,
      seriesStyleGuide: {
        type: 'string',
        description: 'LLM-authored English visual style guide to keep the whole A+ module set coherent.',
      },
      styleCandidates: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: STYLE_CANDIDATE_SCHEMA,
      },
      aPlusPlans: {
        type: 'array',
        minItems: specs.length,
        maxItems: specs.length,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            slot: { type: 'string', enum: specs.map((spec) => spec.slot) },
            label: CHINESE_LABEL_SCHEMA,
            moduleType: { type: 'string', enum: Array.from(new Set(specs.map((spec) => spec.moduleType))) },
            planMarkdown: PLAN_MARKDOWN_SCHEMA,
            textTitle: createAPlusExternalTextSchema('title', marketplaceId),
            textBody: createAPlusExternalTextSchema('body', marketplaceId),
            prompt: createAmazonImagePromptSchema(marketplaceId),
            negativePrompt: NEGATIVE_PROMPT_SCHEMA,
          },
          required: ['slot', 'label', 'moduleType', 'planMarkdown', 'textTitle', 'textBody', 'prompt', 'negativePrompt'],
        },
      },
    },
    required: ['product', 'sellingPoints', 'seriesStyleGuide', 'styleCandidates', 'aPlusPlans'],
  } as const
}

function extractResponseText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const record = payload as Record<string, unknown>
  if (typeof record.output_text === 'string') return record.output_text

  const choices = Array.isArray(record.choices) ? record.choices : []
  const chatChunks: string[] = []
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue
    const choiceRecord = choice as Record<string, unknown>
    const message = choiceRecord.message
    if (message && typeof message === 'object') {
      const messageRecord = message as Record<string, unknown>
      const content = messageRecord.content
      if (typeof content === 'string') chatChunks.push(content)
      else if (Array.isArray(content)) {
        for (const part of content) {
          if (!part || typeof part !== 'object') continue
          const partRecord = part as Record<string, unknown>
          if (typeof partRecord.text === 'string') chatChunks.push(partRecord.text)
        }
      }
    }
    const delta = choiceRecord.delta
    if (delta && typeof delta === 'object') {
      const content = (delta as Record<string, unknown>).content
      if (typeof content === 'string') chatChunks.push(content)
    }
  }
  if (chatChunks.length) return chatChunks.join('\n').trim()

  const output = Array.isArray(record.output) ? record.output : []
  const chunks: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const itemRecord = item as Record<string, unknown>
    const content = Array.isArray(itemRecord.content) ? itemRecord.content : []
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const partRecord = part as Record<string, unknown>
      if (typeof partRecord.text === 'string') chunks.push(partRecord.text)
    }
  }
  return chunks.join('\n').trim()
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getStringValue(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' && value ? value : undefined
}

function parsePlannerPayload(text: string): PlannerApiPayload {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]
  return JSON.parse(fenced ?? trimmed) as PlannerApiPayload
}

function getPlannerPayloadFromEvent(event: Record<string, unknown>): unknown {
  if (isRecordValue(event.response)) return event.response
  if (isRecordValue(event.item)) return { output: [event.item] }
  return null
}

function getPlannerTextFromEvent(event: Record<string, unknown>): string {
  const directText = extractResponseText(event)
  if (directText) return directText

  const payloadText = extractResponseText(getPlannerPayloadFromEvent(event))
  if (payloadText) return payloadText

  const text = getStringValue(event, 'text')
  if (text) return text

  const part = event.part
  if (isRecordValue(part)) {
    const partText = getStringValue(part, 'text')
    if (partText) return partText
  }

  return ''
}

async function readPlannerTextFromSseResponse(response: Response): Promise<string> {
  let completedText = ''
  let outputItemText = ''
  let doneText = ''
  let deltaText = ''

  await readJsonServerSentEvents(response, (event) => {
    const type = getStringValue(event, 'type')
    if (type === 'response.output_text.delta') {
      deltaText += getStringValue(event, 'delta') ?? ''
      return
    }

    const text = getPlannerTextFromEvent(event)
    if (!text) return

    if (type === 'response.completed') completedText = text
    else if (type === 'response.output_item.done') outputItemText = text
    else if (type === 'response.output_text.done' || type === 'response.content_part.done') doneText = text
    else if (!type) deltaText += text
  })

  return completedText.trim() || outputItemText.trim() || doneText.trim() || deltaText.trim()
}

async function readPlannerTextFromSseText(rawText: string): Promise<string> {
  let completedText = ''
  let outputItemText = ''
  let doneText = ''
  let deltaText = ''

  await readJsonServerSentEventText(rawText, (event) => {
    const type = getStringValue(event, 'type')
    if (type === 'response.output_text.delta') {
      deltaText += getStringValue(event, 'delta') ?? ''
      return
    }

    const text = getPlannerTextFromEvent(event)
    if (!text) return

    if (type === 'response.completed') completedText = text
    else if (type === 'response.output_item.done') outputItemText = text
    else if (type === 'response.output_text.done' || type === 'response.content_part.done') doneText = text
    else if (!type) deltaText += text
  })

  return completedText.trim() || outputItemText.trim() || doneText.trim() || deltaText.trim()
}

function isJsonContentType(contentType: string): boolean {
  return contentType.includes('application/json') || contentType.includes('+json')
}

function truncateForError(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= 1200) return trimmed
  return `${trimmed.slice(0, 1200)}...`
}

async function readPlannerResponseText(response: Response): Promise<string> {
  if (isEventStreamResponse(response)) {
    const text = await readPlannerTextFromSseResponse(response)
    if (!text) throw new Error('AI 策划流式接口未返回文本内容')
    return text
  }

  const rawText = await response.text()
  if (!rawText.trim()) throw new Error('AI 策划接口返回空内容')

  if (looksLikeServerSentEvents(rawText)) {
    const text = await readPlannerTextFromSseText(rawText)
    if (!text) throw new Error('AI 策划流式接口未返回文本内容')
    return text
  }

  const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? ''
  if (!isJsonContentType(contentType) && !/^[{\[]/.test(rawText.trimStart())) {
    throw new Error(`AI 策划接口返回了非 JSON 内容：${truncateForError(rawText)}`)
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawText)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`AI 策划接口返回了无法解析的 JSON：${message}\n\n${truncateForError(rawText)}`)
  }

  const text = extractResponseText(payload)
  if (!text) throw new Error('AI 策划接口未返回文本内容')
  return text
}

function normalizePlan(plan: Partial<AmazonImagePlan>, index: number, slots = ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06']): AmazonImagePlan {
  return {
    slot: plan.slot || slots[index] || `PT${String(index).padStart(2, '0')}`,
    label: plan.label || '图片方案',
    ...(plan.kind ? { kind: plan.kind } : {}),
    planMarkdown: plan.planMarkdown || '',
    prompt: plan.prompt || '',
    negativePrompt: plan.negativePrompt || '',
  }
}

function normalizeParsedListing(payload: PlannerApiPayload): ListingParseResult {
  const product = payload.product ?? {}
  const sellingPoints = Array.isArray(payload.sellingPoints)
    ? payload.sellingPoints.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).slice(0, 5)
    : []

  if (!product.title?.trim()) throw new Error('AI 策划结果缺少商品标题')

  return {
    title: product.title.trim(),
    bullets: sellingPoints,
    inferred: {
      productTitle: product.title.trim(),
      category: product.category?.trim() ?? '',
      ...(product.brand?.trim() ? { brand: product.brand.trim() } : {}),
      color: product.color?.trim() ?? '',
      material: product.material?.trim() ?? '',
      audience: product.audience?.trim() ?? '',
      packageIncludes: product.packageIncludes?.trim() ?? '',
      sellingPoints: sellingPoints.join('\n'),
    },
  }
}

function normalizeStyleCandidates(payload: PlannerApiPayload): AmazonStyleCandidate[] {
  const candidates = Array.isArray(payload.styleCandidates) ? payload.styleCandidates : []
  return candidates
    .map((candidate, index) => ({
      label: candidate?.label?.trim() || `风格 ${index + 1}`,
      description: candidate?.description?.trim() || '',
      prompt: candidate?.prompt?.trim() || '',
      negativePrompt: candidate?.negativePrompt?.trim() || '',
    }))
    .filter((candidate) => candidate.prompt)
    .slice(0, 3)
}

function normalizeSeriesStyleGuide(payload: PlannerApiPayload): string {
  return typeof payload.seriesStyleGuide === 'string' ? payload.seriesStyleGuide.trim() : ''
}

function normalizeListingPlannerApiPayload(payload: PlannerApiPayload, slots = ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06'], marketplaceId?: AmazonMarketplaceId): PlannerApiResult {
  const parsed = normalizeParsedListing(payload)
  const seriesStyleGuide = normalizeSeriesStyleGuide(payload)
  const styleCandidates = normalizeStyleCandidates(payload)
  const plans = Array.isArray(payload.imagePlans)
    ? payload.imagePlans.map((plan, index) => normalizePlan(plan, index, slots)).filter((plan) => plan.prompt.trim() && plan.planMarkdown.trim()).slice(0, slots.length)
    : []

  if (plans.length !== slots.length) throw new Error(`AI 策划结果不是 ${slots.length} 张图`)

  return {
    mode: 'listing',
    marketplaceId,
    parsed,
    seriesStyleGuide,
    styleCandidates,
    plans,
    aPlusPlans: [],
  }
}

function normalizeAPlusPlan(
  plan: Partial<AmazonAPlusPlan> | undefined,
  index: number,
  aPlusType: APlusContentType,
  tier: SizeTier,
): AmazonAPlusPlan {
  const spec = getAPlusModuleSpecs(aPlusType)[index]
  if (!spec) throw new Error('A+ 模块规格不存在')

  return {
    slot: plan?.slot || spec.slot,
    label: plan?.label || spec.label,
    moduleType: plan?.moduleType || spec.moduleType,
    uploadSize: getAPlusModuleUploadSize(spec),
    generationSize: getAPlusModuleGenerationSize(spec, tier),
    planMarkdown: plan?.planMarkdown || '',
    textTitle: plan?.textTitle || '',
    textBody: plan?.textBody || '',
    prompt: plan?.prompt || '',
    negativePrompt: plan?.negativePrompt || '',
  }
}

function normalizeAPlusPlannerApiPayload(payload: PlannerApiPayload, aPlusType: APlusContentType, tier: SizeTier, marketplaceId?: AmazonMarketplaceId): PlannerApiResult {
  const parsed = normalizeParsedListing(payload)
  const seriesStyleGuide = normalizeSeriesStyleGuide(payload)
  const styleCandidates = normalizeStyleCandidates(payload)
  const specs = getAPlusModuleSpecs(aPlusType)
  const rawPlans = Array.isArray(payload.aPlusPlans) ? payload.aPlusPlans : []
  if (rawPlans.length !== specs.length) throw new Error(`AI A+ 策划结果不是 ${specs.length} 个模块`)

  const aPlusPlans = specs.map((spec, index) => {
    const bySlot = rawPlans.find((plan) => plan?.slot === spec.slot)
    return normalizeAPlusPlan(bySlot ?? rawPlans[index], index, aPlusType, tier)
  })

  const emptyPrompt = aPlusPlans.find((plan) => !plan.prompt.trim())
  if (emptyPrompt) throw new Error(`AI A+ 策划结果缺少 ${emptyPrompt.slot} 的提示词`)
  const emptyPlan = aPlusPlans.find((plan) => !plan.planMarkdown.trim())
  if (emptyPlan) throw new Error(`AI A+ 策划结果缺少 ${emptyPlan.slot} 的策划说明`)

  return {
    mode: 'aplus',
    marketplaceId,
    parsed,
    seriesStyleGuide,
    styleCandidates,
    plans: [],
    aPlusPlans,
    aPlusType,
  }
}

function buildMarketplaceInstructionBlock(marketplaceId?: AmazonMarketplaceId) {
  const marketplace = getAmazonMarketplace(marketplaceId)
  return [
    `Target marketplace: ${marketplace.label} (${marketplace.domain}, locale ${marketplace.locale}).`,
    `Customer-facing visible copy must be concise, natural ${marketplace.onImageCopyLanguage}.`,
    ...marketplace.localGuidance,
    'Keep image-generation prompt and negativePrompt fields written in English for image-model stability, but quote any visible customer-facing copy in the target marketplace language.',
  ].join('\n')
}

function buildFieldLanguageRules(marketplaceId?: AmazonMarketplaceId, options: { includeAPlusExternalText?: boolean } = {}) {
  const marketplace = getAmazonMarketplace(marketplaceId)
  const externalTextRule = options.includeAPlusExternalText
    ? ` textTitle/textBody must be natural ${marketplace.copyLanguage} for ${marketplace.domain} or empty;`
    : ''
  return `Field language rules: label and planMarkdown must be Simplified Chinese;${externalTextRule} seriesStyleGuide, prompt, and negativePrompt must be English. Visible customer-facing copy described inside prompt must be ${marketplace.onImageCopyLanguage}.`
}

const PRODUCT_REFERENCE_FACTS_ONLY_PLANNER_GUIDE = [
  'Product reference image rule:',
  '- Use product reference images only to identify product facts: real appearance, color, shape, structure, included accessories, materials, package contents, and feature evidence.',
  '- Do not use product reference images to choose the final visual style, color palette, background mood, typography style, decorative accents, or overall aesthetic unless the listing text explicitly requests it.',
  '- imagePlans[].prompt and aPlusPlans[].prompt must avoid fixed non-product aesthetics such as coastal resort, warm cream background, botanical accents, luxury editorial, cyberpunk, or magazine fashion unless those are explicit product, brand, or listing requirements.',
  '- seriesStyleGuide should preserve cross-image product consistency, factual visual continuity, copy hierarchy, and product appearance only; keep final palette, typography, background, lighting mood, or decorative system flexible for the selected style-board mode.',
].join('\n')

function buildListingPlannerInstructions(baseDraft: AmazonPromptDraft, marketplaceId?: AmazonMarketplaceId) {
  const marketplace = getAmazonMarketplace(marketplaceId)
  return [
    'You are an Amazon image-planning agent. The user provides listing copy and optional product reference images.',
    buildMarketplaceInstructionBlock(marketplaceId),
    'Create a complete visual plan for exactly 7 Amazon listing image slots: MAIN, PT01, PT02, PT03, PT04, PT05, PT06.',
    'The application only fixes the slot count and order. You must decide the strategy, composition, copy approach, visual treatment, prompt content, and negative prompt content.',
    'Use the Amazon reference material below to improve compliance judgment. It is not a fixed slot-by-slot framework, and it must not replace the product facts from the listing and reference images.',
    formatAmazonListingReferenceMaterial(marketplaceId),
    PRODUCT_REFERENCE_FACTS_ONLY_PLANNER_GUIDE,
    'For each slot, write planMarkdown in Simplified Chinese as a detailed agent-style plan similar to a ChatGPT web response, then write a professional English image prompt and English negative prompt.',
    `Each image prompt should fully plan the finished Amazon image: composition, product evidence, on-image ${marketplace.onImageCopyLanguage} copy when useful, callouts or information areas when useful, visual hierarchy, and rendering style.`,
    'For secondary information images, prefer complete information design with clear hierarchy and useful product evidence; lifestyle or beauty slots should still have purposeful composition and visible product support.',
    'Return one seriesStyleGuide string in English for cross-image product consistency and factual visual continuity. Keep it style-neutral and do not use it to choose the final color palette, typography, background mood, lighting mood, or decorative style.',
    'Return exactly 3 styleCandidates for the local-original style-board mode. Each candidate must be a distinct product-appropriate visual style direction with Simplified Chinese label/description and English prompt/negativePrompt for a 1024x1024 style reference board.',
    buildFieldLanguageRules(marketplaceId),
    'Do not generate images. Only return JSON matching the schema.',
    baseDraft.category ? `Known category: ${baseDraft.category}` : '',
  ].filter(Boolean).join('\n')
}

function getAPlusPlannerTypeName(aPlusType: APlusContentType) {
  switch (aPlusType) {
    case 'premium':
      return 'Premium A+ Content'
    case 'standard-large':
      return 'Standard A+ Content large-image template'
    default:
      return 'Standard A+ Content'
  }
}

function buildAPlusPlannerInstructions(baseDraft: AmazonPromptDraft, aPlusType: APlusContentType, marketplaceId?: AmazonMarketplaceId) {
  const specs = getAPlusModuleSpecs(aPlusType)
  const typeLabel = getAPlusPlannerTypeName(aPlusType)
  const marketplace = getAmazonMarketplace(marketplaceId)
  return [
    'You are an Amazon A+ Content image-planning agent. The user provides listing copy, optional brand notes, and optional product reference images.',
    buildMarketplaceInstructionBlock(marketplaceId),
    `Create a ${typeLabel} image module plan. Do not generate images. Only return JSON matching the schema.`,
    `Return exactly ${specs.length} modules in this order: ${specs.map((spec) => `${spec.slot} ${spec.label} ${getAPlusModuleUploadSize(spec)}px`).join('; ')}.`,
    'The application only fixes the module order, module type, upload size, and generation size. You must decide the strategy, composition, copy approach, visual treatment, prompt content, and negative prompt content.',
    'Use the Amazon A+ reference material below to improve compliance judgment. It is not a fixed module creative framework, and it must not replace the product facts from the listing and reference images.',
    formatAmazonAPlusReferenceMaterial(marketplaceId),
    PRODUCT_REFERENCE_FACTS_ONLY_PLANNER_GUIDE,
    'For each module, write planMarkdown in Simplified Chinese as a detailed agent-style plan similar to a ChatGPT web response, then write a professional English image prompt and English negative prompt.',
    `Each module prompt should fully plan the finished Amazon image: composition, product evidence, on-image ${marketplace.onImageCopyLanguage} copy when useful, callouts or information areas when useful, visual hierarchy, and rendering style.`,
    'For A+ information modules, prefer complete information design with clear hierarchy and useful product evidence; lifestyle or brand modules should still have purposeful composition and visible product support.',
    baseDraft.brand
      ? `Known brand/model: ${baseDraft.brand}. For header-banner and hero-banner modules, naturally include this real brand/model as a small brand line, headline prefix, or subline when it improves the composition. For brand-story modules, use this brand/model to frame the brand tone or promise only when supported by the provided listing or brand notes.`
      : 'If no real brand/model is provided, do not invent a brand name, logo, trademark, brand history, brand promise, authorization claim, website, contact detail, or external link.',
    'Use brand names as text only unless the user provides a real logo reference image. Do not invent logo artwork, standalone trademark/copyright symbols, brand history, authorization claims, websites, contact details, or external links.',
    'Return one seriesStyleGuide string in English for cross-module product consistency and factual visual continuity. Keep it style-neutral and do not use it to choose the final color palette, typography, background mood, lighting mood, or decorative style.',
    'Return exactly 3 styleCandidates for the local-original style-board mode. Each candidate must be a distinct product-appropriate visual style direction with Simplified Chinese label/description and English prompt/negativePrompt for a 1024x1024 style reference board.',
    `For modules that need external A+ text outside the image, write textTitle and textBody in natural ${marketplace.copyLanguage}. Otherwise return empty strings.`,
    buildFieldLanguageRules(marketplaceId, { includeAPlusExternalText: true }),
    baseDraft.category ? `Known category: ${baseDraft.category}` : '',
  ].filter(Boolean).join('\n')
}

function buildTiktokPlannerInstructions(baseDraft: AmazonPromptDraft, designType: TiktokDesignType) {
  const slots = getTikTokSlots(designType)
  const isDetail = designType === 'detail'
  return [
    'You are a TikTok Shop product image-planning agent. The user provides product copy and optional product reference images.',
    isDetail
      ? `Create exactly ${slots.length} TikTok Shop product detail images in this order: ${slots.join(', ')}. These images explain benefits, scenarios, materials, dimensions, usage, package contents, and trust-building details for a mobile shopping detail page.`
      : `Create exactly ${slots.length} TikTok Shop main product images in this order: ${slots.join(', ')}. These images must work as high-impact square gallery images for a mobile-first TikTok Shop listing.`,
    'The platform is TikTok Shop, not Amazon. Do not include Amazon marks, A+ labels, marketplace badges, fake ratings, prices, discounts, QR codes, contact details, external URLs, platform logos, or unsupported claims.',
    isDetail
      ? 'Use energetic social-commerce composition, strong mobile readability, short US-English on-image copy when useful, product evidence, lifestyle cues, benefit callouts, and clean commercial polish.'
      : 'For TikTok Shop main images, use visual product photography only. Do not add on-image text, callout copy, icons, arrows, badges, frames, decorative overlays, or promotional graphics in any TTM prompt, except that TTM01 may include one small real brand-name mark or real brand logo if the product facts or reference images provide it.',
    isDetail
      ? 'For detail images, use information design with clear hierarchy, detail crops, icons, measurement arrows, usage steps, or comparison areas only when supported by product facts.'
      : TIKTOK_MAIN_SLOT_GUIDE,
    isDetail
      ? ''
      : 'TikTok Shop US main-image compliance baseline: square 1:1 composition, clear color image, truthful product appearance, accurate color/material/quantity/scale/package contents, no misleading AI edits, no placeholder rendering, no low-resolution or damaged-looking image, and only items the customer actually receives unless a contextual scene is needed to show truthful usage.',
    isDetail
      ? ''
      : 'If the product facts or reference images do not support a claimed use, accessory, material, color, quantity, function, brand name, or brand logo, do not invent it. If critical facts are missing, state the uncertainty in planMarkdown and keep the English prompt conservative.',
    'For each slot, write planMarkdown in Simplified Chinese as a detailed agent-style plan, then write a professional English image prompt and English negative prompt.',
    'Return one seriesStyleGuide string in English that can keep separately generated TikTok Shop images visually coherent.',
    'Return exactly 3 styleCandidates for the local-original style-board mode. Each candidate must be a distinct product-appropriate TikTok Shop visual style direction with Simplified Chinese label/description and English prompt/negativePrompt for a 1024x1024 style reference board.',
    'Field language rules: label and planMarkdown must be Simplified Chinese; seriesStyleGuide, prompt, and negativePrompt must be English.',
    'Do not generate images. Only return JSON matching the schema.',
    baseDraft.category ? `Known category: ${baseDraft.category}` : '',
  ].filter(Boolean).join('\n')
}

function buildPlannerInstructions(baseDraft: AmazonPromptDraft, mode: AmazonPlannerMode, aPlusType: APlusContentType, platform: CommercePlannerPlatform, tiktokDesignType: TiktokDesignType, marketplaceId?: AmazonMarketplaceId) {
  if (platform === 'tiktok') return buildTiktokPlannerInstructions(baseDraft, tiktokDesignType)
  return mode === 'aplus'
    ? buildAPlusPlannerInstructions(baseDraft, aPlusType, marketplaceId)
    : buildListingPlannerInstructions(baseDraft, marketplaceId)
}

function buildPlannerInputText(listingText: string, mode: AmazonPlannerMode, aPlusType: APlusContentType, platform: CommercePlannerPlatform, tiktokDesignType: TiktokDesignType, marketplaceId?: AmazonMarketplaceId) {
  if (platform === 'tiktok') {
    const slots = getTikTokSlots(tiktokDesignType)
    return [
      `Parse this product copy and produce the TikTok Shop ${tiktokDesignType === 'detail' ? 'detail image' : 'main image'} plan.`,
      'Use the title and selling points from the pasted text. If a field is uncertain, infer conservatively from the product copy.',
      `Use these image slots exactly: ${slots.join(', ')}.`,
      'If reference images are attached, use them to understand the actual product appearance and included items.',
      '',
      listingText,
    ].join('\n')
  }

  if (mode === 'aplus') {
    const specs = getAPlusModuleSpecs(aPlusType)
    const marketplace = getAmazonMarketplace(marketplaceId)
    return [
      `Parse this ${marketplace.domain} listing copy and produce the ${getAPlusContentTypeLabel(aPlusType)} A+ Content module plan for ${marketplace.label}.`,
      'Use the title and bullet points from the pasted text. If a field is uncertain, infer conservatively from the listing.',
      `Target marketplace language for visible customer-facing copy: ${marketplace.copyLanguage}.`,
      `Use these A+ modules exactly: ${specs.map((spec) => spec.slot).join(', ')}.`,
      'If reference images are attached, use them to understand the actual product appearance and included items.',
      '',
      listingText,
    ].join('\n')
  }

  const marketplace = getAmazonMarketplace(marketplaceId)
  return [
    `Parse this ${marketplace.domain} listing copy and produce the 7-image visual plan for ${marketplace.label}.`,
    'Use the title and bullet points from the pasted text. If a field is uncertain, infer conservatively from the listing.',
    `Target marketplace language for visible customer-facing copy: ${marketplace.copyLanguage}.`,
    'If reference images are attached, use them to understand the actual product appearance and included items.',
    '',
    listingText,
  ].join('\n')
}

function buildChatPlannerUserContent(text: string, referenceImageDataUrls: string[]) {
  if (!referenceImageDataUrls.length) return text
  return [
    { type: 'text', text },
    ...referenceImageDataUrls.map((url) => ({
      type: 'image_url',
      image_url: { url },
    })),
  ]
}

function buildResponsesPlannerInput(text: string, referenceImageDataUrls: string[]) {
  return [
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text,
        },
        ...referenceImageDataUrls.map((url) => ({
          type: 'input_image',
          image_url: url,
        })),
      ],
    },
  ]
}

function buildChatPlannerSchemaGuide(mode: AmazonPlannerMode, aPlusType: APlusContentType, platform: CommercePlannerPlatform, tiktokDesignType: TiktokDesignType, marketplaceId?: AmazonMarketplaceId) {
  const productFields = 'product { title, category, color, material, audience, packageIncludes }'
  const styleFields = 'seriesStyleGuide string, styleCandidates array of exactly 3 style options'
  if (platform === 'tiktok') {
    const slots = getTikTokSlots(tiktokDesignType)
    return [
      `Return JSON with: ${productFields}, sellingPoints string[], ${styleFields}, imagePlans array.`,
      `imagePlans must contain exactly ${slots.length} items in this order: ${slots.join(', ')}.`,
      'Each imagePlans item must include: slot, label, planMarkdown, prompt, negativePrompt.',
    ].join('\n')
  }

  if (mode === 'aplus') {
    const specs = getAPlusModuleSpecs(aPlusType)
    const marketplace = getAmazonMarketplace(marketplaceId)
    return [
      `Return JSON with: ${productFields}, sellingPoints string[], ${styleFields}, aPlusPlans array.`,
      `aPlusPlans must contain exactly ${specs.length} items in this order: ${specs.map((spec) => spec.slot).join(', ')}.`,
      'Each aPlusPlans item must include: slot, label, moduleType, planMarkdown, textTitle, textBody, prompt, negativePrompt.',
      `textTitle/textBody and visible on-image copy must use natural ${marketplace.copyLanguage} for ${marketplace.domain}; prompt and negativePrompt should remain English.`,
    ].join('\n')
  }

  const marketplace = getAmazonMarketplace(marketplaceId)
  return [
    `Return JSON with: ${productFields}, sellingPoints string[], ${styleFields}, imagePlans array.`,
    'imagePlans must contain exactly 7 items in this order: MAIN, PT01, PT02, PT03, PT04, PT05, PT06.',
    'Each imagePlans item must include: slot, label, planMarkdown, prompt, negativePrompt.',
    `Visible on-image copy inside prompt must use natural ${marketplace.copyLanguage} for ${marketplace.domain}; prompt and negativePrompt should remain English.`,
  ].join('\n')
}

function buildChatPlannerSystemPrompt(
  baseDraft: AmazonPromptDraft,
  mode: AmazonPlannerMode,
  aPlusType: APlusContentType,
  platform: CommercePlannerPlatform,
  tiktokDesignType: TiktokDesignType,
  marketplaceId?: AmazonMarketplaceId,
) {
  return [
    buildPlannerInstructions(baseDraft, mode, aPlusType, platform, tiktokDesignType, marketplaceId),
    'Return a valid JSON object only. Do not output Markdown fences, comments, or any text outside the JSON object.',
    buildChatPlannerSchemaGuide(mode, aPlusType, platform, tiktokDesignType, marketplaceId),
  ].join('\n\n')
}

export async function callAmazonPlannerApi(options: {
  listingText: string
  baseDraft: AmazonPromptDraft
  profile: ApiProfile
  referenceImageDataUrls?: string[]
  model?: string
  mode?: AmazonPlannerMode
  platform?: CommercePlannerPlatform
  marketplaceId?: AmazonMarketplaceId
  tiktokDesignType?: TiktokDesignType
  aPlusType?: APlusContentType
  aPlusGenerationTier?: SizeTier
  signal?: AbortSignal
}): Promise<PlannerApiResult> {
  const model = options.model?.trim() || options.profile.model.trim() || (options.profile.apiMode === 'chat' ? DEFAULT_CHAT_MODEL : DEFAULT_RESPONSES_MODEL)
  const mode = options.mode ?? 'listing'
  const platform = options.platform ?? 'amazon'
  const marketplaceId = normalizeAmazonMarketplaceId(options.marketplaceId)
  const tiktokDesignType = options.tiktokDesignType ?? 'main'
  const aPlusType = options.aPlusType ?? 'standard-large'
  const aPlusGenerationTier = options.aPlusGenerationTier ?? '2K'
  const schema = platform === 'tiktok'
    ? createTiktokPlannerSchema(tiktokDesignType)
    : mode === 'aplus' ? createAPlusPlannerSchema(aPlusType, marketplaceId) : createListingPlannerSchema(marketplaceId)
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(options.profile.apiProxy, proxyConfig)
  const useChatCompletions = options.profile.apiMode === 'chat'
  const inputText = buildPlannerInputText(options.listingText, mode, aPlusType, platform, tiktokDesignType, marketplaceId)
  const referenceImageDataUrls = options.referenceImageDataUrls ?? []
  const response = await fetch(
    useChatCompletions
      ? buildApiUrl(options.profile.baseUrl, 'chat/completions', proxyConfig, useApiProxy, { prefixV1: false })
      : buildApiUrl(options.profile.baseUrl, 'responses', proxyConfig, useApiProxy),
    {
    method: 'POST',
    signal: options.signal,
    headers: {
      Authorization: `Bearer ${options.profile.apiKey}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify(useChatCompletions
      ? {
          model,
          messages: [
            {
              role: 'system',
              content: buildChatPlannerSystemPrompt(options.baseDraft, mode, aPlusType, platform, tiktokDesignType, marketplaceId),
            },
            {
              role: 'user',
              content: buildChatPlannerUserContent(inputText, referenceImageDataUrls),
            },
          ],
          response_format: { type: 'json_object' },
          stream: false,
        }
      : {
          model,
          instructions: buildPlannerInstructions(options.baseDraft, mode, aPlusType, platform, tiktokDesignType, marketplaceId),
          input: buildResponsesPlannerInput(inputText, referenceImageDataUrls),
          text: {
            format: {
              type: 'json_schema',
              name: platform === 'tiktok' ? `tiktok_${tiktokDesignType}_image_plan` : mode === 'aplus' ? 'amazon_aplus_image_plan' : 'amazon_listing_image_plan',
              strict: true,
              schema,
            },
          },
          stream: false,
        },
    ),
    },
  )

  if (!response.ok) {
    const message = await getApiErrorMessage(response)
    throw new Error(`HTTP ${response.status}: ${message}`)
  }
  const text = await readPlannerResponseText(response)
  const payload = parsePlannerPayload(text)
  if (platform === 'tiktok') return normalizeListingPlannerApiPayload(payload, [...getTikTokSlots(tiktokDesignType)])
  return mode === 'aplus'
    ? normalizeAPlusPlannerApiPayload(payload, aPlusType, aPlusGenerationTier, marketplaceId)
    : normalizeListingPlannerApiPayload(payload, undefined, marketplaceId)
}
