import { useEffect, useState, type ReactNode } from 'react'
import { useStore } from '../store'
import { APP_BRAND_NAME, APP_REPOSITORY_URL } from '../lib/appBrand'
import { getPublicAssetUrl } from '../lib/publicAsset'
import { useTooltip } from '../hooks/useTooltip'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import {
  cycleThemePreference,
  readThemePreference,
  setThemePreference,
  THEME_CHANGE_EVENT,
  type ThemePreference,
} from '../lib/theme'
import ViewportTooltip from './ViewportTooltip'
import HelpModal from './HelpModal'
import {
  ChartBarIcon,
  CloseIcon,
  FavoriteIcon,
  GithubIcon,
  HelpCircleIcon,
  InstallIcon,
  MonitorIcon,
  MoonIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PowerIcon,
  ScanIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  SunIcon,
  TagIcon,
  WandIcon,
} from './icons'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function isInstalledPwa() {
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

const NAV_COLLAPSED_KEY = 'image-studio-nav-collapsed'

function readNavCollapsed() {
  try {
    return localStorage.getItem(NAV_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

type AppView = 'home' | 'editor' | 'tagger'

const THEME_LABELS: Record<ThemePreference, string> = {
  system: '外观：跟随系统（点击切换浅色）',
  light: '外观：浅色（点击切换深色）',
  dark: '外观：深色（点击跟随系统）',
}

export default function Header({
  activeView = 'home',
  onNavigate,
  onOpenCommandPalette,
  helpOpen,
  onHelpOpenChange,
}: {
  activeView?: AppView
  onNavigate?: (view: AppView) => void
  onOpenCommandPalette?: () => void
  helpOpen?: boolean
  onHelpOpenChange?: (open: boolean) => void
}) {
  const appMode = useStore((s) => s.appMode)
  const setAppMode = useStore((s) => s.setAppMode)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const runningTasksCount = useStore((s) => s.tasks.filter((task) => task.status === 'running').length)
  const isDesktopApp = window.imageStudioDesktop?.isDesktop === true
  const [internalShowHelp, setInternalShowHelp] = useState(false)
  const showHelp = helpOpen ?? internalShowHelp
  const setShowHelp = onHelpOpenChange ?? setInternalShowHelp
  const [showSupportQr, setShowSupportQr] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isPwaInstalled, setIsPwaInstalled] = useState(() => isDesktopApp || isInstalledPwa())
  const [isStoppingServer, setIsStoppingServer] = useState(false)
  const [theme, setTheme] = useState<ThemePreference>(() => readThemePreference())
  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => readNavCollapsed())

  const installTooltip = useTooltip()
  const themeTooltip = useTooltip()
  const helpTooltip = useTooltip()
  const settingsTooltip = useTooltip()
  const shutdownTooltip = useTooltip()

  useEffect(() => {
    const syncTheme = () => setTheme(readThemePreference())
    window.addEventListener(THEME_CHANGE_EVENT, syncTheme)
    return () => window.removeEventListener(THEME_CHANGE_EVENT, syncTheme)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('nav-collapsed', navCollapsed)
    try {
      if (navCollapsed) localStorage.setItem(NAV_COLLAPSED_KEY, '1')
      else localStorage.removeItem(NAV_COLLAPSED_KEY)
    } catch {
      /* Ignore storage error. */
    }
  }, [navCollapsed])

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
      const isIos =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
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
          message:
            '请在浏览器的菜单中选择「添加到主屏幕」或「安装应用」。\n\n（如果在微信等内置浏览器中，请先在外部浏览器打开）',
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

  const applyTheme = (next: ThemePreference) => {
    setThemePreference(next)
    setTheme(next)
  }

  const navItems: ReadonlyArray<{
    destination: 'gallery' | 'editor' | 'sop' | 'voc' | 'tagger'
    label: string
    description: string
    icon: ReactNode
    badge?: number
  }> = [
    {
      destination: 'gallery',
      label: '图片生成',
      description: '策划与制作',
      icon: <SparklesIcon className="h-[17px] w-[17px]" />,
      badge: runningTasksCount > 0 ? runningTasksCount : undefined,
    },
    {
      destination: 'editor',
      label: '图片编辑',
      description: '局部调整与重绘',
      icon: <WandIcon className="h-[17px] w-[17px]" />,
    },
    {
      destination: 'sop',
      label: '拆图反推',
      description: '分析参考图',
      icon: <ScanIcon className="h-[17px] w-[17px]" />,
    },
    {
      destination: 'voc',
      label: 'VOC评论',
      description: '提炼用户需求',
      icon: <ChartBarIcon className="h-[17px] w-[17px]" />,
    },
    {
      destination: 'tagger',
      label: 'AI 人物打标',
      description: '媒体标记与导出',
      icon: <TagIcon className="h-[17px] w-[17px]" />,
    },
  ]

  return (
    <>
      <header data-no-drag-select className="studio-header safe-area-top fixed top-0 left-0 right-0 z-40">
        <div className="safe-area-x safe-header-inner relative mx-auto flex items-center justify-between gap-1.5 sm:gap-3">
          <div className="group/brand flex min-w-0 items-center gap-2 sm:gap-2.5 sm:pr-2">
            <span
              aria-hidden="true"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-[var(--cta-bg)] text-[var(--cta-fg)] shadow-sm"
            >
              <SparklesIcon className="h-3.5 w-3.5" />
            </span>
            <div className="flex min-w-0 items-center gap-1.5 sm:gap-2.5">
              <h1 className="min-w-0 leading-none">
                <a
                  href={APP_REPOSITORY_URL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${APP_BRAND_NAME} GitHub 仓库`}
                  className="group inline-flex min-w-0 items-center gap-1.5 rounded-md transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
                >
                  <span className="truncate whitespace-nowrap text-[13.5px] font-bold tracking-[-0.02em] text-[var(--text-1)] sm:text-[15.5px]">
                    <span>跨境</span>
                    <span className="mx-0.5 text-[var(--accent)]">Image</span>
                    <span>工作台</span>
                  </span>
                  <GithubIcon className="hidden h-3.5 w-3.5 shrink-0 text-[var(--text-3)] opacity-60 transition-opacity group-hover:opacity-100 sm:block" />
                </a>
              </h1>
              <span className="hidden h-3.5 w-px bg-[var(--line-strong)] sm:inline-block" aria-hidden="true" />
              <button
                type="button"
                onClick={() => {
                  dismissAllTooltips()
                  setShowSupportQr(true)
                }}
                className="inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[var(--surface-inset)] px-2 text-[11px] font-medium leading-none text-[var(--text-2)] shadow-[inset_0_0_0_1px_var(--line)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] active:scale-95"
                aria-label="打开打赏收款码"
              >
                <FavoriteIcon filled className="h-2.5 w-2.5 shrink-0 text-amber-500" />
                打赏
              </button>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
            {onOpenCommandPalette && (
              <button
                type="button"
                onClick={onOpenCommandPalette}
                aria-label="打开快捷命令面板"
                className="mr-1 hidden h-8 items-center gap-2.5 rounded-lg bg-[var(--surface-inset)] px-2.5 text-xs font-medium text-[var(--text-2)] shadow-[inset_0_0_0_1px_var(--line)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] md:inline-flex"
              >
                <SearchIcon className="h-3.5 w-3.5 text-[var(--text-3)]" />
                <span>搜索功能或跳转…</span>
                <kbd className="ui-kbd">Ctrl K</kbd>
              </button>
            )}

            <div className="relative" {...themeTooltip.handlers}>
              <button
                type="button"
                onClick={() => {
                  dismissAllTooltips()
                  applyTheme(cycleThemePreference(theme))
                }}
                className="ui-icon-btn"
                aria-label="切换外观主题"
              >
                {theme === 'light' ? (
                  <SunIcon className="h-4 w-4" />
                ) : theme === 'dark' ? (
                  <MoonIcon className="h-4 w-4" />
                ) : (
                  <MonitorIcon className="h-4 w-4" />
                )}
              </button>
              <ViewportTooltip visible={themeTooltip.visible} className="whitespace-nowrap">
                {THEME_LABELS[theme]}
              </ViewportTooltip>
            </div>

            {!isDesktopApp && !isPwaInstalled && (
              <div className="relative" {...installTooltip.handlers}>
                <button
                  type="button"
                  onClick={() => {
                    dismissAllTooltips()
                    handleInstallClick()
                  }}
                  className="ui-icon-btn"
                  aria-label="安装为应用"
                >
                  <InstallIcon className="h-4 w-4" />
                </button>
                <ViewportTooltip visible={installTooltip.visible} className="whitespace-nowrap">
                  安装为应用
                </ViewportTooltip>
              </div>
            )}
            <div className="relative" {...helpTooltip.handlers}>
              <button
                type="button"
                onClick={() => {
                  dismissAllTooltips()
                  setShowHelp(true)
                }}
                className="ui-icon-btn"
                aria-label="操作指南"
              >
                <HelpCircleIcon className="h-4 w-4" />
              </button>
              <ViewportTooltip visible={helpTooltip.visible} className="whitespace-nowrap">
                操作指南
              </ViewportTooltip>
            </div>
            <div className="relative" {...settingsTooltip.handlers}>
              <button type="button" onClick={() => setShowSettings(true)} className="ui-icon-btn" aria-label="设置">
                <SettingsIcon className="h-4 w-4" />
              </button>
              <ViewportTooltip visible={settingsTooltip.visible} className="whitespace-nowrap">
                设置
              </ViewportTooltip>
            </div>
            {import.meta.env.DEV && (
              <div className="relative" {...shutdownTooltip.handlers}>
                <button
                  type="button"
                  onClick={handleShutdownClick}
                  disabled={isStoppingServer}
                  className="ui-icon-btn text-red-500 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400"
                  aria-label="停止本地服务"
                >
                  <PowerIcon className="h-4 w-4" />
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

      {onNavigate && (
        <nav className="studio-navigation" aria-label="功能导航">
          <div className="studio-navigation-header">
            <span className="studio-navigation-caption">工作空间</span>
            <button
              type="button"
              onClick={() => setNavCollapsed((value) => !value)}
              className="studio-navigation-collapse-btn"
              title={navCollapsed ? '展开侧栏' : '收起侧栏'}
              aria-label={navCollapsed ? '展开侧栏' : '收起侧栏'}
            >
              {navCollapsed ? <PanelLeftOpenIcon className="h-4 w-4" /> : <PanelLeftCloseIcon className="h-4 w-4" />}
            </button>
          </div>
          {navItems.map(({ destination, label, description, icon, badge }) => {
            const selected =
              destination === 'editor' || destination === 'tagger'
                ? activeView === destination
                : activeView === 'home' && appMode === destination
            return (
              <button
                key={destination}
                type="button"
                aria-current={selected ? 'page' : undefined}
                title={navCollapsed ? `${label} · ${description}` : undefined}
                onClick={() => {
                  if (destination === 'editor' || destination === 'tagger') onNavigate(destination)
                  else {
                    setAppMode(destination)
                    onNavigate('home')
                  }
                }}
                className="studio-navigation-item"
              >
                <span className="studio-navigation-icon" aria-hidden="true">
                  {icon}
                </span>
                <span className="studio-navigation-text">
                  <span className="studio-navigation-label">
                    <span className="truncate">{label}</span>
                    {badge !== undefined && <span className="studio-navigation-badge">{badge}</span>}
                  </span>
                  <small>{description}</small>
                </span>
              </button>
            )
          })}

          <div className="studio-navigation-footer">
            <div className="ui-segmented grid w-full grid-cols-3">
              {(
                [
                  ['light', '浅色', <SunIcon key="l" className="h-3.5 w-3.5" />],
                  ['dark', '深色', <MoonIcon key="d" className="h-3.5 w-3.5" />],
                  ['system', '自动', <MonitorIcon key="s" className="h-3.5 w-3.5" />],
                ] as const
              ).map(([value, label, icon]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={theme === value}
                  onClick={() => applyTheme(value)}
                  className="ui-segment min-h-7 px-1 text-[11px]"
                >
                  {icon}
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between px-1 text-[10.5px] text-[var(--text-3)]">
              <span>快捷键 Alt+1~4</span>
              <span className="font-mono">JackLuo</span>
            </div>
          </div>
        </nav>
      )}

      {showHelp && <HelpModal appMode="gallery" onClose={() => setShowHelp(false)} />}
      {showSupportQr && (
        <div
          data-no-drag-select
          className="fixed inset-0 z-[90] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="support-qr-title"
          onClick={() => setShowSupportQr(false)}
        >
          <div className="ui-backdrop animate-overlay-in absolute inset-0" />
          <div
            className="ui-modal animate-modal-in relative z-10 w-full max-w-[460px] p-5 sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div id="support-qr-title" className="text-base font-bold text-[var(--text-1)]">
                  打赏支持
                </div>
                <div className="mt-0.5 text-xs text-[var(--text-3)]">微信 / 支付宝扫码，感谢鼓励持续更新</div>
              </div>
              <button
                type="button"
                onClick={() => setShowSupportQr(false)}
                className="ui-icon-btn ui-icon-btn-sm"
                aria-label="关闭打赏收款码"
              >
                <CloseIcon className="h-[18px] w-[18px]" />
              </button>
            </div>
            <div className="ui-inset p-3.5 sm:p-4">
              <img
                src={getPublicAssetUrl('support-wechat-pay-qr.png')}
                alt="打赏收款码"
                className="mx-auto aspect-square w-full max-w-[400px] rounded-xl bg-white object-contain shadow-sm"
                draggable={false}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
