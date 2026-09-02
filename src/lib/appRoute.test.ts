import { describe, expect, it } from 'vitest'
import { parseAppRoute, routeFromAppState, serializeAppRoute } from './appRoute'

describe('appRoute', () => {
  it('parses SOP, VOC, editor, and gallery hashes', () => {
    expect(parseAppRoute('#/sop')).toEqual({ view: 'home', mode: 'sop' })
    expect(parseAppRoute('#/voc')).toEqual({ view: 'home', mode: 'voc' })
    expect(parseAppRoute('#/editor')).toEqual({ view: 'editor' })
    expect(parseAppRoute('#/tagger')).toEqual({ view: 'tagger' })
    expect(parseAppRoute('#/')).toEqual({ view: 'home', mode: 'gallery' })
    expect(parseAppRoute('')).toEqual({ view: 'home', mode: 'gallery' })
    expect(parseAppRoute('#/gallery')).toEqual({ view: 'home', mode: 'gallery' })
  })

  it('serializes routes to stable hashes', () => {
    expect(serializeAppRoute({ view: 'home', mode: 'sop' })).toBe('#/sop')
    expect(serializeAppRoute({ view: 'home', mode: 'voc' })).toBe('#/voc')
    expect(serializeAppRoute({ view: 'editor' })).toBe('#/editor')
    expect(serializeAppRoute({ view: 'home', mode: 'gallery' })).toBe('#/')
  })

  it('round-trips current app state into a hash', () => {
    expect(serializeAppRoute(routeFromAppState('home', 'sop'))).toBe('#/sop')
    expect(serializeAppRoute(routeFromAppState('editor', 'gallery'))).toBe('#/editor')
    expect(parseAppRoute(serializeAppRoute(routeFromAppState('home', 'voc')))).toEqual({ view: 'home', mode: 'voc' })
  })
})
