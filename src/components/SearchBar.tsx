import { useCallback, useMemo } from 'react'
import { removeMultipleTasks, useStore } from '../store'
import {
  ALL_PRODUCT_FILTER,
  UNCATEGORIZED_PRODUCT_FILTER,
  getTaskProductFilterOptions,
  matchesTaskHistoryFilters,
} from '../lib/taskHistory'
import type { HistoryAspectFilter, HistoryWorkflowFilter } from '../types'
import Select from './Select'
import { SearchIcon, TrashIcon } from './icons'

export default function SearchBar() {
  const tasks = useStore((s) => s.tasks)
  const searchQuery = useStore((s) => s.searchQuery)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const filterStatus = useStore((s) => s.filterStatus)
  const setFilterStatus = useStore((s) => s.setFilterStatus)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const setFilterFavorite = useStore((s) => s.setFilterFavorite)
  const filterProductTitle = useStore((s) => s.filterProductTitle)
  const setFilterProductTitle = useStore((s) => s.setFilterProductTitle)
  const filterWorkflow = useStore((s) => s.filterWorkflow)
  const setFilterWorkflow = useStore((s) => s.setFilterWorkflow)
  const filterAspect = useStore((s) => s.filterAspect)
  const setFilterAspect = useStore((s) => s.setFilterAspect)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)

  const productOptions = useMemo(() => {
    const options = getTaskProductFilterOptions(tasks)
    const hasSelectedProduct = Boolean(
      filterProductTitle &&
      filterProductTitle !== UNCATEGORIZED_PRODUCT_FILTER &&
      !options.some((option) => option.value === filterProductTitle),
    )

    return [
      { label: '全部商品', value: ALL_PRODUCT_FILTER },
      ...(hasSelectedProduct ? [{ label: filterProductTitle, value: filterProductTitle }] : []),
      ...options.map((option) => ({
        label: `${option.label} (${option.count})`,
        value: option.value,
      })),
      { label: '未识别商品', value: UNCATEGORIZED_PRODUCT_FILTER },
    ]
  }, [filterProductTitle, tasks])

  const hasAgentTasks = useMemo(
    () => tasks.some((task) => task.sourceMode === 'agent' || Boolean(task.agentConversationId || task.agentRoundId)),
    [tasks],
  )
  const workflowOptions = useMemo(
    () => [
      { label: '全部来源', value: 'all' },
      { label: 'Listing 图', value: 'amazon-listing' },
      { label: 'A+ 图', value: 'amazon-aplus' },
      { label: 'TikTok 商品主图', value: 'tiktok-main' },
      { label: 'TikTok 商品详情图', value: 'tiktok-detail' },
      { label: '普通生图', value: 'gallery' },
      ...(hasAgentTasks || filterWorkflow === 'agent' ? [{ label: 'Agent (legacy)', value: 'agent' }] : []),
    ],
    [filterWorkflow, hasAgentTasks],
  )

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) =>
      matchesTaskHistoryFilters(task, {
        searchQuery,
        filterStatus,
        filterFavorite,
        filterProductTitle,
        filterWorkflow,
        filterAspect,
      }),
    )
  }, [tasks, searchQuery, filterStatus, filterFavorite, filterProductTitle, filterWorkflow, filterAspect])

  const hasActiveFilters = Boolean(
    searchQuery.trim() ||
    filterFavorite ||
    filterStatus !== 'all' ||
    filterProductTitle ||
    filterWorkflow !== 'all' ||
    filterAspect !== 'all',
  )
  const productFilterActive = Boolean(filterProductTitle)
  const clearLabel = productFilterActive
    ? filterProductTitle === UNCATEGORIZED_PRODUCT_FILTER
      ? '清空未识别'
      : '清空该商品'
    : hasActiveFilters
      ? '清空筛选结果'
      : '清空历史'

  const handleClearHistory = useCallback(() => {
    if (!filteredTasks.length) return
    const taskIds = filteredTasks.map((task) => task.id)
    const scopeText = productFilterActive
      ? filterProductTitle === UNCATEGORIZED_PRODUCT_FILTER
        ? '未识别商品'
        : `商品「${filterProductTitle}」`
      : hasActiveFilters
        ? '当前筛选结果'
        : '全部历史记录'

    setConfirmDialog({
      title: clearLabel,
      message: `确定要删除${scopeText}下的 ${taskIds.length} 条记录吗？关联图片资源会在没有其他记录引用时一起清理。`,
      confirmText: '确认清空',
      action: () => {
        void removeMultipleTasks(taskIds)
      },
    })
  }, [clearLabel, filterProductTitle, filteredTasks, hasActiveFilters, productFilterActive, setConfirmDialog])

  return (
    <div data-no-drag-select className="ui-inset mt-5 mb-4 flex flex-col gap-2.5 p-3 lg:flex-row lg:items-center">
      <div className="z-20 flex flex-shrink-0 flex-wrap gap-2">
        <button
          onClick={() => setFilterFavorite(!filterFavorite)}
          className={`flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] border transition-all ${
            filterFavorite
              ? 'border-amber-400/70 bg-amber-500/15 text-amber-500 shadow-sm'
              : 'border-[var(--line-strong)] bg-[var(--surface-solid)] text-[var(--text-3)] hover:text-[var(--text-1)]'
          }`}
          title={filterFavorite ? '取消只看收藏' : '只看收藏'}
        >
          <svg
            className="h-[18px] w-[18px]"
            fill={filterFavorite ? 'currentColor' : 'none'}
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
            />
          </svg>
        </button>
        <div className="relative w-28">
          <Select
            value={filterStatus}
            onChange={(val) => setFilterStatus(val as typeof filterStatus)}
            options={[
              { label: '全部状态', value: 'all' },
              { label: '已完成', value: 'done' },
              { label: '生成中', value: 'running' },
              { label: '失败', value: 'error' },
            ]}
            className="ui-input h-10 text-xs font-medium"
          />
        </div>
        <div className="relative w-40 sm:w-48">
          <Select
            value={filterProductTitle}
            onChange={(val) => setFilterProductTitle(String(val))}
            options={productOptions}
            className="ui-input h-10 text-xs font-medium"
          />
        </div>
        <div className="relative w-40 sm:w-44">
          <Select
            value={filterWorkflow}
            onChange={(val) => setFilterWorkflow(val as HistoryWorkflowFilter)}
            options={workflowOptions}
            className="ui-input h-10 text-xs font-medium"
          />
        </div>
        <div className="relative w-28">
          <Select
            value={filterAspect}
            onChange={(val) => setFilterAspect(val as HistoryAspectFilter)}
            options={[
              { label: '全部形状', value: 'all' },
              { label: '方图', value: 'square' },
              { label: '横幅图', value: 'landscape' },
              { label: '竖图', value: 'portrait' },
            ]}
            className="ui-input h-10 text-xs font-medium"
          />
        </div>
      </div>
      <div className="relative z-10 min-w-[14rem] flex-1">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-3)]" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          type="text"
          placeholder="搜索提示词、参数..."
          className="ui-input h-10 pl-9"
        />
      </div>
      <button
        type="button"
        onClick={handleClearHistory}
        disabled={!filteredTasks.length}
        title={filteredTasks.length ? `删除当前范围内的 ${filteredTasks.length} 条历史记录` : '没有可清空的记录'}
        className="ui-btn ui-btn-danger-soft h-10 shrink-0"
      >
        <TrashIcon className="h-4 w-4" />
        <span className="whitespace-nowrap">{clearLabel}</span>
      </button>
    </div>
  )
}
