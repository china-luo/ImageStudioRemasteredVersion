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
  onPlatformChange: (platform: CommercePlannerPlatform) => void
  onModeChange: (mode: AmazonPlannerMode) => void
  onTiktokDesignTypeChange: (designType: TiktokDesignType) => void
  onResolutionChange: (resolution: '2k' | '4k') => void
  onToggleHistory: () => void
}

export default function PlannerHeader({
  platform,
  mode,
  tiktokDesignType,
  resolution,
  historyOpen,
  historyCount,
  onPlatformChange,
  onModeChange,
  onTiktokDesignTypeChange,
  onResolutionChange,
  onToggleHistory,
}: PlannerHeaderProps) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-gray-50">
          {platform === 'tiktok' ? 'TikTok 商品图设计工作台' : AMAZON_WORKBENCH_NAME}
        </h2>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span>OpenAI gpt-image-2</span>
          <span className="h-1 w-1 rounded-full bg-gray-300 dark:bg-gray-600" />
          <span>2K / 4K</span>
          <span className="h-1 w-1 rounded-full bg-gray-300 dark:bg-gray-600" />
          <span>{platform === 'tiktok' ? '商品主图与商品详情图策划' : '主图、附图与 A+ 策划'}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <div className="inline-flex rounded-xl border border-gray-200 bg-gray-100 p-1 dark:border-white/[0.08] dark:bg-white/[0.04]">
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
                className={`h-8 rounded-lg px-3 text-sm font-medium transition ${platform === item ? 'bg-white text-gray-900 shadow-sm dark:bg-white/10 dark:text-white' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {platform === 'amazon' && (
          <div className="mt-2 inline-flex rounded-xl border border-gray-200 bg-gray-100 p-1 dark:border-white/[0.08] dark:bg-white/[0.04]">
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
                className={`h-8 rounded-lg px-3 text-sm font-medium transition ${mode === item ? 'bg-white text-gray-900 shadow-sm dark:bg-white/10 dark:text-white' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {platform === 'tiktok' && (
          <div className="mt-2 inline-flex rounded-xl border border-gray-200 bg-gray-100 p-1 dark:border-white/[0.08] dark:bg-white/[0.04]">
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
                className={`h-8 rounded-lg px-3 text-sm font-medium transition ${tiktokDesignType === item ? 'bg-white text-gray-900 shadow-sm dark:bg-white/10 dark:text-white' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border border-gray-200 bg-gray-100 p-1 dark:border-white/[0.08] dark:bg-white/[0.04]">
          {(['2k', '4k'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onResolutionChange(item)}
              className={`h-8 min-w-14 rounded-lg px-3 text-sm font-medium transition ${resolution === item ? 'bg-white text-gray-900 shadow-sm dark:bg-white/10 dark:text-white' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}
            >
              {item.toUpperCase()}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onToggleHistory}
          className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition ${historyOpen ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-200' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/[0.06]'}`}
        >
          <HistoryIcon className="h-4 w-4" />
          策划历史
          {historyCount > 0 && (
            <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500 dark:bg-white/[0.08] dark:text-gray-300">
              {historyCount}
            </span>
          )}
        </button>
      </div>
    </div>
  )
}
