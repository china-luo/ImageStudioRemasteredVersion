import { AMAZON_WORKBENCH_NAME } from '../../lib/appBrand'
import type { AmazonPlannerMode, CommercePlannerPlatform, TiktokDesignType } from '../../lib/listingPlanner'
import { HistoryIcon } from '../icons'

interface PlannerHeaderProps {
  platform: CommercePlannerPlatform
  mode: AmazonPlannerMode
  tiktokDesignType: TiktokDesignType
  resolution: '2k' | '4k'
  historyOpen: boolean
  historyCount: number
  disabled?: boolean
  onPlatformChange: (platform: CommercePlannerPlatform) => void
  onModeChange: (mode: AmazonPlannerMode) => void
  onTiktokDesignTypeChange: (designType: TiktokDesignType) => void
  onResolutionChange: (resolution: '2k' | '4k') => void
  onToggleHistory: () => void
}

const SEGMENT_GROUP_CLASS =
  'inline-flex rounded-[9px] bg-[var(--surface-inset)] p-[3px] shadow-[inset_0_0_0_1px_var(--line)]'
const SEGMENT_ACTIVE_CLASS = 'bg-white text-gray-900 shadow-sm dark:bg-white/10 dark:text-white'
const SEGMENT_IDLE_CLASS = 'text-[var(--text-2)] hover:text-[var(--text-1)]'

export default function PlannerHeader({
  platform,
  mode,
  tiktokDesignType,
  resolution,
  historyOpen,
  historyCount,
  disabled = false,
  onPlatformChange,
  onModeChange,
  onTiktokDesignTypeChange,
  onResolutionChange,
  onToggleHistory,
}: PlannerHeaderProps) {
  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h2 className="text-[17px] font-bold tracking-[-0.02em] text-[var(--text-1)]">
            {platform === 'tiktok' ? 'TikTok 商品图设计工作台' : AMAZON_WORKBENCH_NAME}
          </h2>
          <span className="text-xs text-[var(--text-3)]">
            {platform === 'tiktok' ? '商品主图与详情图策划 · 2K / 4K' : '主图、附图与 A+ 策划 · 2K / 4K'}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className={SEGMENT_GROUP_CLASS}>
          {(
            [
              ['amazon', 'Amazon'],
              ['tiktok', 'TikTok'],
            ] as const
          ).map(([item, label]) => (
            <button
              key={item}
              type="button"
              onClick={() => onPlatformChange(item)}
              disabled={disabled}
              className={`h-7 rounded-[6px] px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                platform === item ? SEGMENT_ACTIVE_CLASS : SEGMENT_IDLE_CLASS
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {platform === 'amazon' && (
          <div className={SEGMENT_GROUP_CLASS}>
            {(
              [
                ['listing', 'Listing 图'],
                ['aplus', 'A+ 图'],
              ] as const
            ).map(([item, label]) => (
              <button
                key={item}
                type="button"
                onClick={() => onModeChange(item)}
                disabled={disabled}
                className={`h-7 rounded-[6px] px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  mode === item ? SEGMENT_ACTIVE_CLASS : SEGMENT_IDLE_CLASS
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {platform === 'tiktok' && (
          <div className={SEGMENT_GROUP_CLASS}>
            {(
              [
                ['main', '商品主图'],
                ['detail', '商品详情图'],
              ] as const
            ).map(([item, label]) => (
              <button
                key={item}
                type="button"
                onClick={() => onTiktokDesignTypeChange(item)}
                disabled={disabled}
                className={`h-7 rounded-[6px] px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  tiktokDesignType === item ? SEGMENT_ACTIVE_CLASS : SEGMENT_IDLE_CLASS
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <span className="hidden h-4 w-px bg-[var(--line-strong)] sm:inline-block" aria-hidden="true" />

        <div className={SEGMENT_GROUP_CLASS}>
          {(['2k', '4k'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onResolutionChange(item)}
              disabled={disabled}
              className={`h-7 min-w-10 rounded-[6px] px-2.5 text-xs font-bold tracking-wide transition disabled:cursor-not-allowed disabled:opacity-50 ${
                resolution === item ? SEGMENT_ACTIVE_CLASS : SEGMENT_IDLE_CLASS
              }`}
            >
              {item.toUpperCase()}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onToggleHistory}
          disabled={disabled}
          className={`ui-btn ui-btn-sm h-[34px] ${historyOpen ? 'ui-btn-soft ring-1 ring-[var(--accent-ring)]' : ''}`}
        >
          <HistoryIcon className="h-3.5 w-3.5" />
          <span>策划历史</span>
          {historyCount > 0 && (
            <span className="rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-[var(--accent)]">
              {historyCount}
            </span>
          )}
        </button>
      </div>
    </div>
  )
}
