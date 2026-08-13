import type { AmazonImageKind, AmazonPromptDraft } from './amazonPrompt'
import type { AmazonStyleDensityMode } from '../types'
import { calculateImageSize, type SizeTier } from './size'
import { getAmazonMarketplace, type AmazonMarketplaceId } from './amazonMarketplaces'

export type AmazonPlannerMode = 'listing' | 'aplus'
export type CommercePlannerPlatform = 'amazon' | 'tiktok'
export type TiktokDesignType = 'main' | 'detail'
export type { AmazonStyleDensityMode } from '../types'
export type APlusContentType = 'standard' | 'standard-large' | 'premium' | 'mobile'
export type APlusModuleKind =
  | 'header-banner'
  | 'single-image'
  | 'highlight-tile'
  | 'hero-banner'
  | 'feature-image'
  | 'brand-story'
  | 'logo'
  | 'comparison-thumbnail'

export const A_PLUS_CONTENT_TYPES: APlusContentType[] = ['standard-large', 'standard', 'premium', 'mobile']
export const MIN_A_PLUS_MODULE_COUNT = 1
export const MAX_A_PLUS_MODULE_COUNT = 12

const A_PLUS_MODULE_KINDS: APlusModuleKind[] = [
  'header-banner', 'single-image', 'highlight-tile', 'hero-banner',
  'feature-image', 'brand-story', 'logo', 'comparison-thumbnail',
]

export interface ListingParseResult {
  title: string
  bullets: string[]
  inferred: Partial<AmazonPromptDraft>
}

export interface AmazonStyleCandidate {
  label: string
  description: string
  prompt: string
  negativePrompt: string
}

export interface AmazonImagePlan {
  slot: string
  label: string
  kind?: AmazonImageKind
  planMarkdown: string
  prompt: string
  negativePrompt: string
}

export interface AmazonAPlusModuleSpec {
  contentType: APlusContentType | 'optional'
  slot: string
  label: string
  displayLabel: string
  moduleType: APlusModuleKind
  uploadWidth: number
  uploadHeight: number
  objective: string
}

export interface AmazonAPlusPlan {
  slot: string
  label: string
  moduleType: APlusModuleKind
  uploadSize: string
  generationSize: string
  planMarkdown: string
  textTitle: string
  textBody: string
  prompt: string
  negativePrompt: string
}

export const STANDARD_A_PLUS_MODULE_SPECS: AmazonAPlusModuleSpec[] = [
  {
    contentType: 'standard',
    slot: 'A+S01',
    label: 'Header Banner',
    displayLabel: '顶部横幅',
    moduleType: 'header-banner',
    uploadWidth: 970,
    uploadHeight: 300,
    objective: '用横幅建立品牌质感和核心产品利益点。',
  },
  ...Array.from({ length: 3 }, (_, index) => ({
    contentType: 'standard' as const,
    slot: `A+S0${index + 2}`,
    label: `Single Image ${index + 1}`,
    displayLabel: `大图模块 ${index + 1}`,
    moduleType: 'single-image' as const,
    uploadWidth: 970,
    uploadHeight: 600,
    objective: '用单图模块讲清一个关键卖点或使用场景。',
  })),
  ...Array.from({ length: 4 }, (_, index) => ({
    contentType: 'standard' as const,
    slot: `A+S0${index + 5}`,
    label: `Highlight Tile ${index + 1}`,
    displayLabel: `卖点方块 ${index + 1}`,
    moduleType: 'highlight-tile' as const,
    uploadWidth: 220,
    uploadHeight: 220,
    objective: '用方形图块快速呈现一个产品亮点。',
  })),
]

export const STANDARD_LARGE_A_PLUS_MODULE_SPECS: AmazonAPlusModuleSpec[] = [
  {
    contentType: 'standard-large',
    slot: 'A+L01',
    label: 'Header Banner',
    displayLabel: '顶部横幅',
    moduleType: 'header-banner',
    uploadWidth: 970,
    uploadHeight: 300,
    objective: '用横幅建立品牌质感和核心产品利益点。',
  },
  ...Array.from({ length: 4 }, (_, index) => ({
    contentType: 'standard-large' as const,
    slot: `A+L0${index + 2}`,
    label: `Single Image ${index + 1}`,
    displayLabel: `大图模块 ${index + 1}`,
    moduleType: 'single-image' as const,
    uploadWidth: 970,
    uploadHeight: 600,
    objective: '用整张大图讲清一个关键卖点、使用场景或细节证据。',
  })),
]

export const PREMIUM_A_PLUS_MODULE_SPECS: AmazonAPlusModuleSpec[] = [
  {
    contentType: 'premium',
    slot: 'A+P01',
    label: 'Hero Banner',
    displayLabel: '高级首屏横幅',
    moduleType: 'hero-banner',
    uploadWidth: 1464,
    uploadHeight: 600,
    objective: '用高级横幅建立首屏视觉冲击和品牌氛围。',
  },
  ...Array.from({ length: 3 }, (_, index) => ({
    contentType: 'premium' as const,
    slot: `A+P0${index + 2}`,
    label: `Feature Image ${index + 1}`,
    displayLabel: `高级大图模块 ${index + 1}`,
    moduleType: 'feature-image' as const,
    uploadWidth: 970,
    uploadHeight: 600,
    objective: '用大图模块展示核心功能、材质或真实场景。',
  })),
  ...Array.from({ length: 2 }, (_, index) => ({
    contentType: 'premium' as const,
    slot: `A+P0${index + 5}`,
    label: `Brand Story ${index + 1}`,
    displayLabel: `品牌故事 ${index + 1}`,
    moduleType: 'brand-story' as const,
    uploadWidth: 463,
    uploadHeight: 625,
    objective: '用竖版品牌故事模块强化信任和使用想象。',
  })),
]

export const MOBILE_A_PLUS_MODULE_SPECS: AmazonAPlusModuleSpec[] = [
  {
    contentType: 'mobile',
    slot: 'A+M01',
    label: 'Mobile Hero',
    displayLabel: '手机首屏',
    moduleType: 'hero-banner',
    uploadWidth: 600,
    uploadHeight: 450,
    objective: '用移动端首屏图建立产品核心卖点和清晰视觉吸引力。',
  },
  ...Array.from({ length: 4 }, (_, index) => ({
    contentType: 'mobile' as const,
    slot: `A+M0${index + 2}`,
    label: `Mobile Feature ${index + 1}`,
    displayLabel: `手机卖点图 ${index + 1}`,
    moduleType: 'feature-image' as const,
    uploadWidth: 600,
    uploadHeight: 450,
    objective: '用移动端友好的 4:3 图片讲清一个关键卖点、细节证据或使用场景。',
  })),
]

export const OPTIONAL_A_PLUS_MODULE_SPECS: AmazonAPlusModuleSpec[] = [
  {
    contentType: 'optional',
    slot: 'A+LOGO',
    label: 'Logo Image',
    displayLabel: '品牌 Logo',
    moduleType: 'logo',
    uploadWidth: 600,
    uploadHeight: 180,
    objective: '用于已有品牌标识素材，不默认生成虚构 Logo。',
  },
  {
    contentType: 'optional',
    slot: 'A+CMP',
    label: 'Comparison Thumbnail',
    displayLabel: '对比缩略图',
    moduleType: 'comparison-thumbnail',
    uploadWidth: 150,
    uploadHeight: 300,
    objective: '用于同品牌 SKU 对比，不默认生成不确定对比信息。',
  },
]

const CJK_ON_IMAGE_TEXT_RE = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/
const STYLE_REFERENCE_GUARD = [
  'Style reference rule:',
  '- The last input image is a hidden style reference selected by the user.',
  '- Use it only for color palette, lighting, contrast, material finish, typography feel, and overall visual polish.',
  '- Do not copy any placeholder words, fixed layout, color swatch positions, exact composition, product arrangement, product count, props, scene, or information density from the style reference board.',
  '- Follow the image task, layout density, and negative prompt sections for the actual content and arrangement.',
].join('\n')

const AMAZON_STYLE_DENSITY_GUIDES: Record<AmazonStyleDensityMode, string> = {
  rich: [
    'Layout density:',
    '- Use a polished, information-rich Amazon gallery layout when the selected image type benefits from explanation.',
    '- Build clear hierarchy with mobile-readable US-English copy, multiple well-spaced callouts, detail crops, comparison areas, measurement arrows, or use-case zones as appropriate.',
    '- Keep the composition premium and organized; information-rich should still be readable, balanced, and uncluttered.',
  ].join('\n'),
  minimal: [
    'Layout density:',
    '- Use a refined minimal Amazon layout with fewer callouts, generous balanced spacing, light icon or line treatment, and restrained US-English copy.',
    '- Keep the product and one or two strongest messages dominant, with clean hierarchy and no clutter.',
  ].join('\n'),
}

function getTiktokMainImageGenerationRules(slot?: string | null) {
  const normalizedSlot = slot?.trim().toUpperCase()
  const isFirstMainImage = normalizedSlot === 'TTM01'
  return [
    'TikTok Shop US main image generation rules:',
    '- Treat this as a TikTok Shop US main-image candidate, not an Amazon image and not a detail infographic.',
    '- Use square 1:1 commercial product photography with truthful product appearance, accurate color, material, quantity, scale, packaging, and included accessories.',
    isFirstMainImage
      ? '- TTM01 must stay on a clean pure white background and show the complete product clearly. It may include one small real brand-name mark or real brand logo only if the brand is provided by the product facts or reference images; do not invent brand artwork.'
      : '- TTM01 must stay on a clean pure white background and show the complete product clearly.',
    '- TTM02-TTM06 may use clean hero lighting, realistic US lifestyle usage, visual pain-point solution scenes, material/value close-ups, or device-function multi-scenario compositions only when supported by the product facts.',
    isFirstMainImage
      ? '- Do not add any on-image text other than the optional small real brand-name mark on TTM01. No watermark, border, frame, badge, sticker, seller logo, TikTok logo, marketplace logo, QR code, barcode, URL, price, discount, coupon, free shipping, best-seller mark, trending mark, rating stars, review text, icon callouts, arrows, measurement labels, or promotional graphics.'
      : '- Do not add any on-image text, watermark, border, frame, badge, sticker, seller logo, TikTok logo, marketplace logo, QR code, barcode, URL, price, discount, coupon, free shipping, best-seller mark, trending mark, rating stars, review text, icon callouts, arrows, measurement labels, or promotional graphics.',
    '- Do not invent extra accessories, functions, colors, materials, package contents, impossible use cases, exaggerated before-after effects, brand names, brand logos, or misleading AI edits.',
  ].join('\n')
}

const TIKTOK_MAIN_STYLE_DENSITY_GUIDES: Record<AmazonStyleDensityMode, string> = {
  rich: [
    'Layout density:',
    '- Use a premium scroll-stopping TikTok Shop main-image composition with strong product dominance, crisp lighting, clean depth, and mobile thumbnail clarity.',
    '- Keep the image visually rich through photography, scene choice, material detail, and product evidence, not through text, callouts, icons, arrows, badges, or promotional overlays, except the optional small real brand-name mark allowed on TTM01.',
    '- Keep the composition clean, truthful, and easy to understand at a glance on a phone screen.',
  ].join('\n'),
  minimal: [
    'Layout density:',
    '- Use a refined minimal TikTok Shop main-image composition with clean spacing, strong product silhouette, premium lighting, and no clutter.',
    '- Keep the product dominant and avoid all on-image text, callouts, icons, arrows, badges, or promotional overlays, except the optional small real brand-name mark allowed on TTM01.',
  ].join('\n'),
}

const TIKTOK_DETAIL_STYLE_DENSITY_GUIDES: Record<AmazonStyleDensityMode, string> = {
  rich: [
    'Layout density:',
    '- Use a polished, information-rich TikTok Shop mobile product image layout when the selected image type benefits from explanation.',
    '- Build clear hierarchy with mobile-readable US-English copy, multiple well-spaced callouts, detail crops, comparison areas, measurement arrows, or use-case zones as appropriate.',
    '- Keep the composition energetic, scroll-stopping, organized, and readable on a phone screen without clutter.',
  ].join('\n'),
  minimal: [
    'Layout density:',
    '- Use a refined minimal TikTok Shop layout with fewer callouts, generous balanced spacing, light icon or line treatment, and restrained US-English copy.',
    '- Keep the product and one or two strongest messages dominant, with clean mobile-first hierarchy and no clutter.',
  ].join('\n'),
}

const STYLE_REFERENCE_BOARD_REQUIREMENTS = [
  'Style reference board requirements:',
  '- Create a 1024x1024 visual style reference board, not a final Amazon product image.',
  '- The board must visibly include typography samples: a large headline, a smaller subheading, numeric callout samples, short label/caption samples, and icon/callout treatment.',
  '- Use generic English placeholder typography only, such as PRODUCT TITLE, KEY BENEFIT, DETAIL CALLOUT, 01, 02, 03. Do not use Chinese characters, real product claims, brand logos, Amazon marks, prices, promotions, QR codes, contact details, or external URLs.',
  '- The board must visibly include color palette swatches, background/material texture samples, lighting/material samples, and a small product-finish or product-detail style sample derived from the uploaded product references.',
  '- Keep this as a reusable style guide image for later generations, with clear examples of font feeling, color tone, lighting, material finish, icon/callout language, and visual polish.',
].join('\n')

export function isAmazonListingMainSlot(slot?: string | null): boolean {
  return slot?.trim().toUpperCase() === 'MAIN'
}

export function isCommerceMainSlot(platform: CommercePlannerPlatform, slot?: string | null): boolean {
  const normalized = slot?.trim().toUpperCase()
  if (platform === 'amazon') return normalized === 'MAIN'
  return normalized === 'TTM01'
}

export function normalizeOnImageCopy(copy: string): string {
  return copy
    .replace(/\\n/g, '\n')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !CJK_ON_IMAGE_TEXT_RE.test(line))
    .join('\n')
}

function formatPromptBlock(options: {
  prompt: string
  negativePrompt?: string
  seriesStyleGuide?: string | null
  additionalGuidance?: string | null
  styleReferenceAttached?: boolean
  styleDensityMode?: AmazonStyleDensityMode
  styleDensityGuides?: Record<AmazonStyleDensityMode, string>
}) {
  const styleDensityGuides = options.styleDensityGuides ?? AMAZON_STYLE_DENSITY_GUIDES
  const sections = [
    options.prompt.trim(),
    options.seriesStyleGuide?.trim()
      ? `Series style guide:\n${options.seriesStyleGuide.trim()}`
      : '',
    options.additionalGuidance?.trim() || '',
    options.styleReferenceAttached ? styleDensityGuides[options.styleDensityMode ?? 'rich'] : '',
    options.negativePrompt?.trim()
      ? `Negative prompt:\n${options.negativePrompt.trim()}`
      : '',
    options.styleReferenceAttached ? STYLE_REFERENCE_GUARD : '',
  ].filter(Boolean)

  return sections.join('\n\n')
}

function getAmazonMarketplacePromptGuidance(marketplaceId?: AmazonMarketplaceId) {
  const marketplace = getAmazonMarketplace(marketplaceId)
  return [
    `Target marketplace: ${marketplace.label} (${marketplace.domain}).`,
    'Keep all image-generation instructions written in English for image-model stability.',
    `Any visible customer-facing copy rendered inside the image must be natural ${marketplace.onImageCopyLanguage}.`,
    ...marketplace.localGuidance,
  ].join('\n')
}

export function buildAmazonPlanPrompt(plan: Pick<AmazonImagePlan, 'prompt' | 'negativePrompt'> & {
  seriesStyleGuide?: string | null
  styleReferenceAttached?: boolean
  styleDensityMode?: AmazonStyleDensityMode
  marketplaceId?: AmazonMarketplaceId
}): string {
  return formatPromptBlock({
    ...plan,
    additionalGuidance: getAmazonMarketplacePromptGuidance(plan.marketplaceId),
  })
}

export function buildTiktokPlanPrompt(plan: Pick<AmazonImagePlan, 'prompt' | 'negativePrompt'> & {
  slot?: string | null
  seriesStyleGuide?: string | null
  styleReferenceAttached?: boolean
  styleDensityMode?: AmazonStyleDensityMode
}): string {
  const isMainImageSlot = plan.slot?.trim().toUpperCase().startsWith('TTM')
  return formatPromptBlock({
    ...plan,
    additionalGuidance: isMainImageSlot ? getTiktokMainImageGenerationRules(plan.slot) : null,
    styleDensityGuides: isMainImageSlot ? TIKTOK_MAIN_STYLE_DENSITY_GUIDES : TIKTOK_DETAIL_STYLE_DENSITY_GUIDES,
  })
}

export function buildAmazonStyleCandidatePrompt(candidate: AmazonStyleCandidate, seriesStyleGuide?: string | null) {
  return [
    candidate.prompt.trim(),
    STYLE_REFERENCE_BOARD_REQUIREMENTS,
    seriesStyleGuide?.trim() ? `Series style guide:\n${seriesStyleGuide.trim()}` : '',
    candidate.negativePrompt.trim() ? `Negative prompt:\n${candidate.negativePrompt.trim()}` : '',
  ].filter(Boolean).join('\n\n')
}

function formatAPlusUploadSize(spec: Pick<AmazonAPlusModuleSpec, 'uploadWidth' | 'uploadHeight'>): string {
  return `${spec.uploadWidth}x${spec.uploadHeight}`
}

function getSafeAPlusRatio(width: number, height: number): string {
  const ratio = width / height
  if (ratio > 3) return '3:1'
  if (ratio < 1 / 3) return '1:3'
  return `${width}:${height}`
}

function getAPlusGenerationSizeFromDimensions(width: number, height: number, tier: SizeTier): string {
  return calculateImageSize(tier, getSafeAPlusRatio(width, height)) ?? (tier === '4K' ? '2880x2880' : '2048x2048')
}

function getAPlusModuleSlotPrefix(type: APlusContentType): string {
  if (type === 'premium') return 'A+P'
  if (type === 'mobile') return 'A+M'
  if (type === 'standard-large') return 'A+L'
  return 'A+S'
}

function isAPlusModuleKind(value: unknown): value is APlusModuleKind {
  return typeof value === 'string' && A_PLUS_MODULE_KINDS.includes(value as APlusModuleKind)
}

function getAPlusModuleTypeText(type: APlusContentType, moduleType: APlusModuleKind, ordinal: number) {
  const suffix = ordinal > 1 || !['header-banner', 'hero-banner', 'logo', 'comparison-thumbnail'].includes(moduleType) ? ` ${ordinal}` : ''
  switch (moduleType) {
    case 'header-banner': return { label: `Header Banner${suffix}`, displayLabel: `顶部横幅${suffix}` }
    case 'single-image': return { label: `Single Image${suffix}`, displayLabel: `大图模块${suffix}` }
    case 'highlight-tile': return { label: `Highlight Tile${suffix}`, displayLabel: `卖点方块${suffix}` }
    case 'hero-banner': return type === 'mobile'
      ? { label: `Mobile Hero${suffix}`, displayLabel: `手机首屏${suffix}` }
      : { label: `Hero Banner${suffix}`, displayLabel: `高级首屏横幅${suffix}` }
    case 'feature-image': return type === 'mobile'
      ? { label: `Mobile Feature${suffix}`, displayLabel: `手机卖点图${suffix}` }
      : { label: `Feature Image${suffix}`, displayLabel: `高级大图模块${suffix}` }
    case 'brand-story': return { label: `Brand Story${suffix}`, displayLabel: `品牌故事${suffix}` }
    case 'logo': return { label: `Logo Image${suffix}`, displayLabel: `品牌 Logo${suffix}` }
    case 'comparison-thumbnail': return { label: `Comparison Thumbnail${suffix}`, displayLabel: `对比缩略图${suffix}` }
  }
}

export function normalizeAPlusModuleSpecs(type: APlusContentType, specs?: Array<Partial<AmazonAPlusModuleSpec>> | null): AmazonAPlusModuleSpec[] {
  const fallbackSpecs = getAPlusModuleSpecs(type)
  const sourceSpecs = Array.isArray(specs) && specs.length ? specs : fallbackSpecs
  const fallbackByModuleType = new Map(fallbackSpecs.map((spec) => [spec.moduleType, spec]))
  const moduleTypeCounts = new Map<APlusModuleKind, number>()
  const filtered = sourceSpecs.slice(0, MAX_A_PLUS_MODULE_COUNT).filter((spec) => isAPlusModuleKind(spec.moduleType))
  const safeSource = filtered.length ? filtered : fallbackSpecs

  return safeSource.map((spec, index) => {
    const fallback = fallbackByModuleType.get(spec.moduleType as APlusModuleKind) ?? fallbackSpecs[index] ?? fallbackSpecs[0]!
    const moduleType = isAPlusModuleKind(spec.moduleType) ? spec.moduleType : fallback.moduleType
    const ordinal = (moduleTypeCounts.get(moduleType) ?? 0) + 1
    moduleTypeCounts.set(moduleType, ordinal)
    const text = getAPlusModuleTypeText(type, moduleType, ordinal)
    const width = Number(spec.uploadWidth)
    const height = Number(spec.uploadHeight)
    return {
      contentType: type,
      slot: `${getAPlusModuleSlotPrefix(type)}${String(index + 1).padStart(2, '0')}`,
      label: text.label,
      displayLabel: text.displayLabel,
      moduleType,
      uploadWidth: Number.isFinite(width) && width > 0 ? Math.trunc(width) : fallback.uploadWidth,
      uploadHeight: Number.isFinite(height) && height > 0 ? Math.trunc(height) : fallback.uploadHeight,
      objective: typeof spec.objective === 'string' && spec.objective.trim() ? spec.objective : fallback.objective,
    }
  })
}

export function insertAPlusModuleSpecAfter(type: APlusContentType, specs: Array<Partial<AmazonAPlusModuleSpec>>, index: number) {
  const normalized = normalizeAPlusModuleSpecs(type, specs)
  if (normalized.length >= MAX_A_PLUS_MODULE_COUNT) return normalized
  const insertIndex = Math.min(Math.max(index, 0), normalized.length - 1)
  return normalizeAPlusModuleSpecs(type, [...normalized.slice(0, insertIndex + 1), { ...normalized[insertIndex] }, ...normalized.slice(insertIndex + 1)])
}

export function removeAPlusModuleSpecAt(type: APlusContentType, specs: Array<Partial<AmazonAPlusModuleSpec>>, index: number) {
  const normalized = normalizeAPlusModuleSpecs(type, specs)
  if (normalized.length <= MIN_A_PLUS_MODULE_COUNT) return normalized
  const removeIndex = Math.min(Math.max(index, 0), normalized.length - 1)
  return normalizeAPlusModuleSpecs(type, normalized.filter((_, itemIndex) => itemIndex !== removeIndex))
}

export function areAPlusModuleSpecsEquivalent(left: Array<Partial<AmazonAPlusModuleSpec>>, right: Array<Partial<AmazonAPlusModuleSpec>>) {
  if (left.length !== right.length) return false
  return left.every((spec, index) => {
    const other = right[index]
    return spec.moduleType === other?.moduleType && spec.uploadWidth === other.uploadWidth && spec.uploadHeight === other.uploadHeight
  })
}

export function getAPlusModuleSpecs(type: APlusContentType): AmazonAPlusModuleSpec[] {
  switch (type) {
    case 'premium':
      return PREMIUM_A_PLUS_MODULE_SPECS
    case 'mobile':
      return MOBILE_A_PLUS_MODULE_SPECS
    case 'standard-large':
      return STANDARD_LARGE_A_PLUS_MODULE_SPECS
    default:
      return STANDARD_A_PLUS_MODULE_SPECS
  }
}

export function findAPlusModuleSpec(slot: string): AmazonAPlusModuleSpec | undefined {
  return [...STANDARD_A_PLUS_MODULE_SPECS, ...STANDARD_LARGE_A_PLUS_MODULE_SPECS, ...PREMIUM_A_PLUS_MODULE_SPECS, ...MOBILE_A_PLUS_MODULE_SPECS, ...OPTIONAL_A_PLUS_MODULE_SPECS]
    .find((spec) => spec.slot === slot)
}

export function getAPlusContentTypeLabel(type: APlusContentType): string {
  switch (type) {
    case 'premium':
      return '高级A+'
    case 'mobile':
      return '手机A+'
    case 'standard-large':
      return '普通A+'
    default:
      return '标准A+'
  }
}

export function getAPlusModuleDisplayName(module: (Pick<AmazonAPlusPlan, 'slot' | 'moduleType'> | Pick<AmazonAPlusModuleSpec, 'slot' | 'moduleType'>) & { displayLabel?: string }): string {
  if (module.displayLabel) return module.displayLabel
  const spec = findAPlusModuleSpec(module.slot)
  if (spec && spec.moduleType === module.moduleType) return spec.displayLabel

  switch (module.moduleType) {
    case 'header-banner':
      return '顶部横幅'
    case 'single-image':
      return '大图模块'
    case 'highlight-tile':
      return '卖点方块'
    case 'hero-banner':
      return '高级首屏横幅'
    case 'feature-image':
      return '高级大图模块'
    case 'brand-story':
      return '品牌故事'
    case 'logo':
      return '品牌 Logo'
    case 'comparison-thumbnail':
      return '对比缩略图'
    default:
      return 'A+ 模块'
  }
}

export function getAPlusModuleEnglishName(module: Pick<AmazonAPlusPlan, 'slot' | 'label' | 'moduleType'> | Pick<AmazonAPlusModuleSpec, 'slot' | 'label' | 'moduleType'>): string {
  const spec = findAPlusModuleSpec(module.slot)
  if (spec && spec.moduleType === module.moduleType) return spec.label
  return module.label ?? module.moduleType
}

export function isAPlusTextModule(module: Pick<AmazonAPlusPlan, 'moduleType'> | Pick<AmazonAPlusModuleSpec, 'moduleType'>): boolean {
  return module.moduleType === 'highlight-tile'
}

export function formatAPlusModuleText(plan: Pick<AmazonAPlusPlan, 'textTitle' | 'textBody'>): string {
  return [plan.textTitle.trim(), plan.textBody.trim()].filter(Boolean).join('\n\n')
}

export function getAPlusModuleUploadSize(spec: Pick<AmazonAPlusModuleSpec, 'uploadWidth' | 'uploadHeight'>): string {
  return formatAPlusUploadSize(spec)
}

export function getAPlusModuleGenerationSize(spec: Pick<AmazonAPlusModuleSpec, 'uploadWidth' | 'uploadHeight'>, tier: SizeTier): string {
  return getAPlusGenerationSizeFromDimensions(spec.uploadWidth, spec.uploadHeight, tier)
}

export function getAPlusPlanGenerationSize(plan: Pick<AmazonAPlusPlan, 'slot' | 'uploadSize'>, tier: SizeTier): string {
  const spec = findAPlusModuleSpec(plan.slot)
  if (spec) return getAPlusModuleGenerationSize(spec, tier)

  const match = plan.uploadSize.match(/^(\d+)x(\d+)$/)
  if (!match) return tier === '4K' ? '2880x2880' : '2048x2048'
  return getAPlusGenerationSizeFromDimensions(Number(match[1]), Number(match[2]), tier)
}

export function withAPlusGenerationSizes(plans: AmazonAPlusPlan[], tier: SizeTier): AmazonAPlusPlan[] {
  return plans.map((plan) => ({
    ...plan,
    generationSize: getAPlusPlanGenerationSize(plan, tier),
  }))
}

export function buildAmazonAPlusPlanPrompt(plan: Pick<AmazonAPlusPlan, 'prompt' | 'negativePrompt'> & {
  seriesStyleGuide?: string | null
  styleReferenceAttached?: boolean
  styleDensityMode?: AmazonStyleDensityMode
  marketplaceId?: AmazonMarketplaceId
}): string {
  return formatPromptBlock({
    ...plan,
    additionalGuidance: getAmazonMarketplacePromptGuidance(plan.marketplaceId),
  })
}
