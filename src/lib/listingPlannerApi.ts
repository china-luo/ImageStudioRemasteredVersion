import type { ApiProfile } from '../types'
import { DEFAULT_CHAT_MODEL, DEFAULT_RESPONSES_MODEL } from './apiProfiles'
import { formatAmazonAPlusReferenceMaterial, formatAmazonListingReferenceMaterial } from './amazonKnowledge'
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

const LISTING_PLANNER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    product: PRODUCT_SCHEMA,
    sellingPoints: SELLING_POINTS_SCHEMA,
    seriesStyleGuide: {
      type: 'string',
      description: 'LLM-authored English visual style guide to keep the whole image set coherent.',
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
          prompt: ENGLISH_IMAGE_PROMPT_SCHEMA,
          negativePrompt: NEGATIVE_PROMPT_SCHEMA,
        },
        required: ['slot', 'label', 'planMarkdown', 'prompt', 'negativePrompt'],
      },
    },
  },
  required: ['product', 'sellingPoints', 'seriesStyleGuide', 'styleCandidates', 'imagePlans'],
} as const

const TIKTOK_MAIN_SLOTS = ['TTM01', 'TTM02', 'TTM03', 'TTM04', 'TTM05', 'TTM06'] as const
const TIKTOK_DETAIL_SLOTS = ['TTD01', 'TTD02', 'TTD03', 'TTD04', 'TTD05', 'TTD06', 'TTD07', 'TTD08'] as const

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

function createAPlusPlannerSchema(aPlusType: APlusContentType) {
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
            textTitle: { type: 'string' },
            textBody: { type: 'string' },
            prompt: ENGLISH_IMAGE_PROMPT_SCHEMA,
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

function normalizeListingPlannerApiPayload(payload: PlannerApiPayload, slots = ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06']): PlannerApiResult {
  const parsed = normalizeParsedListing(payload)
  const seriesStyleGuide = normalizeSeriesStyleGuide(payload)
  const styleCandidates = normalizeStyleCandidates(payload)
  const plans = Array.isArray(payload.imagePlans)
    ? payload.imagePlans.map((plan, index) => normalizePlan(plan, index, slots)).filter((plan) => plan.prompt.trim() && plan.planMarkdown.trim()).slice(0, slots.length)
    : []

  if (plans.length !== slots.length) throw new Error(`AI 策划结果不是 ${slots.length} 张图`)
  if (styleCandidates.length !== 3) throw new Error('AI 策划结果不是 3 个风格候选')

  return {
    mode: 'listing',
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

function normalizeAPlusPlannerApiPayload(payload: PlannerApiPayload, aPlusType: APlusContentType, tier: SizeTier): PlannerApiResult {
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
  if (styleCandidates.length !== 3) throw new Error('AI A+ 策划结果不是 3 个风格候选')

  return {
    mode: 'aplus',
    parsed,
    seriesStyleGuide,
    styleCandidates,
    plans: [],
    aPlusPlans,
    aPlusType,
  }
}

function buildListingPlannerInstructions(baseDraft: AmazonPromptDraft) {
  return [
    'You are an Amazon image-planning agent. The user provides listing copy and optional product reference images.',
    'Create a complete visual plan for exactly 7 Amazon listing image slots: MAIN, PT01, PT02, PT03, PT04, PT05, PT06.',
    'The application only fixes the slot count and order. You must decide the strategy, composition, copy approach, visual treatment, prompt content, and negative prompt content.',
    'Use the Amazon reference material below to improve compliance judgment. It is not a fixed slot-by-slot framework, and it must not replace the product facts from the listing and reference images.',
    formatAmazonListingReferenceMaterial(),
    'For each slot, write planMarkdown in Simplified Chinese as a detailed agent-style plan similar to a ChatGPT web response, then write a professional English image prompt and English negative prompt.',
    'Each image prompt should fully plan the finished Amazon image: composition, product evidence, on-image US-English copy when useful, callouts or information areas when useful, visual hierarchy, and rendering style.',
    'For secondary information images, prefer complete information design with clear hierarchy and useful product evidence; lifestyle or beauty slots should still have purposeful composition and visible product support.',
    'Return one seriesStyleGuide string in English that can keep separately generated images visually coherent.',
    'Return exactly 3 styleCandidates for low-resolution visual style reference board generation. Each candidate should represent a distinct coherent visual style choice for this same product, not a finished Amazon listing image.',
    'For each styleCandidates.prompt, describe a 1024x1024 visual style reference board with visible typography samples, color palette swatches, lighting/material samples, background/material texture samples, product-finish detail samples, and icon/callout treatment.',
    'The style board typography samples must use generic English placeholder words only, such as PRODUCT TITLE, KEY BENEFIT, DETAIL CALLOUT, 01, 02, 03. Do not include Chinese characters, real product claims, brand logos, Amazon marks, prices, promotions, QR codes, contact details, or external URLs in styleCandidates.prompt.',
    'Field language rules: label and planMarkdown must be Simplified Chinese; seriesStyleGuide, prompt, negativePrompt, and styleCandidates.prompt/negativePrompt must be English.',
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

function buildAPlusPlannerInstructions(baseDraft: AmazonPromptDraft, aPlusType: APlusContentType) {
  const specs = getAPlusModuleSpecs(aPlusType)
  const typeLabel = getAPlusPlannerTypeName(aPlusType)
  return [
    'You are an Amazon A+ Content image-planning agent. The user provides listing copy, optional brand notes, and optional product reference images.',
    `Create a ${typeLabel} image module plan. Do not generate images. Only return JSON matching the schema.`,
    `Return exactly ${specs.length} modules in this order: ${specs.map((spec) => `${spec.slot} ${spec.label} ${getAPlusModuleUploadSize(spec)}px`).join('; ')}.`,
    'The application only fixes the module order, module type, upload size, and generation size. You must decide the strategy, composition, copy approach, visual treatment, prompt content, and negative prompt content.',
    'Use the Amazon A+ reference material below to improve compliance judgment. It is not a fixed module creative framework, and it must not replace the product facts from the listing and reference images.',
    formatAmazonAPlusReferenceMaterial(),
    'For each module, write planMarkdown in Simplified Chinese as a detailed agent-style plan similar to a ChatGPT web response, then write a professional English image prompt and English negative prompt.',
    'Each module prompt should fully plan the finished Amazon image: composition, product evidence, on-image US-English copy when useful, callouts or information areas when useful, visual hierarchy, and rendering style.',
    'For A+ information modules, prefer complete information design with clear hierarchy and useful product evidence; lifestyle or brand modules should still have purposeful composition and visible product support.',
    baseDraft.brand
      ? `Known brand/model: ${baseDraft.brand}. For header-banner and hero-banner modules, naturally include this real brand/model as a small brand line, headline prefix, or subline when it improves the composition. For brand-story modules, use this brand/model to frame the brand tone or promise only when supported by the provided listing or brand notes.`
      : 'If no real brand/model is provided, do not invent a brand name, logo, trademark, brand history, brand promise, authorization claim, website, contact detail, or external link.',
    'Use brand names as text only unless the user provides a real logo reference image. Do not invent logo artwork, standalone trademark/copyright symbols, brand history, authorization claims, websites, contact details, or external links.',
    'Return one seriesStyleGuide string in English that can keep separately generated modules visually coherent.',
    'Return exactly 3 styleCandidates for low-resolution visual style reference board generation. Each candidate should represent a distinct coherent visual style choice for this same product and A+ set, not a finished Amazon A+ module.',
    'For each styleCandidates.prompt, describe a 1024x1024 visual style reference board with visible typography samples, color palette swatches, lighting/material samples, background/material texture samples, product-finish detail samples, and icon/callout treatment.',
    'The style board typography samples must use generic English placeholder words only, such as PRODUCT TITLE, KEY BENEFIT, DETAIL CALLOUT, 01, 02, 03. Do not include Chinese characters, real product claims, brand logos, Amazon marks, prices, promotions, QR codes, contact details, or external URLs in styleCandidates.prompt.',
    'For modules that need external A+ text outside the image, write textTitle and textBody in natural US English. Otherwise return empty strings.',
    'Field language rules: label and planMarkdown must be Simplified Chinese; textTitle/textBody must be English or empty; seriesStyleGuide, prompt, negativePrompt, and styleCandidates.prompt/negativePrompt must be English.',
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
    'Use energetic social-commerce composition, strong mobile readability, short US-English on-image copy when useful, product evidence, lifestyle cues, benefit callouts, and clean commercial polish.',
    'For the first main image, keep the product unmistakably dominant and avoid clutter. For detail images, use information design with clear hierarchy, detail crops, icons, measurement arrows, usage steps, or comparison areas only when supported by product facts.',
    'For each slot, write planMarkdown in Simplified Chinese as a detailed agent-style plan, then write a professional English image prompt and English negative prompt.',
    'Return one seriesStyleGuide string in English that can keep separately generated TikTok Shop images visually coherent.',
    'Return exactly 3 styleCandidates for low-resolution visual style reference board generation. Each candidate should represent a distinct coherent TikTok Shop visual style choice for this product, not a finished product image.',
    'For each styleCandidates.prompt, describe a 1024x1024 visual style reference board with visible typography samples, color palette swatches, lighting/material samples, background/material texture samples, product-finish detail samples, and icon/callout treatment.',
    'The style board typography samples must use generic English placeholder words only, such as PRODUCT TITLE, KEY BENEFIT, DETAIL CALLOUT, 01, 02, 03. Do not include Chinese characters, real product claims, brand logos, TikTok marks, Amazon marks, prices, promotions, QR codes, contact details, or external URLs in styleCandidates.prompt.',
    'Field language rules: label and planMarkdown must be Simplified Chinese; seriesStyleGuide, prompt, negativePrompt, and styleCandidates.prompt/negativePrompt must be English.',
    'Do not generate images. Only return JSON matching the schema.',
    baseDraft.category ? `Known category: ${baseDraft.category}` : '',
  ].filter(Boolean).join('\n')
}

function buildPlannerInstructions(baseDraft: AmazonPromptDraft, mode: AmazonPlannerMode, aPlusType: APlusContentType, platform: CommercePlannerPlatform, tiktokDesignType: TiktokDesignType) {
  if (platform === 'tiktok') return buildTiktokPlannerInstructions(baseDraft, tiktokDesignType)
  return mode === 'aplus'
    ? buildAPlusPlannerInstructions(baseDraft, aPlusType)
    : buildListingPlannerInstructions(baseDraft)
}

function buildPlannerInputText(listingText: string, mode: AmazonPlannerMode, aPlusType: APlusContentType, platform: CommercePlannerPlatform, tiktokDesignType: TiktokDesignType) {
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
    return [
      `Parse this Amazon listing copy and produce the ${getAPlusContentTypeLabel(aPlusType)} A+ Content module plan.`,
      'Use the title and bullet points from the pasted text. If a field is uncertain, infer conservatively from the listing.',
      `Use these A+ modules exactly: ${specs.map((spec) => spec.slot).join(', ')}.`,
      'If reference images are attached, use them to understand the actual product appearance and included items.',
      '',
      listingText,
    ].join('\n')
  }

  return [
    'Parse this Amazon listing copy and produce the 7-image visual plan.',
    'Use the title and bullet points from the pasted text. If a field is uncertain, infer conservatively from the listing.',
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

function buildChatPlannerSchemaGuide(mode: AmazonPlannerMode, aPlusType: APlusContentType, platform: CommercePlannerPlatform, tiktokDesignType: TiktokDesignType) {
  const productFields = 'product { title, category, color, material, audience, packageIncludes }'
  const styleFields = 'seriesStyleGuide string, styleCandidates array of exactly 3 { label, description, prompt, negativePrompt }'
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
    return [
      `Return JSON with: ${productFields}, sellingPoints string[], ${styleFields}, aPlusPlans array.`,
      `aPlusPlans must contain exactly ${specs.length} items in this order: ${specs.map((spec) => spec.slot).join(', ')}.`,
      'Each aPlusPlans item must include: slot, label, moduleType, planMarkdown, textTitle, textBody, prompt, negativePrompt.',
    ].join('\n')
  }

  return [
    `Return JSON with: ${productFields}, sellingPoints string[], ${styleFields}, imagePlans array.`,
    'imagePlans must contain exactly 7 items in this order: MAIN, PT01, PT02, PT03, PT04, PT05, PT06.',
    'Each imagePlans item must include: slot, label, planMarkdown, prompt, negativePrompt.',
  ].join('\n')
}

function buildChatPlannerSystemPrompt(
  baseDraft: AmazonPromptDraft,
  mode: AmazonPlannerMode,
  aPlusType: APlusContentType,
  platform: CommercePlannerPlatform,
  tiktokDesignType: TiktokDesignType,
) {
  return [
    buildPlannerInstructions(baseDraft, mode, aPlusType, platform, tiktokDesignType),
    'Return a valid JSON object only. Do not output Markdown fences, comments, or any text outside the JSON object.',
    buildChatPlannerSchemaGuide(mode, aPlusType, platform, tiktokDesignType),
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
  tiktokDesignType?: TiktokDesignType
  aPlusType?: APlusContentType
  aPlusGenerationTier?: SizeTier
  signal?: AbortSignal
}): Promise<PlannerApiResult> {
  const model = options.model?.trim() || options.profile.model.trim() || (options.profile.apiMode === 'chat' ? DEFAULT_CHAT_MODEL : DEFAULT_RESPONSES_MODEL)
  const mode = options.mode ?? 'listing'
  const platform = options.platform ?? 'amazon'
  const tiktokDesignType = options.tiktokDesignType ?? 'main'
  const aPlusType = options.aPlusType ?? 'standard-large'
  const aPlusGenerationTier = options.aPlusGenerationTier ?? '2K'
  const schema = platform === 'tiktok'
    ? createTiktokPlannerSchema(tiktokDesignType)
    : mode === 'aplus' ? createAPlusPlannerSchema(aPlusType) : LISTING_PLANNER_SCHEMA
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(options.profile.apiProxy, proxyConfig)
  const useChatCompletions = options.profile.apiMode === 'chat'
  const inputText = buildPlannerInputText(options.listingText, mode, aPlusType, platform, tiktokDesignType)
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
              content: buildChatPlannerSystemPrompt(options.baseDraft, mode, aPlusType, platform, tiktokDesignType),
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
          instructions: buildPlannerInstructions(options.baseDraft, mode, aPlusType, platform, tiktokDesignType),
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
    ? normalizeAPlusPlannerApiPayload(payload, aPlusType, aPlusGenerationTier)
    : normalizeListingPlannerApiPayload(payload)
}
