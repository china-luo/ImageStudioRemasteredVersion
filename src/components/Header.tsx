import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { APP_BRAND_NAME, APP_REPOSITORY_URL } from '../lib/appBrand'
import { useTooltip } from '../hooks/useTooltip'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import ViewportTooltip from './ViewportTooltip'
import HelpModal from './HelpModal'
import { CloseIcon, FavoriteIcon, GithubIcon, HelpCircleIcon, InstallIcon, PowerIcon, SettingsIcon } from './icons'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function isInstalledPwa() {
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

export default function Header() {
  const appMode = useStore((s) => s.appMode)
  const setAppMode = useStore((s) => s.setAppMode)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const isDesktopApp = window.imageStudioDesktop?.isDesktop === true
  const [showHelp, setShowHelp] = useState(false)
  const [showSupportQr, setShowSupportQr] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isPwaInstalled, setIsPwaInstalled] = useState(() => isDesktopApp || isInstalledPwa())
  const [isStoppingServer, setIsStoppingServer] = useState(false)

  const installTooltip = useTooltip()
  const helpTooltip = useTooltip()
  const settingsTooltip = useTooltip()
  const shutdownTooltip = useTooltip()

  useEffect(() => {
    if (isDesktopApp) return

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
      setIsPwaInstalled(false)
    }

    const handleAppInstalled = () => {
      setInstallPrompt(null)
      setIsPwaInstalled(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [isDesktopApp])

  useEffect(() => {
    if (!showSupportQr) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowSupportQr(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showSupportQr])

  const handleInstallClick = async () => {
    if (installPrompt) {
      const promptEvent = installPrompt
      setInstallPrompt(null)

      try {
        await promptEvent.prompt()
        const choice = await promptEvent.userChoice
        setIsPwaInstalled(choice.outcome === 'accepted')
      } catch {
        setIsPwaInstalled(isInstalledPwa())
      }
    } else {
      const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      if (isIos) {
        setConfirmDialog({
          title: '安装为应用',
          message: '在 Safari 浏览器中，点击底部「分享」按钮，选择「添加到主屏幕」即可安装此应用。',
          showCancel: false,
          confirmText: '我知道了',
          icon: 'info',
          action: () => {},
        })
      } else {
        setConfirmDialog({
          title: '安装为应用',
          message: '请在浏览器的菜单中选择「添加到主屏幕」或「安装应用」。\n\n（如果在微信等内置浏览器中，请先在外部浏览器打开）',
          showCancel: false,
          confirmText: '我知道了',
          icon: 'info',
          action: () => {},
        })
      }
    }
  }

  const stopLocalServer = async () => {
    setIsStoppingServer(true)

    try {
      await fetch('/__amazon-image-studio/stop', {
        method: 'POST',
        cache: 'no-store',
      })
      useStore.getState().showToast('本地服务正在停止，稍后可直接关闭此页面。', 'success')
    } catch {
      useStore.getState().showToast('停止请求已发送，服务可能正在关闭。', 'info')
    }
  }

  const handleShutdownClick = () => {
    dismissAllTooltips()
    setConfirmDialog({
      title: '停止本地服务',
      message: '停止后当前页面会失去连接；需要再次使用时，请重新运行启动脚本。',
      confirmText: '停止服务',
      cancelText: '取消',
      tone: 'danger',
      action: () => {
        void stopLocalServer()
      },
    })
  }

  return (
    <>
      <header data-no-drag-select className="safe-area-top fixed top-0 left-0 right-0 z-40 border-b border-gray-200 bg-white/80 backdrop-blur dark:border-white/[0.08] dark:bg-gray-950/80">
        <div className="safe-area-x safe-header-inner mx-auto flex max-w-7xl items-center justify-between">
          <div className="group/brand min-w-0 pr-3">
            <h1 className="min-w-0 leading-none">
              <a
                href={APP_REPOSITORY_URL}
                target="_blank"
                rel="noreferrer"
                aria-label={`${APP_BRAND_NAME} GitHub 仓库`}
                className="group inline-flex min-w-0 items-center gap-2 rounded-lg pr-1 transition-colors hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:hover:text-gray-200"
              >
                <span className="truncate text-[18px] font-black text-gray-900 dark:text-gray-50 sm:text-xl">
                  <span className="font-semibold">跨境</span>
                  <span className="mx-0.5 text-blue-600 dark:text-blue-300">Image</span>
                  <span className="font-semibold">工作台</span>
                </span>
                <GithubIcon className="hidden h-4 w-4 shrink-0 text-gray-300 transition-colors group-hover:text-gray-700 dark:text-white/20 dark:group-hover:text-gray-200 sm:block" />
              </a>
            </h1>
            <span className="mt-0.5 inline-flex items-center gap-2">
              <span className="w-fit text-[9px] font-semibold uppercase tracking-[0.28em] text-gray-300 transition-colors group-hover/brand:text-gray-500 dark:text-white/20 dark:group-hover/brand:text-white/40">
                JackLuo
              </span>
              <button
                type="button"
                onClick={() => {
                  dismissAllTooltips()
                  setShowSupportQr(true)
                }}
                className="inline-flex h-5 items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 text-[11px] font-semibold leading-none text-blue-700 transition hover:border-blue-300 hover:bg-blue-100 active:translate-y-px dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-200 dark:hover:bg-blue-400/15"
                aria-label="打开打赏收款码"
              >
                <FavoriteIcon filled className="h-3 w-3" />
                打赏
              </button>
            </span>
          </div>
          <nav className="mx-2 hidden min-w-0 flex-1 justify-center sm:flex" aria-label="功能板块">
            <div className="inline-flex rounded-xl border border-gray-200 bg-gray-100 p-1 dark:border-white/[0.08] dark:bg-white/[0.04]">
              {([
                ['gallery', '图片生成'],
                ['sop', '拆图反推'],
                ['voc', 'VOC评论'],
              ] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setAppMode(mode)}
                  className={`h-8 rounded-lg px-3 text-sm font-medium transition ${
                    appMode === mode
                      ? 'bg-white text-gray-900 shadow-sm dark:bg-white/10 dark:text-white'
                      : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </nav>
          <div className="flex shrink-0 items-center gap-1">
            {!isDesktopApp && !isPwaInstalled && (
              <div
                className="relative"
                {...installTooltip.handlers}
              >
                <button
                  onClick={() => {
                    dismissAllTooltips()
                    handleInstallClick()
                  }}
                  className="rounded-lg p-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-900"
                  aria-label="安装为应用"
                >
                  <InstallIcon className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                </button>
                <ViewportTooltip visible={installTooltip.visible} className="whitespace-nowrap">
                  安装为应用
                </ViewportTooltip>
              </div>
            )}
            <div
              className="relative"
              {...helpTooltip.handlers}
            >
              <button
                onClick={() => {
                  dismissAllTooltips()
                  setShowHelp(true)
                }}
                className="rounded-lg p-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-900"
                aria-label="操作指南"
              >
                <HelpCircleIcon className="h-5 w-5 text-gray-600 dark:text-gray-400" />
              </button>
              <ViewportTooltip visible={helpTooltip.visible} className="whitespace-nowrap">
                操作指南
              </ViewportTooltip>
            </div>
            <div
              className="relative"
              {...settingsTooltip.handlers}
            >
              <button
                onClick={() => setShowSettings(true)}
                className="rounded-lg p-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-900"
                aria-label="设置"
              >
                <SettingsIcon className="h-5 w-5 text-gray-600 dark:text-gray-400" />
              </button>
              <ViewportTooltip visible={settingsTooltip.visible} className="whitespace-nowrap">
                设置
              </ViewportTooltip>
            </div>
            {import.meta.env.DEV && (
              <div
                className="relative"
                {...shutdownTooltip.handlers}
              >
                <button
                  onClick={handleShutdownClick}
                  disabled={isStoppingServer}
                  className="rounded-lg p-2 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-red-950/40"
                  aria-label="停止本地服务"
                >
                  <PowerIcon className="h-5 w-5 text-red-500 dark:text-red-400" />
                </button>
                <ViewportTooltip visible={shutdownTooltip.visible} className="whitespace-nowrap">
                  停止本地服务
                </ViewportTooltip>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="safe-area-top invisible pointer-events-none" aria-hidden="true">
        <div className="safe-header-inner" />
      </div>
      <div data-no-drag-select className="safe-area-x fixed left-0 right-0 top-[calc(var(--safe-area-top)+3.5rem)] z-30 border-b border-gray-200 bg-white/80 py-2 backdrop-blur dark:border-white/[0.08] dark:bg-gray-950/80 sm:hidden">
        <nav className="mx-auto flex max-w-7xl justify-center" aria-label="功能板块">
          <div className="inline-flex rounded-xl border border-gray-200 bg-gray-100 p-1 dark:border-white/[0.08] dark:bg-white/[0.04]">
            {([
              ['gallery', '图片生成'],
              ['sop', '拆图反推'],
              ['voc', 'VOC评论'],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setAppMode(mode)}
                className={`h-8 rounded-lg px-4 text-sm font-medium transition ${
                  appMode === mode
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-white/10 dark:text-white'
                    : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </nav>
      </div>
      <div className="h-[52px] sm:hidden" aria-hidden="true" />
      {showHelp && <HelpModal appMode="gallery" onClose={() => setShowHelp(false)} />}
      {showSupportQr && (
        <div
          data-no-drag-select
          className="fixed inset-0 z-[90] flex items-center justify-center bg-gray-950/55 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="support-qr-title"
          onClick={() => setShowSupportQr(false)}
        >
          <div
            className="w-full max-w-[560px] rounded-2xl border border-white/70 bg-white p-4 shadow-2xl dark:border-white/[0.08] dark:bg-gray-900 sm:p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div id="support-qr-title" className="text-base font-bold text-gray-950 dark:text-gray-100">
                  打赏支持
                </div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  微信 / 支付宝扫码
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSupportQr(false)}
                className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 active:translate-y-px dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
                aria-label="关闭打赏收款码"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-white/[0.08] dark:bg-gray-950 sm:p-4">
              <img
                src="/support-wechat-pay-qr.png"
                alt="打赏收款码"
                className="mx-auto aspect-square w-full max-w-[480px] rounded-xl bg-white object-contain"
                draggable={false}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
