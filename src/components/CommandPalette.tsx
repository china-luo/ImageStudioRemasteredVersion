import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import type { AppFeatureView } from '../lib/appRoute'
import { readThemePreference, setThemePreference, type ThemePreference } from '../lib/theme'
import {
  ChartBarIcon,
  HelpCircleIcon,
  MonitorIcon,
  MoonIcon,
  ScanIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  SunIcon,
  TagIcon,
  WandIcon,
} from './icons'

interface CommandItem {
  id: string
  group: string
  label: string
  description: string
  keywords: string
  icon: ReactNode
  badge?: string
  action: () => void
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  onNavigate: (view: AppFeatureView) => void
  onOpenHelp: () => void
}

export default function CommandPalette({ open, onClose, onNavigate, onOpenHelp }: CommandPaletteProps) {
  const setAppMode = useStore((s) => s.setAppMode)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [theme, setTheme] = useState<ThemePreference>(() => readThemePreference())
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    setTheme(readThemePreference())
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20)
    return () => window.clearTimeout(timer)
  }, [open])

  const items = useMemo<CommandItem[]>(() => {
    const applyTheme = (next: ThemePreference) => {
      setThemePreference(next)
      setTheme(next)
      onClose()
    }
    return [
      {
        id: 'nav-gallery',
        group: '工作空间',
        label: '图片生成工作台',
        description: 'Amazon / TikTok 商品主图、附图与 A+ 策划制作',
        keywords: 'gallery amazon tiktok listing a+ 生成 策划',
        icon: <SparklesIcon className="h-4 w-4" />,
        action: () => {
          setAppMode('gallery')
          onNavigate('home')
          onClose()
        },
      },
      {
        id: 'nav-editor',
        group: '工作空间',
        label: '图片编辑',
        description: '标注涂鸦、局部增删、改色换材质与草图渲染',
        keywords: 'editor seedream 编辑 重绘 标注 修图',
        icon: <WandIcon className="h-4 w-4" />,
        action: () => {
          onNavigate('editor')
          onClose()
        },
      },
      {
        id: 'nav-sop',
        group: '工作空间',
        label: '拆图反推 SOP',
        description: '分析竞品参考图结构，输出迁移方案与英文提示词',
        keywords: 'sop reverse 拆图 反推 竞品 prompt',
        icon: <ScanIcon className="h-4 w-4" />,
        action: () => {
          setAppMode('sop')
          onNavigate('home')
          onClose()
        },
      },
      {
        id: 'nav-voc',
        group: '工作空间',
        label: 'VOC 评论分析',
        description: '拉取或导入 Amazon 评论，提炼痛点、卖点与看板',
        keywords: 'voc review asin shulex 评论 痛点 卖点',
        icon: <ChartBarIcon className="h-4 w-4" />,
        action: () => {
          setAppMode('voc')
          onNavigate('home')
          onClose()
        },
      },
      {
        id: 'nav-tagger',
        group: '工作空间',
        label: 'AI 人物打标',
        description: '本地一键写入 Amazon 要求的合成人物 XMP 标记',
        keywords: 'tagger xmp synthetic performer 打标 人物 标记',
        icon: <TagIcon className="h-4 w-4" />,
        action: () => {
          onNavigate('tagger')
          onClose()
        },
      },
      {
        id: 'theme-light',
        group: '外观主题',
        label: '切换为浅色主题',
        description: '清爽纯净的浅色工作室工作台',
        keywords: 'theme light 浅色 白天 亮色',
        icon: <SunIcon className="h-4 w-4" />,
        badge: theme === 'light' ? '当前' : undefined,
        action: () => applyTheme('light'),
      },
      {
        id: 'theme-dark',
        group: '外观主题',
        label: '切换为深色主题',
        description: '沉浸护眼的深色暗房工作台',
        keywords: 'theme dark 深色 夜间 暗色',
        icon: <MoonIcon className="h-4 w-4" />,
        badge: theme === 'dark' ? '当前' : undefined,
        action: () => applyTheme('dark'),
      },
      {
        id: 'theme-system',
        group: '外观主题',
        label: '跟随系统主题',
        description: '自动同步操作系统的深浅色外观',
        keywords: 'theme system auto 系统 自动',
        icon: <MonitorIcon className="h-4 w-4" />,
        badge: theme === 'system' ? '当前' : undefined,
        action: () => applyTheme('system'),
      },
      {
        id: 'open-settings',
        group: '工具与设置',
        label: '打开系统设置',
        description: '配置 API 接口、模型、背景图片与数据备份',
        keywords: 'settings api key config 设置 配置 备份',
        icon: <SettingsIcon className="h-4 w-4" />,
        action: () => {
          onClose()
          setShowSettings(true)
        },
      },
      {
        id: 'open-help',
        group: '工具与设置',
        label: '打开操作指南',
        description: '查看快捷键、框选批量操作与工作流说明',
        keywords: 'help guide 帮助 指南 快捷键',
        icon: <HelpCircleIcon className="h-4 w-4" />,
        action: () => {
          onClose()
          onOpenHelp()
        },
      },
    ]
  }, [onClose, onNavigate, onOpenHelp, setAppMode, setShowSettings, theme])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) =>
      `${item.label} ${item.description} ${item.group} ${item.keywords}`.toLowerCase().includes(q),
    )
  }, [items, query])

  useEffect(() => {
    setActiveIndex((current) => (filtered.length === 0 ? 0 : Math.min(current, filtered.length - 1)))
  }, [filtered.length])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((prev) => (filtered.length ? (prev + 1) % filtered.length : 0))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((prev) => (filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0))
      } else if (event.key === 'Enter' && filtered[activeIndex]) {
        event.preventDefault()
        filtered[activeIndex].action()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeIndex, filtered, onClose, open])

  if (!open) return null

  const grouped = filtered.reduce<Array<{ group: string; entries: Array<{ item: CommandItem; index: number }> }>>(
    (acc, item, index) => {
      const existing = acc.find((entry) => entry.group === item.group)
      if (existing) existing.entries.push({ item, index })
      else acc.push({ group: item.group, entries: [{ item, index }] })
      return acc
    },
    [],
  )

  return createPortal(
    <div
      data-no-drag-select
      className="fixed inset-0 z-[105] flex items-start justify-center px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="快捷命令面板"
      onClick={onClose}
    >
      <div className="ui-backdrop animate-overlay-in absolute inset-0" />
      <div
        className="ui-modal animate-modal-in relative z-10 flex w-full max-w-lg flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3.5">
          <SearchIcon className="h-[18px] w-[18px] shrink-0 text-[var(--accent)]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveIndex(0)
            }}
            placeholder="搜索工作空间、外观主题或快捷操作…"
            className="w-full bg-transparent text-sm text-[var(--text-1)] outline-none placeholder:text-[var(--text-3)]"
          />
          <kbd className="ui-kbd">ESC</kbd>
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-2">
          {grouped.length === 0 ? (
            <div className="py-10 text-center text-xs text-[var(--text-3)]">没有匹配的功能或操作</div>
          ) : (
            grouped.map(({ group, entries }) => (
              <div key={group} className="mb-2 last:mb-0">
                <div className="px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
                  {group}
                </div>
                {entries.map(({ item, index }) => {
                  const active = index === activeIndex
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-active={active ? 'true' : undefined}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={item.action}
                      className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors ${
                        active ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--text-1)] hover:bg-[var(--surface-hover)]'
                      }`}
                    >
                      <span
                        className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors ${
                          active
                            ? 'bg-[var(--cta-bg)] text-[var(--cta-fg)] shadow-sm'
                            : 'bg-[var(--surface-inset)] text-[var(--text-2)]'
                        }`}
                      >
                        {item.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold">{item.label}</span>
                        <span className="block truncate text-[11.5px] text-[var(--text-3)]">{item.description}</span>
                      </span>
                      {item.badge && <span className="ui-badge ui-badge-accent">{item.badge}</span>}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--line)] bg-[var(--surface-inset)] px-4 py-2 text-[11px] text-[var(--text-3)]">
          <span className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1">
              <kbd className="ui-kbd">↑</kbd>
              <kbd className="ui-kbd">↓</kbd> 选择
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="ui-kbd">↵</kbd> 确认
            </span>
          </span>
          <span>快捷面板</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
