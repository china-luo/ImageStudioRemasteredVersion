import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { APP_BRAND_NAME } from '../lib/appBrand'
import { useTooltip } from '../hooks/useTooltip'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import ViewportTooltip from './ViewportTooltip'
import HelpModal from './HelpModal'
import { GithubIcon, HelpCircleIcon, InstallIcon, PowerIcon, SettingsIcon } from './icons'

const REPOSITORY_URL = 'https://github.com/china-luo/ImageStudioRemasteredVersion'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function isInstalledPwa() {
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

export default function Header() {
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const [showHelp, setShowHelp] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isPwaInstalled, setIsPwaInstalled] = useState(isInstalledPwa)
  const [isStoppingServer, setIsStoppingServer] = useState(false)

  const installTooltip = useTooltip()
  const helpTooltip = useTooltip()
  const settingsTooltip = useTooltip()
  const shutdownTooltip = useTooltip()

  useEffect(() => {
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
  }, [])

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
          <h1 className="min-w-0 pr-3">
            <a
              href={REPOSITORY_URL}
              target="_blank"
              rel="noreferrer"
              aria-label={`${APP_BRAND_NAME} GitHub 仓库`}
              className="group inline-flex min-w-0 items-center gap-2 rounded-lg py-1 pr-1 transition-colors hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:hover:text-gray-200"
            >
              <span className="flex min-w-0 flex-col leading-none">
                <span className="truncate text-[18px] font-black text-gray-900 dark:text-gray-50 sm:text-xl">
                  <span className="font-semibold">跨境</span>
                  <span className="mx-0.5 text-blue-600 dark:text-blue-300">Image</span>
                  <span className="font-semibold">工作台</span>
                </span>
                <span className="mt-0.5 w-fit text-[9px] font-semibold uppercase tracking-[0.28em] text-gray-300 transition-colors group-hover:text-gray-500 dark:text-white/20 dark:group-hover:text-white/40">
                  JackLuo
                </span>
              </span>
              <GithubIcon className="hidden h-4 w-4 shrink-0 text-gray-300 transition-colors group-hover:text-gray-700 dark:text-white/20 dark:group-hover:text-gray-200 sm:block" />
            </a>
          </h1>
          <div className="flex shrink-0 items-center gap-1">
            {!isPwaInstalled && (
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
      {showHelp && <HelpModal appMode="gallery" onClose={() => setShowHelp(false)} />}
    </>
  )
}
