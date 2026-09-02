import type { AppSettings } from '../../types'
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
  return (
    <div className="space-y-4 rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.025]">
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
