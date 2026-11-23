import { useEffect, useRef, useState } from 'react'
import type { AppSettings } from '../../types'
import {
  getStoredSiteBackground,
  prepareSiteBackground,
  resetSiteBackground,
  saveSiteBackground,
} from '../../lib/siteBackground'
import { getPublicAssetUrl } from '../../lib/publicAsset'
import {
  readThemePreference,
  setThemePreference,
  THEME_CHANGE_EVENT,
  type ThemePreference,
} from '../../lib/theme'
import { MonitorIcon, MoonIcon, PhotoIcon, RefreshIcon, SunIcon } from '../icons'
import Select from '../Select'

interface SettingsGeneralTabProps {
  draft: AppSettings
  onCommit: (settings: AppSettings) => void
}

interface SettingsToggleProps {
  label: string
  description: string
  checked: boolean
  onToggle: () => void
}

function SettingsToggle({ label, description, checked, onToggle }: SettingsToggleProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <span className="block text-sm font-semibold text-[var(--text-1)]">{label}</span>
        <div data-selectable-text className="mt-0.5 text-xs leading-relaxed text-[var(--text-3)]">
          {description}
        </div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-[var(--accent)]' : 'bg-[var(--line-strong)]'
        }`}
        role="switch"
        aria-checked={checked}
        aria-label={label}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`}
        />
      </button>
    </div>
  )
}

export default function SettingsGeneralTab({ draft, onCommit }: SettingsGeneralTabProps) {
  const backgroundInputRef = useRef<HTMLInputElement>(null)
  const [backgroundPreview, setBackgroundPreview] = useState(() => getStoredSiteBackground())
  const [backgroundStatus, setBackgroundStatus] = useState('')
  const [backgroundError, setBackgroundError] = useState('')
  const [backgroundBusy, setBackgroundBusy] = useState(false)
  const [theme, setTheme] = useState<ThemePreference>(() => readThemePreference())

  useEffect(() => {
    const sync = () => setTheme(readThemePreference())
    window.addEventListener(THEME_CHANGE_EVENT, sync)
    return () => window.removeEventListener(THEME_CHANGE_EVENT, sync)
  }, [])

  const handleThemeChange = (next: ThemePreference) => {
    setThemePreference(next)
    setTheme(next)
  }

  const handleBackgroundFile = async (file: File | undefined) => {
    if (!file) return
    setBackgroundBusy(true)
    setBackgroundStatus('')
    setBackgroundError('')
    try {
      const dataUrl = await prepareSiteBackground(file)
      saveSiteBackground(dataUrl)
      setBackgroundPreview(dataUrl)
      setBackgroundStatus('背景已更新，并会在下次启动时继续使用')
    } catch (error) {
      setBackgroundError(error instanceof Error ? error.message : String(error))
    } finally {
      setBackgroundBusy(false)
      if (backgroundInputRef.current) backgroundInputRef.current.value = ''
    }
  }

  const restoreDefaultBackground = () => {
    resetSiteBackground()
    setBackgroundPreview(null)
    setBackgroundError('')
    setBackgroundStatus('已恢复默认背景')
  }

  return (
    <div className="space-y-5">
      <section className="ui-inset p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-bold text-[var(--text-1)]">外观主题</div>
            <div className="mt-0.5 text-xs text-[var(--text-3)]">在浅色玻璃与深色暗房之间自由切换</div>
          </div>
          <div className="ui-segmented">
            {(
              [
                ['system', '跟随系统', <MonitorIcon key="sys" className="h-3.5 w-3.5" />],
                ['light', '浅色', <SunIcon key="light" className="h-3.5 w-3.5" />],
                ['dark', '深色', <MoonIcon key="dark" className="h-3.5 w-3.5" />],
              ] as const
            ).map(([value, label, icon]) => (
              <button
                key={value}
                type="button"
                aria-pressed={theme === value}
                onClick={() => handleThemeChange(value)}
                className="ui-segment px-3 text-xs"
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="ui-inset p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-[var(--text-1)]">工作台背景</div>
            <div className="mt-0.5 text-xs text-[var(--text-3)]">图片会自动缩放压缩，并只保存在当前设备。</div>
          </div>
          <span className={`ui-badge ${backgroundPreview ? 'ui-badge-accent' : ''}`}>
            {backgroundPreview ? '自定义' : '默认'}
          </span>
        </div>
        <div
          role="img"
          aria-label="当前工作台背景预览"
          className="h-32 w-full rounded-xl border border-[var(--line)] bg-cover bg-center shadow-inner"
          style={{
            backgroundImage: `url(${JSON.stringify(backgroundPreview || getPublicAssetUrl('site-background.png'))})`,
          }}
        />
        <input
          ref={backgroundInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label="选择背景图片"
          className="sr-only"
          onChange={(event) => void handleBackgroundFile(event.target.files?.[0])}
        />
        <div className="mt-3.5 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={backgroundBusy}
            onClick={() => backgroundInputRef.current?.click()}
            className="ui-btn ui-btn-primary h-9 text-xs"
          >
            <PhotoIcon className="h-4 w-4" />
            {backgroundBusy ? '正在处理…' : '选择图片'}
          </button>
          <button
            type="button"
            disabled={!backgroundPreview || backgroundBusy}
            onClick={restoreDefaultBackground}
            className="ui-btn h-9 text-xs"
          >
            <RefreshIcon className="h-4 w-4" />
            恢复默认
          </button>
        </div>
        {backgroundStatus && (
          <p role="status" className="mt-2.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            {backgroundStatus}
          </p>
        )}
        {backgroundError && (
          <p role="alert" className="mt-2.5 text-xs font-medium text-[var(--danger)]">
            {backgroundError}
          </p>
        )}
      </section>

      <section className="ui-inset space-y-5 p-5">
        <div className="hidden sm:block">
          <div className="mb-1 flex items-center justify-between gap-4">
            <span className="block text-sm font-semibold text-[var(--text-1)]">任务提交方式</span>
            <div className="w-36">
              <Select
                value={draft.enterSubmit ? 'enter' : 'ctrl-enter'}
                onChange={(value) => onCommit({ ...draft, enterSubmit: value === 'enter' })}
                options={[
                  { label: 'Enter', value: 'enter' },
                  {
                    label: navigator.userAgent.includes('Mac') ? 'Cmd + Enter' : 'Ctrl + Enter',
                    value: 'ctrl-enter',
                  },
                ]}
                className="ui-input h-9 min-h-0 py-0 text-xs font-medium"
              />
            </div>
          </div>
          <div data-selectable-text className="text-xs text-[var(--text-3)]">
            选择 Enter 提交时，使用 Shift + Enter 换行；否则直接 Enter 换行。
          </div>
        </div>
        <SettingsToggle
          label="提交任务后清空输入框"
          description="开启后，提交成功创建任务时会清空提示词和参考图。"
          checked={draft.clearInputAfterSubmit}
          onToggle={() => onCommit({ ...draft, clearInputAfterSubmit: !draft.clearInputAfterSubmit })}
        />
        <div>
          <div className="mb-1 flex items-center justify-between gap-3">
            <span className="block text-sm font-semibold text-[var(--text-1)]">参考图编辑按钮</span>
            <div className="w-36">
              <Select
                value={draft.referenceImageEditAction}
                onChange={(value) =>
                  onCommit({
                    ...draft,
                    referenceImageEditAction: value as AppSettings['referenceImageEditAction'],
                  })
                }
                options={[
                  { label: '询问', value: 'ask' },
                  { label: '替换参考图', value: 'replace-reference' },
                  { label: '添加遮罩', value: 'add-mask' },
                ]}
                className="ui-input h-9 min-h-0 py-0 text-xs font-medium"
              />
            </div>
          </div>
          <div data-selectable-text className="text-xs text-[var(--text-3)]">
            控制未添加遮罩的参考图点击编辑按钮时，是每次询问、直接替换参考图，还是直接添加遮罩。
          </div>
        </div>
        <SettingsToggle
          label="重启后加载上次的输入框"
          description="关闭后，不再持久化提示词和参考图，下次启动会使用空输入框。"
          checked={draft.persistInputOnRestart}
          onToggle={() => onCommit({ ...draft, persistInputOnRestart: !draft.persistInputOnRestart })}
        />
        <SettingsToggle
          label="复用配置时临时复用该任务的 API 配置"
          description="开启后，复用历史任务时会临时使用该任务的 API 配置，找不到该配置时提交会提示；关闭后，会继续使用当前的 API 配置。"
          checked={draft.reuseTaskApiProfileTemporarily}
          onToggle={() =>
            onCommit({
              ...draft,
              reuseTaskApiProfileTemporarily: !draft.reuseTaskApiProfileTemporarily,
            })
          }
        />
        <SettingsToggle
          label="成功任务仍然展示重试按钮"
          description="开启后，即使任务成功生成，也会在任务卡片和详情页显示重试按钮。"
          checked={draft.alwaysShowRetryButton}
          onToggle={() => onCommit({ ...draft, alwaysShowRetryButton: !draft.alwaysShowRetryButton })}
        />
      </section>
    </div>
  )
}
