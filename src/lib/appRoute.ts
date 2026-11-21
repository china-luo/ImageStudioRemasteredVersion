import type { AppMode } from '../types'

export type AppFeatureView = 'home' | 'editor' | 'tagger'
export type AppHomeMode = Extract<AppMode, 'gallery' | 'sop' | 'voc'>

export type AppRoute = { view: 'home'; mode: AppHomeMode } | { view: 'editor' } | { view: 'tagger' }

export function parseAppRoute(hash: string): AppRoute {
  const raw = hash.trim()
  const withoutHash = raw.startsWith('#') ? raw.slice(1) : raw
  const path = withoutHash.split('?')[0].replace(/\/+$/, '') || '/'
  const normalized = path.startsWith('/') ? path : `/${path}`

  if (normalized === '/sop') return { view: 'home', mode: 'sop' }
  if (normalized === '/voc') return { view: 'home', mode: 'voc' }
  if (normalized === '/editor') return { view: 'editor' }
  if (normalized === '/tagger') return { view: 'tagger' }
  return { view: 'home', mode: 'gallery' }
}

export function serializeAppRoute(route: AppRoute): string {
  if (route.view === 'editor') return '#/editor'
  if (route.view === 'tagger') return '#/tagger'
  if (route.mode === 'sop') return '#/sop'
  if (route.mode === 'voc') return '#/voc'
  return '#/'
}

export function routeFromAppState(featureView: AppFeatureView, appMode: AppMode): AppRoute {
  if (featureView === 'editor' || featureView === 'tagger') return { view: featureView }
  return { view: 'home', mode: appMode === 'sop' || appMode === 'voc' ? appMode : 'gallery' }
}

export function isSameAppRoute(left: AppRoute, right: AppRoute): boolean {
  return serializeAppRoute(left) === serializeAppRoute(right)
}
