import { lazy, Suspense, useEffect, useState } from 'react'
import { initStore } from './store'
import { useStore } from './store'
import { parseAppRoute, routeFromAppState, serializeAppRoute, type AppFeatureView, type AppRoute } from './lib/appRoute'
import { buildSettingsFromUrlParams, clearUrlSettingParams, hasUrlSettingParams } from './lib/urlSettings'
import { useDockerApiUrlMigrationNotice } from './hooks/useDockerApiUrlMigrationNotice'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
import DetailModal from './components/DetailModal'
import Lightbox from './components/Lightbox'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import MaskEditorModal from './components/MaskEditorModal'
import ImageContextMenu from './components/ImageContextMenu'
import SupportPromptModal from './components/SupportPromptModal'
import ErrorBoundary from './components/ErrorBoundary'
import { useGlobalClickSuppression } from './lib/clickSuppression'
import './workbench.css'

const GenerationWorkspace = lazy(() => import('./components/GenerationWorkspace'))
const SopReverseWorkspace = lazy(() => import('./components/SopReverseWorkspace'))
const VocAmazonReviewsWorkspace = lazy(() => import('./components/VocAmazonReviewsWorkspace'))
const ImageEditorPage = lazy(() => import('./components/ImageEditorPage'))
const SyntheticPerformerTaggerPage = lazy(() => import('./components/SyntheticPerformerTaggerPage'))
const SettingsModal = lazy(() => import('./components/SettingsModal'))

function applyAppRoute(route: AppRoute, setFeatureView: (view: AppFeatureView) => void) {
  if (route.view === 'editor' || route.view === 'tagger') {
    setFeatureView(route.view)
    return
  }
  setFeatureView('home')
  useStore.getState().setAppMode(route.mode)
}

export default function App() {
  const setSettings = useStore((s) => s.setSettings)
  const appMode = useStore((s) => s.appMode)
  const showSettings = useStore((s) => s.showSettings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const [featureView, setFeatureView] = useState<AppFeatureView>(() => {
    const route = parseAppRoute(window.location.hash)
    if (route.view === 'home') useStore.setState({ appMode: route.mode })
    return route.view
  })
  const [routeReady, setRouteReady] = useState(false)
  const [storeReady, setStoreReady] = useState(false)
  const [storeError, setStoreError] = useState('')
  useDockerApiUrlMigrationNotice()
  useGlobalClickSuppression()

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const nextSettings = buildSettingsFromUrlParams(useStore.getState().settings, searchParams)

    setSettings(nextSettings)

    if (hasUrlSettingParams(searchParams)) {
      clearUrlSettingParams(searchParams)

      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', nextUrl)
    }

    void initStore()
      .then(() => setStoreReady(true))
      .catch((error) => {
        setStoreError(`数据加载失败：${String(error)}`)
        useStore.getState().showToast(`数据加载失败：${String(error)}`, 'error')
      })
    applyAppRoute(parseAppRoute(window.location.hash), setFeatureView)
    setRouteReady(true)
  }, [setSettings])

  useEffect(() => {
    const syncFromLocation = () => applyAppRoute(parseAppRoute(window.location.hash), setFeatureView)
    window.addEventListener('hashchange', syncFromLocation)
    window.addEventListener('popstate', syncFromLocation)
    return () => {
      window.removeEventListener('hashchange', syncFromLocation)
      window.removeEventListener('popstate', syncFromLocation)
    }
  }, [])

  useEffect(() => {
    if (!routeReady) return
    const next = serializeAppRoute(routeFromAppState(featureView, appMode))
    if (serializeAppRoute(parseAppRoute(window.location.hash)) === next) return
    window.history.pushState(null, '', next)
  }, [appMode, featureView, routeReady])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  const navigateFeature = (view: AppFeatureView) => setFeatureView(view)
  return (
    <div className="studio-shell">
      <Header activeView={featureView} onNavigate={navigateFeature} />
      <main data-home-main data-drag-select-surface className="studio-main pb-10">
        <div className="studio-content safe-area-x mx-auto">
          <Suspense fallback={<div className="py-16 text-center text-sm text-gray-500">页面加载中…</div>}>
            {featureView === 'editor' ? (
              <ImageEditorPage />
            ) : featureView === 'tagger' ? (
              <SyntheticPerformerTaggerPage />
            ) : appMode === 'sop' ? (
              <SopReverseWorkspace />
            ) : appMode === 'voc' ? (
              <VocAmazonReviewsWorkspace />
            ) : storeReady ? (
              <GenerationWorkspace
                resultsPanel={
                  <>
                    <SearchBar />
                    <TaskGrid />
                  </>
                }
              />
            ) : (
              <div role={storeError ? 'alert' : 'status'} className="py-16 text-center text-gray-500">
                {storeError || '正在加载图片数据…'}
                {storeError && (
                  <button className="ml-3 underline" onClick={() => window.location.reload()}>
                    重新加载
                  </button>
                )}
              </div>
            )}
          </Suspense>
        </div>
      </main>
      <DetailModal />
      <Lightbox />
      <ErrorBoundary
        resetKey={showSettings}
        fallback={(error, reset) => (
          <div
            data-no-drag-select
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
          >
            <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-5 shadow-2xl dark:border-red-400/20 dark:bg-gray-900">
              <div className="text-base font-semibold text-gray-900 dark:text-gray-100">设置面板打开失败</div>
              <div
                data-selectable-text
                className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700 dark:bg-red-400/10 dark:text-red-200"
              >
                {error.message}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowSettings(false)
                    reset()
                  }}
                  className="h-9 rounded-xl border border-gray-200 px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.06]"
                >
                  关闭设置
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="h-9 rounded-xl bg-blue-600 px-3 text-sm font-semibold text-white transition hover:bg-blue-500"
                >
                  重新打开
                </button>
              </div>
            </div>
          </div>
        )}
      >
        <Suspense fallback={null}>
          <SettingsModal />
        </Suspense>
      </ErrorBoundary>
      <ConfirmDialog />
      <Toast />
      <MaskEditorModal />
      <ImageContextMenu />
      <SupportPromptModal />
    </div>
  )
}
