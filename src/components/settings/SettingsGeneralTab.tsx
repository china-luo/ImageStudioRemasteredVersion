import { useRef, useState } from 'react'
import type { AppSettings } from '../../types'
import {
  getStoredSiteBackground,
  prepareSiteBackground,
  resetSiteBackground,
  saveSiteBackground,
} from '../../lib/siteBackground'
import { getPublicAssetUrl } from '../../lib/publicAsset'
import { PhotoIcon, RefreshIcon } from '../icons'
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
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="block text-sm text-gray-600 dark:text-gray-300">{label}</span>
        <button
          type="button"
          onClick={onToggle}
          className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${checked ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
          role="switch"
          aria-checked={checked}
          aria-label={label}
        >
          <span
            className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[14px]' : 'translate-x-[2px]'}`}
          />
        </button>
      </div>
      <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
        {description}
      </div>
    </div>
  )
}

export default function SettingsGeneralTab({ draft, onCommit }: SettingsGeneralTabProps) {
  const backgroundInputRef = useRef<HTMLInputElement>(null)
  const [backgroundPreview, setBackgroundPreview] = useState(() => getStoredSiteBackground())
  const [backgroundStatus, setBackgroundStatus] = useState('')
  const [backgroundError, setBackgroundError] = useState('')
  const [backgroundBusy, setBackgroundBusy] = useState(false)

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
    <div className="space-y-4 rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.025]">
      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-200">工作台背景</div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-500">
              图片会自动缩放压缩，并只保存在当前设备。
            </div>
          </div>
          <span className="text-xs text-gray-400">{backgroundPreview ? '自定义' : '默认'}</span>
        </div>
        <div
          role="img"
          aria-label="当前工作台背景预览"
          className="h-28 w-full rounded-lg border border-gray-200 bg-cover bg-center shadow-inner dark:border-white/[0.08]"
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
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={backgroundBusy}
            onClick={() => backgroundInputRef.current?.click()}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-wait disabled:opacity-60"
          >
            <PhotoIcon className="h-4 w-4" />
            {backgroundBusy ? '正在处理…' : '选择图片'}
          </button>
          <button
            type="button"
            disabled={!backgroundPreview || backgroundBusy}
            onClick={restoreDefaultBackground}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.06]"
          >
            <RefreshIcon className="h-4 w-4" />
            恢复默认
          </button>
        </div>
        {backgroundStatus && (
          <p role="status" className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
            {backgroundStatus}
          </p>
        )}
        {backgroundError && (
          <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
            {backgroundError}
          </p>
        )}
      </section>
      <div className="border-t border-gray-100 dark:border-white/[0.08]" />
      <div className="hidden sm:block">
        <div className="mb-1 flex items-center justify-between">
          <span className="block text-sm text-gray-600 dark:text-gray-300">任务提交方式</span>
          <div className="w-32">
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
              className="w-full rounded-xl border border-gray-200/60 bg-white/50 px-3 py-1.5 text-xs text-gray-700 shadow-sm outline-none transition-all duration-200 hover:bg-white dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:hover:bg-white/[0.06]"
            />
          </div>
        </div>
        <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
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
          <span className="block text-sm text-gray-600 dark:text-gray-300">参考图编辑按钮</span>
          <div className="w-32">
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
              className="w-full rounded-xl border border-gray-200/60 bg-white/50 px-3 py-1.5 text-xs text-gray-700 shadow-sm outline-none transition-all duration-200 hover:bg-white dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:hover:bg-white/[0.06]"
            />
          </div>
        </div>
        <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
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
    </div>
  )
}
