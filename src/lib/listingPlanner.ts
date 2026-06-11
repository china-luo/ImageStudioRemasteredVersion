import type { AmazonImageKind, AmazonPromptDraft } from './amazonPrompt'
import type { AmazonStyleDensityMode } from '../types'
import { calculateImageSize, type SizeTier } from './size'

export type AmazonPlannerMode = 'listing' | 'aplus'
export type CommercePlannerPlatform = 'amazon' | 'tiktok'
export type TiktokDesignType = 'main' | 'detail'
export type { AmazonStyleDensityMode } from '../types'
export type APlusContentType = 'standard' | 'standard-large' | 'premium'
export type APlusModuleKind =
  | 'header-banner'
  | 'single-image'
  | 'highlight-tile'
  | 'hero-banner'
  | 'feature-image'
  | 'brand-story'
  | 'logo'
  | 'comparison-thumbnail'

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

export interface AmazonStylePresetCandidate extends AmazonStyleCandidate {
  id: string
  category: string
}

const COMMON_STYLE_NEGATIVE_PROMPT = [
  'Chinese characters',
  'real brand logos unless provided in product references',
  'prices',
  'promotional badges',
  'QR codes',
  'contact details',
  'external URLs',
  'messy collage',
  'illegible typography',
  'unrealistic product colors',
  'invented accessories',
].join(', ')

const PLATFORM_STYLE_PRESET_GUIDANCE: Record<CommercePlannerPlatform, string> = {
  amazon: [
    'Platform target: Amazon listing image style board.',
    'Design for Amazon gallery usage: clean marketplace hierarchy, compliant product-first composition, readable secondary-image information structure, controlled studio or lifestyle realism, and Amazon-safe visual language.',
    'Do not include TikTok Shop-specific mobile feed cues, social-commerce badges, app interface elements, or short-video platform styling.',
  ].join(' '),
  tiktok: [
    'Platform target: TikTok Shop US product image style board.',
    'Design for TikTok Shop gallery usage: mobile-first readability, stronger thumbnail recognition, faster visual rhythm, scroll-stopping product hierarchy, US-English typography samples, and social-commerce clarity.',
    'Do not include Amazon-specific listing badges, Prime-style marketplace cues, A+ module cues, or Amazon gallery compliance language.',
  ].join(' '),
}

const PLATFORM_STYLE_NEGATIVE_PROMPT: Record<CommercePlannerPlatform, string> = {
  amazon: 'Amazon logo, Prime badge, TikTok logo, TikTok Shop marks, social app UI, short-video interface elements',
  tiktok: 'TikTok logo, TikTok Shop marks, Amazon logo, Prime badge, A+ module chrome, marketplace badge clutter',
}

export const CROSS_BORDER_STYLE_PRESETS: AmazonStylePresetCandidate[] = [
  {
    id: 'premium-clean-infographic',
    category: '信息图',
    label: '高级信息图',
    description: '适合功能卖点、参数对比、配件说明，层级清楚且移动端易读。',
    prompt: 'Create a premium clean e-commerce infographic visual style reference board for cross-border product images. Use a crisp white or light neutral base, disciplined grid alignment, refined sans-serif typography samples, precise thin-line callout treatments, tidy icon language, measured spacing, and a polished commercial hierarchy for secondary product images and detail images.',
    negativePrompt: COMMON_STYLE_NEGATIVE_PROMPT,
  },
  {
    id: 'white-tech-conversion',
    category: '主图',
    label: '白底科技感',
    description: '适合电子、工具、车品、数码配件，白底干净但不廉价。',
    prompt: 'Create a clean white-background tech-commerce visual style reference board. Use pure white and cool light gray surfaces, subtle cyan or electric-blue accents, glossy product-finish samples, crisp studio lighting, precise shadow control, compact typography samples, and minimal high-conversion layout cues for marketplace main images and hero product images.',
    negativePrompt: COMMON_STYLE_NEGATIVE_PROMPT,
  },
  {
    id: 'dark-rugged-tech',
    category: '科技',
    label: '硬核暗色科技',
    description: '适合车品、户外电源、工具、安防，强调力量感和专业感。',
    prompt: 'Create a rugged dark-tech visual style reference board for durable cross-border products. Use graphite black, charcoal gray, controlled red or cyan accents, hard directional light, reflective material samples, industrial texture swatches, bold condensed typography samples, and sharp callout treatments that feel robust, technical, and trustworthy without looking like gaming graphics.',
    negativePrompt: COMMON_STYLE_NEGATIVE_PROMPT,
  },
  {
    id: 'outdoor-lifestyle-editorial',
    category: '生活方式',
    label: '户外生活方式',
    description: '适合露营、运动、车载、旅行场景，真实环境中突出产品。',
    prompt: 'Create an outdoor lifestyle editorial visual style reference board for e-commerce product images. Use natural daylight, realistic US outdoor environments, breathable composition, earthy but clean color swatches, tactile material samples, subtle documentary-style product detail crops, and understated typography treatments that keep the product dominant and credible.',
    negativePrompt: COMMON_STYLE_NEGATIVE_PROMPT,
  },
  {
    id: 'home-soft-daylight',
    category: '生活方式',
    label: '家居柔光',
    description: '适合家居、厨房、收纳、宠物用品，温和真实且有品质感。',
    prompt: 'Create a soft daylight home-commerce visual style reference board. Use clean modern home surfaces, gentle window light, warm-neutral and fresh-white palette swatches, natural material texture samples, rounded but disciplined typography samples, soft shadow treatment, and calm lifestyle composition cues for home, kitchen, storage, pet, and family products.',
    negativePrompt: COMMON_STYLE_NEGATIVE_PROMPT,
  },
  {
    id: 'beauty-wellness-soft-luxury',
    category: '品牌',
    label: '美妆轻奢',
    description: '适合个护、美妆、香氛、健康护理，柔和高级但不堆装饰。',
    prompt: 'Create a soft luxury beauty and wellness visual style reference board for cross-border commerce. Use luminous studio lighting, smooth cream-white or pale gray surfaces, restrained pastel accent swatches, elegant sans-serif typography samples, refined product-finish close-ups, delicate line icons, and spacious premium composition cues suitable for skincare, personal care, fragrance, and wellness products.',
    negativePrompt: COMMON_STYLE_NEGATIVE_PROMPT,
  },
  {
    id: 'dtc-minimal-brand',
    category: '品牌',
    label: 'DTC极简品牌',
    description: '适合品牌感强的系列图，少元素、强秩序、适合长期复用。',
    prompt: 'Create a minimal direct-to-consumer brand visual style reference board. Use monochrome or near-monochrome palette swatches with one controlled accent color, generous spacing, modern geometric sans-serif typography samples, clean product crop samples, restrained icon language, and confident editorial composition cues that feel premium, repeatable, and brand-owned.',
    negativePrompt: COMMON_STYLE_NEGATIVE_PROMPT,
  },
  {
    id: 'social-commerce-bold-mobile',
    category: 'TikTok',
    label: '移动端强转化',
    description: '适合 TikTok 商品图和信息图，手机上强识别、节奏更快。',
    prompt: 'Create a bold mobile-first social-commerce visual style reference board. Use high-contrast product lighting, strong thumbnail readability, concise US-English typography samples, energetic but organized layout zones, bright controlled accent swatches, simple icon and callout treatments, and clear hierarchy designed for mobile commerce gallery images and mobile detail pages.',
    negativePrompt: COMMON_STYLE_NEGATIVE_PROMPT,
  },
  {
    id: 'material-macro-detail',
    category: '细节',
    label: '材质微距细节',
    description: '适合展示工艺、纹理、结构、接口和质量感。',
    prompt: 'Create a material macro detail visual style reference board. Use close-up product-finish samples, texture swatches, precision lighting, shallow-depth detail crops, fine-line annotation styles, compact technical typography samples, and premium material evidence cues for products that need to communicate build quality, structure, finish, or craftsmanship.',
    negativePrompt: COMMON_STYLE_NEGATIVE_PROMPT,
  },
  {
    id: 'giftable-bundle-clean',
    category: '套装',
    label: '礼品套装陈列',
    description: '适合套装、包装、配件清单，画面有秩序且显价值。',
    prompt: 'Create a clean giftable bundle visual style reference board. Use organized flat-lay and kit-layout cues, balanced accessory grouping samples, soft premium studio light, tasteful packaging texture swatches, clear quantity hierarchy, refined typography samples, and elegant composition language for showing included items without clutter or exaggerated promotion.',
    negativePrompt: COMMON_STYLE_NEGATIVE_PROMPT,
  },
  {
    id: 'performance-sport-energy',
    category: '运动',
    label: '运动性能感',
    description: '适合运动、健身、户外性能产品，动感强但保持商业干净。',
    prompt: 'Create a performance sport energy visual style reference board. Use dynamic diagonal composition cues, crisp motion lighting, high-contrast product detail samples, energetic accent swatches, durable material textures, bold athletic typography samples, and clean action-oriented callout treatments for sports, fitness, outdoor, and performance products.',
    negativePrompt: COMMON_STYLE_NEGATIVE_PROMPT,
  },
  {
    id: 'eco-natural-fresh',
    category: '自然',
    label: '自然环保清新',
    description: '适合母婴、家居、健康、环保材料，清爽可信不土味。',
    prompt: 'Create a fresh natural eco-commerce visual style reference board. Use clean botanical or natural material texture samples, airy white and soft green palette swatches, gentle daylight, honest product detail crops, friendly rounded sans-serif typography samples, and calm trustworthy composition cues for health, baby, home, and sustainable-material products.',
    negativePrompt: COMMON_STYLE_NEGATIVE_PROMPT,
  },
]

export function getStylePresetCandidate(id: string): AmazonStylePresetCandidate | undefined {
  return CROSS_BORDER_STYLE_PRESETS.find((preset) => preset.id === id)
}

function mergeNegativePrompts(...prompts: Array<string | null | undefined>) {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const prompt of prompts) {
    for (const part of (prompt ?? '').split(',')) {
      const item = part.trim()
      const key = item.toLowerCase()
      if (!item || seen.has(key)) continue
      seen.add(key)
      parts.push(item)
    }
  }
  return parts.join(', ')
}

export function buildAdaptiveStylePresetCandidate(
  preset: AmazonStylePresetCandidate,
  productContext: Array<string | null | undefined>,
  platform: CommercePlannerPlatform = 'amazon',
): AmazonStylePresetCandidate {
  const contextLines = productContext
    .map((item) => item?.replace(/\s+/g, ' ').trim())
    .filter((item): item is string => Boolean(item))

  return {
    ...preset,
    prompt: [
      preset.prompt.trim(),
      PLATFORM_STYLE_PRESET_GUIDANCE[platform],
      'Adapt this preset to the current product context below. Keep the preset as the dominant visual style system and do not borrow any other style direction. Use the context only to choose relevant product details, material evidence, usage scenarios, benefit hierarchy, accessory cues, and category-appropriate presentation within this preset style.',
      contextLines.length ? `Current product context:\n${contextLines.map((line) => `- ${line}`).join('\n')}` : '',
    ].join('\n\n'),
    negativePrompt: mergeNegativePrompts(preset.negativePrompt, PLATFORM_STYLE_NEGATIVE_PROMPT[platform]),
  }
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

export const OPTIONAL_A_PLUS_MODULE_SPECS: AmazonAPlusModuleSpec[] = [
  {
    contentType: 'optional',
    slot: 'A+LOGO',
    label: 'Logo Image',
    displayLabel: '品牌 Logo',
    moduleType: 'logo',
    uploadWidth: 600,
    uploadHeight: 180,
    objective: '用于已有品牌标志素材，不默认生成虚构 Logo。',
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

export function buildAmazonPlanPrompt(plan: Pick<AmazonImagePlan, 'prompt' | 'negativePrompt'> & {
  seriesStyleGuide?: string | null
  styleReferenceAttached?: boolean
  styleDensityMode?: AmazonStyleDensityMode
}): string {
  return formatPromptBlock(plan)
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

export function getAPlusModuleSpecs(type: APlusContentType): AmazonAPlusModuleSpec[] {
  switch (type) {
    case 'premium':
      return PREMIUM_A_PLUS_MODULE_SPECS
    case 'standard-large':
      return STANDARD_LARGE_A_PLUS_MODULE_SPECS
    default:
      return STANDARD_A_PLUS_MODULE_SPECS
  }
}

export function findAPlusModuleSpec(slot: string): AmazonAPlusModuleSpec | undefined {
  return [...STANDARD_A_PLUS_MODULE_SPECS, ...STANDARD_LARGE_A_PLUS_MODULE_SPECS, ...PREMIUM_A_PLUS_MODULE_SPECS, ...OPTIONAL_A_PLUS_MODULE_SPECS]
    .find((spec) => spec.slot === slot)
}

export function getAPlusContentTypeLabel(type: APlusContentType): string {
  switch (type) {
    case 'premium':
      return 'Premium'
    case 'standard-large':
      return '大图版'
    default:
      return 'Standard'
  }
}

export function getAPlusModuleDisplayName(module: Pick<AmazonAPlusPlan, 'slot' | 'moduleType'> | Pick<AmazonAPlusModuleSpec, 'slot' | 'moduleType'>): string {
  const spec = findAPlusModuleSpec(module.slot)
  if (spec) return spec.displayLabel

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
  return findAPlusModuleSpec(module.slot)?.label ?? module.label ?? module.moduleType
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
}): string {
  return formatPromptBlock(plan)
}
