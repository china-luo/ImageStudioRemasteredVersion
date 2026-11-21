export type AmazonMarketplaceId = 'us' | 'jp' | 'de' | 'fr' | 'it' | 'es'

export interface AmazonMarketplaceConfig {
  id: AmazonMarketplaceId
  label: string
  shortLabel: string
  domain: string
  locale: string
  copyLanguage: string
  onImageCopyLanguage: string
  localGuidance: string[]
  allowsCjkVisibleCopy: boolean
}

export const DEFAULT_AMAZON_MARKETPLACE_ID: AmazonMarketplaceId = 'us'

export const AMAZON_MARKETPLACES: AmazonMarketplaceConfig[] = [
  {
    id: 'us',
    label: '美国站',
    shortLabel: 'US',
    domain: 'Amazon.com',
    locale: 'en-US',
    copyLanguage: 'US English',
    onImageCopyLanguage: 'US-English',
    localGuidance: [
      'Use concise US-English customer-facing copy with natural American spelling, phrasing, and units.',
      'Avoid machine-translated phrasing, Chinese copy, and non-US marketplace wording in visible text.',
    ],
    allowsCjkVisibleCopy: false,
  },
  {
    id: 'jp',
    label: '日本站',
    shortLabel: 'JP',
    domain: 'Amazon.co.jp',
    locale: 'ja-JP',
    copyLanguage: 'Japanese',
    onImageCopyLanguage: 'Japanese',
    localGuidance: [
      'Use concise natural Japanese customer-facing copy suitable for Amazon.co.jp shoppers.',
      'Japanese visible text may use Japanese characters; avoid Simplified Chinese UI wording and awkward direct translation.',
    ],
    allowsCjkVisibleCopy: true,
  },
  {
    id: 'de',
    label: '德国站',
    shortLabel: 'DE',
    domain: 'Amazon.de',
    locale: 'de-DE',
    copyLanguage: 'German',
    onImageCopyLanguage: 'German',
    localGuidance: [
      'Use concise natural German customer-facing copy suitable for Amazon.de shoppers.',
      'Use German spelling and units where relevant; avoid English, Chinese copy, and literal machine translation.',
    ],
    allowsCjkVisibleCopy: false,
  },
  {
    id: 'fr',
    label: '法国站',
    shortLabel: 'FR',
    domain: 'Amazon.fr',
    locale: 'fr-FR',
    copyLanguage: 'French',
    onImageCopyLanguage: 'French',
    localGuidance: [
      'Use concise natural French customer-facing copy suitable for Amazon.fr shoppers.',
      'Use French accents, phrasing, and units where relevant; avoid English, Chinese copy, and literal machine translation.',
    ],
    allowsCjkVisibleCopy: false,
  },
  {
    id: 'it',
    label: '意大利站',
    shortLabel: 'IT',
    domain: 'Amazon.it',
    locale: 'it-IT',
    copyLanguage: 'Italian',
    onImageCopyLanguage: 'Italian',
    localGuidance: [
      'Use concise natural Italian customer-facing copy suitable for Amazon.it shoppers.',
      'Use Italian phrasing and units where relevant; avoid English, Chinese copy, and literal machine translation.',
    ],
    allowsCjkVisibleCopy: false,
  },
  {
    id: 'es',
    label: '西班牙站',
    shortLabel: 'ES',
    domain: 'Amazon.es',
    locale: 'es-ES',
    copyLanguage: 'Spanish',
    onImageCopyLanguage: 'Spanish',
    localGuidance: [
      'Use concise natural Spanish customer-facing copy suitable for Amazon.es shoppers.',
      'Use Spanish phrasing and units where relevant; avoid English, Chinese copy, and literal machine translation.',
    ],
    allowsCjkVisibleCopy: false,
  },
]

const MARKETPLACE_BY_ID = new Map(AMAZON_MARKETPLACES.map((marketplace) => [marketplace.id, marketplace]))

export function isAmazonMarketplaceId(value: unknown): value is AmazonMarketplaceId {
  return typeof value === 'string' && MARKETPLACE_BY_ID.has(value as AmazonMarketplaceId)
}

export function normalizeAmazonMarketplaceId(value: unknown): AmazonMarketplaceId {
  return isAmazonMarketplaceId(value) ? value : DEFAULT_AMAZON_MARKETPLACE_ID
}

export function getAmazonMarketplace(value: unknown): AmazonMarketplaceConfig {
  return MARKETPLACE_BY_ID.get(normalizeAmazonMarketplaceId(value)) ?? AMAZON_MARKETPLACES[0]
}

export function getAmazonMarketplaceLabel(value: unknown): string {
  return getAmazonMarketplace(value).label
}

export function getAmazonMarketplaceShortLabel(value: unknown): string {
  return getAmazonMarketplace(value).shortLabel
}
