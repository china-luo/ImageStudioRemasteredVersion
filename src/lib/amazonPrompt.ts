export type AmazonImageKind = 'main' | 'lifestyle' | 'detail' | 'scale' | 'bundle' | 'steps'

export interface AmazonImagePreset {
  id: AmazonImageKind
  label: string
  shortLabel: string
  goal: string
  guidance: string[]
}

export interface AmazonPromptDraft {
  kind: AmazonImageKind
  productTitle: string
  category: string
  brand: string
  color: string
  material: string
  sellingPoints: string
  packageIncludes: string
  scene: string
  forbidden: string
  audience: string
}

export const AMAZON_IMAGE_PRESETS: AmazonImagePreset[] = [
  {
    id: 'main',
    label: '主图',
    shortLabel: 'MAIN',
    goal: '白底商品识别图',
    guidance: [
      'Pure white background RGB 255,255,255.',
      'The product fills about 85% of the frame.',
      'Show the complete product once, uncropped, with true color and proportion.',
      'No text, badges, watermark, border, price, review quote, or decorative graphic.',
    ],
  },
  {
    id: 'lifestyle',
    label: '场景图',
    shortLabel: 'LIFE',
    goal: '还原使用环境',
    guidance: [
      'Use a realistic lifestyle scene that matches the product and target customer.',
      'Keep the product as the clear hero, with no misleading extra included items.',
      'No Amazon logo, Prime mark, best-seller badge, review claim, or pricing message.',
    ],
  },
  {
    id: 'detail',
    label: '细节图',
    shortLabel: 'DETAIL',
    goal: '突出材质/结构/工艺',
    guidance: [
      'Use close-up product photography with crisp surface detail.',
      'Focus on the listed materials, finish, structure, seams, texture, ports, or craftsmanship.',
      'Avoid text overlays unless they are physically printed on the product itself.',
    ],
  },
  {
    id: 'scale',
    label: '比例图',
    shortLabel: 'SCALE',
    goal: '表达尺寸/使用尺度',
    guidance: [
      'Show the product at a believable real-world scale.',
      'Use only neutral context objects or body parts when they do not imply extra included accessories.',
      'Do not add measurements, price, star ratings, Amazon badges, or sales claims.',
    ],
  },
  {
    id: 'bundle',
    label: '套装图',
    shortLabel: 'SET',
    goal: '展示包装清单',
    guidance: [
      'Show every item included in the package at equal visual importance.',
      'Do not enlarge one item in a multi-pack unless the package contents require it.',
      'Avoid showing packaging unless the packaging is a real product feature.',
    ],
  },
  {
    id: 'steps',
    label: '步骤图',
    shortLabel: 'STEP',
    goal: '表达安装/使用动作',
    guidance: [
      'Create a clean sequence-like product use image without written instructions.',
      'Use realistic hands or environment only when appropriate for the category.',
      'Keep all visible items relevant to the sold product and avoid pricing or review claims.',
    ],
  },
]

export const DEFAULT_AMAZON_PROMPT_DRAFT: AmazonPromptDraft = {
  kind: 'main',
  productTitle: '',
  category: '',
  brand: '',
  color: '',
  material: '',
  sellingPoints: '',
  packageIncludes: '',
  scene: '',
  forbidden: '',
  audience: '',
}

function normalizeLines(value: string) {
  return value
    .split(/\r?\n|[;；]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function formatOptionalLine(label: string, value: string) {
  const trimmed = value.trim()
  return trimmed ? `- ${label}: ${trimmed}` : ''
}

function getPreset(kind: AmazonImageKind) {
  return AMAZON_IMAGE_PRESETS.find((preset) => preset.id === kind) ?? AMAZON_IMAGE_PRESETS[0]
}

export function buildAmazonPrompt(draft: AmazonPromptDraft) {
  const preset = getPreset(draft.kind)
  const sellingPoints = normalizeLines(draft.sellingPoints)
  const forbidden = normalizeLines(draft.forbidden)

  const productFacts = [
    formatOptionalLine('Product title', draft.productTitle),
    formatOptionalLine('Category', draft.category),
    formatOptionalLine('Brand or model', draft.brand),
    formatOptionalLine('Color', draft.color),
    formatOptionalLine('Material / finish', draft.material),
    formatOptionalLine('Package includes', draft.packageIncludes),
    formatOptionalLine('Target customer', draft.audience),
  ].filter(Boolean)

  const scene = draft.scene.trim()
  const customScene = scene ? [`Scene direction: ${scene}`] : []

  return [
    'Create a professional Amazon product listing image.',
    '',
    'Product facts:',
    productFacts.length ? productFacts.join('\n') : '- Product title: [fill in exact product name]',
    ...(sellingPoints.length ? ['', 'Key selling points to communicate visually:', ...sellingPoints.map((item) => `- ${item}`)] : []),
    '',
    `Image type: ${preset.label} (${preset.goal}).`,
    ...preset.guidance.map((item) => `- ${item}`),
    ...customScene,
    '',
    'Amazon compliance guard:',
    '- Accurately represent only the product being sold, matching the product title.',
    '- Keep colors, quantity, scale, and included accessories truthful.',
    '- No nudity or sexually suggestive content.',
    '- No customer reviews, five-star ratings, free shipping claims, seller-specific claims, pricing, coupons, or discount text.',
    '- No Amazon, Prime, Alexa, Amazon Choice, Best Seller, hot sale, marketplace badges, or lookalike marks.',
    '- No watermark, border, placeholder, mock UI, or graphic overlay that is not physically part of the product.',
    ...(forbidden.length ? ['- Exclude these specific items or visual risks:', ...forbidden.map((item) => `  - ${item}`)] : []),
    '',
    'Rendering requirements:',
    '- Photorealistic commercial product photography, sharp edges, clean lighting, high resolution, no pixelation, no artifacts.',
    '- Preserve the exact product design from any uploaded reference images; do not invent extra parts or accessories.',
  ].join('\n')
}

export function getAmazonComplianceChecks(draft: AmazonPromptDraft, size: string, referenceImageCount: number) {
  const isMain = draft.kind === 'main'
  return [
    {
      label: '商品名称',
      status: draft.productTitle.trim() ? 'ready' : 'missing',
      detail: draft.productTitle.trim() ? '已填写' : '需要填写准确商品名',
    },
    {
      label: '图片规格',
      status: /^(2048|4096)x(2048|4096)$/.test(size) ? 'ready' : 'warning',
      detail: /4096x4096/.test(size) ? '4K 方图' : /2048x2048/.test(size) ? '2K 方图' : size || '未选择 2K/4K',
    },
    {
      label: '主图白底',
      status: !isMain || !draft.scene.trim() ? 'ready' : 'warning',
      detail: isMain ? '主图应纯白背景且无场景' : '附图可使用真实场景',
    },
    {
      label: '参考图',
      status: referenceImageCount > 0 ? 'ready' : 'warning',
      detail: referenceImageCount > 0 ? `${referenceImageCount} 张参考图` : '建议上传产品实拍参考图',
    },
    {
      label: '禁用元素',
      status: 'ready',
      detail: '已写入 Amazon/Prime/评价/价格等禁用项',
    },
  ]
}
