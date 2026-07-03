import { useEffect } from 'react'
import { initStore } from './store'
import { useStore } from './store'
import { buildSettingsFromUrlParams, clearUrlSettingParams, hasUrlSettingParams } from './lib/urlSettings'
import { useDockerApiUrlMigrationNotice } from './hooks/useDockerApiUrlMigrationNotice'
import Header from './components/Header'
import AmazonPlanner from './components/AmazonPlanner'
import SopReverseWorkspace from './components/SopReverseWorkspace'
import VocAmazonReviewsWorkspace from './components/VocAmazonReviewsWorkspace'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
import InputBar from './components/InputBar'
import DetailModal from './components/DetailModal'
import Lightbox from './components/Lightbox'
import SettingsModal from './components/SettingsModal'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import MaskEditorModal from './components/MaskEditorModal'
import ImageContextMenu from './components/ImageContextMenu'
import ErrorBoundary from './components/ErrorBoundary'
import { useGlobalClickSuppression } from './lib/clickSuppression'

export default function App() {
  const setSettings = useStore((s) => s.setSettings)
  const appMode = useStore((s) => s.appMode)
  const showSettings = useStore((s) => s.showSettings)
  const setShowSettings = useStore((s) => s.setShowSettings)
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

    initStore()
    useStore.getState().setAppMode('gallery')
  }, [setSettings])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  return (
    <>
      <Header />
      <main
        data-home-main
        data-drag-select-surface
        className={appMode === 'sop' || appMode === 'voc' ? 'pb-10' : 'home-main-with-dock pb-48 lg:pb-10'}
      >
        <div className="safe-area-x max-w-7xl mx-auto lg:!px-6">
          {appMode === 'sop' ? (
            <SopReverseWorkspace />
          ) : appMode === 'voc' ? (
            <VocAmazonReviewsWorkspace />
          ) : (
            <>
              <AmazonPlanner />
              <SearchBar />
              <TaskGrid />
            </>
          )}
        </div>
      </main>
      {appMode !== 'sop' && appMode !== 'voc' && <InputBar />}
      <DetailModal />
      <Lightbox />
      <ErrorBoundary
        resetKey={showSettings}
        fallback={(error, reset) => (
          <div data-no-drag-select className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-5 shadow-2xl dark:border-red-400/20 dark:bg-gray-900">
              <div className="text-base font-semibold text-gray-900 dark:text-gray-100">设置面板打开失败</div>
              <div data-selectable-text className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700 dark:bg-red-400/10 dark:text-red-200">
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
        <SettingsModal />
      </ErrorBoundary>
      <ConfirmDialog />
      <Toast />
      <MaskEditorModal />
      <ImageContextMenu />
    </>
  )
}
