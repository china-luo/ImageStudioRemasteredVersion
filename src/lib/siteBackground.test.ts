import { describe, expect, it } from 'vitest'
import { isValidSiteBackgroundDataUrl, SITE_BACKGROUND_MAX_DATA_URL_LENGTH } from './siteBackground'

describe('site background validation', () => {
  it('accepts supported raster data URLs', () => {
    expect(isValidSiteBackgroundDataUrl('data:image/jpeg;base64,AA==')).toBe(true)
    expect(isValidSiteBackgroundDataUrl('data:image/png;base64,AA==')).toBe(true)
    expect(isValidSiteBackgroundDataUrl('data:image/webp;base64,AA==')).toBe(true)
  })

  it('rejects SVG, remote URLs, and oversized values', () => {
    expect(isValidSiteBackgroundDataUrl('data:image/svg+xml;base64,AA==')).toBe(false)
    expect(isValidSiteBackgroundDataUrl('https://example.com/background.jpg')).toBe(false)
    expect(
      isValidSiteBackgroundDataUrl(`data:image/webp;base64,${'A'.repeat(SITE_BACKGROUND_MAX_DATA_URL_LENGTH)}`),
    ).toBe(false)
  })
})
