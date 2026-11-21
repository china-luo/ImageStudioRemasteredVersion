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
      <div className="flex items-start gap-3 rounded-2xl border border-gray-200/60 bg-gray-50/80 p-4 dark:border-white/[0.05] dark:bg-white/[0.02]">
        <svg className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
          />
        </svg>
        <div className="text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">
          所有的配置、任务记录和生成的图片均仅保存在您的浏览器本地（除非您使用的服务商存储了它们）。如果您需要清理浏览器站点数据、重置浏览器或使用其他设备，请先导出备份。
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.02]">
        <div className="mb-1 flex items-center gap-2">
          <ExportIcon className="h-4 w-4 text-gray-700 dark:text-gray-300" />
          <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">导出数据</h4>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <Checkbox checked={exportConfig} onChange={onExportConfigChange} label="包含配置" />
          <Checkbox checked={exportTasks} onChange={onExportTasksChange} label="包含任务和图片" />
        </div>
        <button
          type="button"
          onClick={onExport}
          disabled={!exportConfig && !exportTasks}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 disabled:hover:bg-gray-100/80 disabled:hover:text-gray-700 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] dark:hover:text-white dark:disabled:hover:bg-white/[0.06] dark:disabled:hover:text-gray-300"
        >
          导出所选数据
        </button>
      </div>

      <div className="space-y-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.02]">
        <div className="mb-1 flex items-center gap-2">
          <ImportIcon className="h-4 w-4 text-gray-700 dark:text-gray-300" />
          <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">导入数据</h4>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <Checkbox checked={importConfig} onChange={onImportConfigChange} label="包含配置" />
          <Checkbox checked={importTasks} onChange={onImportTasksChange} label="包含任务和图片" />
        </div>
        <button
          type="button"
          onClick={() => importInputRef.current?.click()}
          disabled={(!importConfig && !importTasks) || isImportingData}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 disabled:hover:bg-gray-100/80 disabled:hover:text-gray-700 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] dark:hover:text-white dark:disabled:hover:bg-white/[0.06] dark:disabled:hover:text-gray-300"
        >
          {isImportingData ? (
            <>
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              导入中...
            </>
          ) : (
            '从 ZIP 导入所选数据'
          )}
        </button>
        <input ref={importInputRef} type="file" accept=".zip" className="hidden" onChange={onImport} />
      </div>

      <div className="space-y-4 rounded-2xl border border-red-100/50 bg-red-50/30 p-4 shadow-sm dark:border-red-500/10 dark:bg-red-500/5">
        <div className="mb-1 flex items-center gap-2">
          <TrashIcon className="h-4 w-4 text-red-500/90 dark:text-red-400" />
          <h4 className="text-sm font-bold text-red-500/90 dark:text-red-400">清除数据</h4>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <Checkbox checked={clearConfig} onChange={onClearConfigChange} label="包含配置" tone="danger" />
          <Checkbox checked={clearTasks} onChange={onClearTasksChange} label="包含任务和图片" tone="danger" />
        </div>
        <button
          type="button"
          onClick={onClear}
          disabled={!clearConfig && !clearTasks}
          className="w-full rounded-xl border border-red-200/60 bg-red-50/50 px-4 py-2.5 text-sm font-medium text-red-500 transition-all hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 disabled:hover:border-red-200/60 disabled:hover:bg-red-50/50 disabled:hover:text-red-500 dark:border-red-500/15 dark:bg-red-500/5 dark:text-red-400 dark:hover:border-red-500/30 dark:hover:bg-red-500/10 dark:hover:text-red-300 dark:disabled:hover:border-red-500/15 dark:disabled:hover:bg-red-500/5 dark:disabled:hover:text-red-400"
        >
          清空所选数据
        </button>
      </div>
    </div>
  )
}
