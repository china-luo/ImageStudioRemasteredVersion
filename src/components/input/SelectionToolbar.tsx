import type { TaskRecord } from '../../types'

type SelectionToolbarProps = {
  selectedTaskIds: string[]
  filteredTaskCount: number
  tasks: TaskRecord[]
  onClear: () => void
  onToggleAll: () => void
  onToggleFavorite: () => void
  onDownload: () => void
  onDelete: () => void
}

export function SelectionToolbar({
  selectedTaskIds,
  filteredTaskCount,
  tasks,
  onClear,
  onToggleAll,
  onToggleFavorite,
  onDownload,
  onDelete,
}: SelectionToolbarProps) {
  const isAllSelected = selectedTaskIds.length === filteredTaskCount && filteredTaskCount > 0
  const allFavorite =
    selectedTaskIds.length > 0 && selectedTaskIds.every((id) => tasks.find((task) => task.id === id)?.isFavorite)

  return (
    <div className="mb-3 flex justify-center lg:justify-end">
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-full bg-[var(--surface-panel-strong)] p-1.5 shadow-[var(--shadow-float)] backdrop-blur-2xl">
        <span className="px-2.5 text-xs font-bold tabular-nums text-[var(--accent)]">
          已选 {selectedTaskIds.length}
        </span>
        <div className="mx-0.5 h-5 w-px bg-[var(--line-strong)]" />
        <button
          onClick={onClear}
          className="rounded-full p-2 text-[var(--text-2)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)]"
          title="取消选择"
          aria-label="取消选择"
        >
          <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <button
          onClick={onToggleAll}
          className="rounded-full p-2 text-[var(--accent)] transition hover:bg-[var(--accent-soft)]"
          title={isAllSelected ? '取消全选' : '全选当前可见'}
          aria-label={isAllSelected ? '取消全选' : '全选当前可见'}
        >
          {isAllSelected ? (
            <svg
              className="h-[18px] w-[18px]"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          ) : (
            <svg
              className="h-[18px] w-[18px]"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <path
                strokeDasharray="4 4"
                d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"
              />
            </svg>
          )}
        </button>
        <button
          onClick={onToggleFavorite}
          className="rounded-full p-2 text-amber-500 transition hover:bg-amber-500/10"
          title="收藏/取消收藏"
          aria-label="收藏/取消收藏"
        >
          {allFavorite ? (
            <svg className="h-[18px] w-[18px]" fill="currentColor" viewBox="0 0 24 24">
              <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          ) : (
            <svg
              className="h-[18px] w-[18px]"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          )}
        </button>
        <button
          onClick={onDownload}
          className="rounded-full p-2 text-emerald-500 transition hover:bg-emerald-500/10"
          title="批量下载"
          aria-label="批量下载"
        >
          <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
        </button>
        <button
          onClick={onDelete}
          className="rounded-full p-2 text-red-500 transition hover:bg-red-500/10"
          title="删除选中"
          aria-label="删除选中"
        >
          <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      </div>
    </div>
  )
}
