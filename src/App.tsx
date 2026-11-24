import { lazy, Suspense, useEffect, useState } from 'react'
import { initSettingsSecrets, initStore, resumeWorkspaceStartupTasks } from './store'
import { useStore } from './store'
import { parseAppRoute, routeFromAppState, serializeAppRoute, type AppFeatureView, type AppRoute } from './lib/appRoute'
import { buildSettingsFromUrlParams, clearUrlSettingParams, hasUrlSettingParams } from './lib/urlSettings'
import { useDockerApiUrlMigrationNotice } from './hooks/useDockerApiUrlMigrationNotice'
import Header from './components/Header'
import CommandPalette from './components/CommandPalette'
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

function PageLoadingSkeleton({ message = '页面加载中…' }: { message?: string }) {
  return (
    <div className="ui-panel animate-fade-up flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
      <div className="progress-ring" aria-hidden="true" />
      <p className="text-sm font-medium text-[var(--text-2)]">{message}</p>
    </div>
  )
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
  const [commandOpen, setCommandOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  useDockerApiUrlMigrationNotice()
  useGlobalClickSuppression()

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const hasUrlSettings = hasUrlSettingParams(searchParams)
    const urlSettingsParams = new URLSearchParams(searchParams)

    if (hasUrlSettings) {
      clearUrlSettingParams(searchParams)

      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', nextUrl)
    }

    void initSettingsSecrets()
      .then(() => {
        // Apply URL overrides only after saved keys are present, so imports retain
        // unrelated credentials and explicitly supplied URL keys take precedence.
        if (hasUrlSettings) {
          setSettings(buildSettingsFromUrlParams(useStore.getState().settings, urlSettingsParams))
        }
        return initStore({ deferTaskRecovery: true })
      })
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
    if (!storeReady || !routeReady) return
    const workspace =
      featureView === 'editor' ? 'editor' : featureView === 'home' && appMode === 'gallery' ? 'generation' : null
    if (!workspace) return
    let active = true
    void resumeWorkspaceStartupTasks(workspace, () => active)
    return () => {
      active = false
    }
  }, [appMode, featureView, routeReady, storeReady])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [])

  const navigateFeature = (view: AppFeatureView) => setFeatureView(view)
  return (
    <div className="studio-shell">
      <Header
        activeView={featureView}
        onNavigate={navigateFeature}
        onOpenCommandPalette={() => setCommandOpen(true)}
        helpOpen={helpOpen}
        onHelpOpenChange={setHelpOpen}
      />
      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        onNavigate={navigateFeature}
        onOpenHelp={() => setHelpOpen(true)}
      />
      <main data-home-main data-drag-select-surface className="studio-main pb-12">
        <div className="studio-content safe-area-x mx-auto">
          <Suspense fallback={<PageLoadingSkeleton />}>
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
              <div
                role={storeError ? 'alert' : 'status'}
                className="ui-panel animate-fade-up flex flex-col items-center justify-center gap-3 px-6 py-20 text-center"
              >
                {!storeError && <div className="progress-ring" aria-hidden="true" />}
                <p className={storeError ? 'text-sm font-medium text-[var(--danger)]' : 'text-sm text-[var(--text-2)]'}>
                  {storeError || '正在加载图片数据…'}
                </p>
                {storeError && (
                  <button type="button" className="ui-btn ui-btn-primary mt-1" onClick={() => window.location.reload()}>
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
          <div data-no-drag-select className="ui-backdrop fixed inset-0 z-[80] flex items-center justify-center p-4">
            <div className="ui-modal animate-modal-in w-full max-w-md p-6">
              <div className="text-base font-bold text-[var(--text-1)]">设置面板打开失败</div>
              <div data-selectable-text className="ui-callout ui-callout-danger mt-3 font-mono text-xs">
                {error.message}
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowSettings(false)
                    reset()
                  }}
                  className="ui-btn"
                >
                  关闭设置
                </button>
                <button type="button" onClick={reset} className="ui-btn ui-btn-primary">
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
