import type { ChangeEvent, RefObject } from 'react'
import { Checkbox } from '../Checkbox'
import { ExportIcon, ImportIcon, TrashIcon } from '../icons'

interface SettingsDataTabProps {
  exportConfig: boolean
  exportTasks: boolean
  importConfig: boolean
  importTasks: boolean
  clearConfig: boolean
  clearTasks: boolean
  isImportingData: boolean
  importInputRef: RefObject<HTMLInputElement | null>
  onExportConfigChange: (value: boolean) => void
  onExportTasksChange: (value: boolean) => void
  onImportConfigChange: (value: boolean) => void
  onImportTasksChange: (value: boolean) => void
  onClearConfigChange: (value: boolean) => void
  onClearTasksChange: (value: boolean) => void
  onExport: () => void
  onImport: (event: ChangeEvent<HTMLInputElement>) => void
  onClear: () => void
}

export default function SettingsDataTab({
  exportConfig,
  exportTasks,
  importConfig,
  importTasks,
  clearConfig,
  clearTasks,
  isImportingData,
  importInputRef,
  onExportConfigChange,
  onExportTasksChange,
  onImportConfigChange,
  onImportTasksChange,
  onClearConfigChange,
  onClearTasksChange,
  onExport,
  onImport,
  onClear,
}: SettingsDataTabProps) {
  return (
    <div className="space-y-4">
      <div className="ui-callout ui-callout-accent items-start gap-3">
        <svg
          className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
          />
        </svg>
        <div className="text-[13px] leading-relaxed">
          所有的配置、任务记录和生成的图片均仅保存在您的浏览器本地（除非您使用的服务商存储了它们）。如果您需要清理浏览器站点数据、重置浏览器或使用其他设备，请先导出备份。
        </div>
      </div>

      <div className="ui-inset space-y-4 p-5">
        <div className="flex items-center gap-2">
          <ExportIcon className="h-4 w-4 text-[var(--accent)]" />
          <h4 className="text-sm font-bold text-[var(--text-1)]">导出数据</h4>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <Checkbox checked={exportConfig} onChange={onExportConfigChange} label="包含配置" />
          <Checkbox checked={exportTasks} onChange={onExportTasksChange} label="包含任务和图片" />
        </div>
        <button
          type="button"
          onClick={onExport}
          disabled={!exportConfig && !exportTasks}
          className="ui-btn ui-btn-block h-10"
        >
          导出所选数据
        </button>
      </div>

      <div className="ui-inset space-y-4 p-5">
        <div className="flex items-center gap-2">
          <ImportIcon className="h-4 w-4 text-[var(--accent)]" />
          <h4 className="text-sm font-bold text-[var(--text-1)]">导入数据</h4>
        </div>
        <p className="text-xs text-[var(--text-3)]">同 ID 的任务、图片、项目和策划历史会保留本地版本。</p>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <Checkbox checked={importConfig} onChange={onImportConfigChange} label="包含配置" />
          <Checkbox checked={importTasks} onChange={onImportTasksChange} label="包含任务和图片" />
        </div>
        <button
          type="button"
          onClick={() => importInputRef.current?.click()}
          disabled={(!importConfig && !importTasks) || isImportingData}
          className="ui-btn ui-btn-block h-10"
        >
          {isImportingData ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--line-strong)] border-t-[var(--accent)]" />
              导入中...
            </>
          ) : (
            '从 ZIP 导入所选数据'
          )}
        </button>
        <input ref={importInputRef} type="file" accept=".zip" className="hidden" onChange={onImport} />
      </div>

      <div className="space-y-4 rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-5">
        <div className="flex items-center gap-2">
          <TrashIcon className="h-4 w-4 text-[var(--danger)]" />
          <h4 className="text-sm font-bold text-[var(--danger)]">清除数据</h4>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <Checkbox checked={clearConfig} onChange={onClearConfigChange} label="包含配置" tone="danger" />
          <Checkbox checked={clearTasks} onChange={onClearTasksChange} label="包含任务和图片" tone="danger" />
        </div>
        <button
          type="button"
          onClick={onClear}
          disabled={!clearConfig && !clearTasks}
          className="ui-btn ui-btn-danger-soft ui-btn-block h-10"
        >
          清空所选数据
        </button>
      </div>
    </div>
  )
}
