import { describe, expect, it } from 'vitest'
import { cacheImage, clearImageCaches, forgetCachedImage, getCachedImage } from './imageCache'

describe('imageCache', () => {
  it('stores and evicts cached images independently of the Zustand store', () => {
    clearImageCaches()
    cacheImage('a', 'data:image/png;base64,a')
    expect(getCachedImage('a')).toBe('data:image/png;base64,a')
    forgetCachedImage('a')
    expect(getCachedImage('a')).toBeUndefined()
  })
})
