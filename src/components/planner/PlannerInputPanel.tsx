import type { ChangeEvent } from 'react'
import type {
  APlusContentType,
  AmazonPlannerMode,
  CommercePlannerPlatform,
  TiktokDesignType,
} from '../../lib/listingPlanner'
import type { AmazonMarketplaceId } from '../../lib/amazonMarketplaces'
import type { ApiProfile } from '../../types'
import { CloseIcon } from '../icons'
import MarketplaceControls from './MarketplaceControls'
import Select from '../Select'

type PlannerModelOption = { label: string; value: string | number }

type PlannerInputPanelProps = {
  plannerMode: AmazonPlannerMode
  plannerPlatform: CommercePlannerPlatform
  tiktokDesignType: TiktokDesignType
  plannerGuideActive: boolean
  guideMessage: string
  guideHintClass: string
  getGuideFocusClass: (target: 'planner-input' | 'planner-api' | 'planner-action') => string
  marketplaceId: AmazonMarketplaceId
  onMarketplaceChange: (value: AmazonMarketplaceId) => void
  aPlusType: APlusContentType
  aPlusContentTypes: readonly APlusContentType[]
  getAPlusContentTypeLabel: (type: APlusContentType) => string
  onAPlusTypeChange: (type: APlusContentType) => void
  listingText: string
  onListingTextChange: (value: string) => void
  plannerProfile: ApiProfile | null
  plannerProfileValidation: string
  plannerModelOptions: PlannerModelOption[]
  onPlannerModelChange: (value: string) => void
  isPlanning: boolean
  onConfirmCreatePlan: () => void
  onStopPlan: () => void
  hasListingContent: boolean
  onClearListingPlan: () => void
  onOpenSettings: () => void
  plannerError: string
  onCopyPlannerError: () => void
  fieldClass: string
  labelClass: string
}

export default function PlannerInputPanel({
  plannerMode,
  plannerPlatform,
  tiktokDesignType,
  plannerGuideActive,
  guideMessage,
  guideHintClass,
  getGuideFocusClass,
  marketplaceId,
  onMarketplaceChange,
  aPlusType,
  aPlusContentTypes,
  getAPlusContentTypeLabel,
  onAPlusTypeChange,
  listingText,
  onListingTextChange,
  plannerProfile,
  plannerProfileValidation,
  plannerModelOptions,
  onPlannerModelChange,
  isPlanning,
  onConfirmCreatePlan,
  onStopPlan,
  hasListingContent,
  onClearListingPlan,
  onOpenSettings,
  plannerError,
  onCopyPlannerError,
  fieldClass,
  labelClass,
}: PlannerInputPanelProps) {
  return (
    <>
      {plannerGuideActive && <div className={`${guideHintClass} mt-3`}>{guideMessage}</div>}
      {plannerPlatform === 'tiktok' && (
        <div className="mt-3 rounded-lg border border-pink-200 bg-pink-50 px-3 py-2 text-xs leading-relaxed text-pink-800 dark:border-pink-300/20 dark:bg-pink-400/10 dark:text-pink-100">
          {tiktokDesignType === 'detail'
            ? '当前板块：TikTok 商品详情图。AI 会按 TikTok Shop 移动端详情页节奏生成 8 张竖版说明图方案。'
            : '当前板块：TikTok 商品主图。AI 会生成 6 张方形主图/卖点图方案，适合移动端商品卡片和详情首屏。'}
        </div>
      )}
      {plannerPlatform === 'amazon' && (
        <MarketplaceControls marketplaceId={marketplaceId} onChange={onMarketplaceChange} />
      )}
      {plannerMode === 'aplus' && (
        <div className="mt-3 inline-flex rounded-xl border border-gray-200 bg-gray-100 p-1 dark:border-white/[0.08] dark:bg-white/[0.04]">
          {aPlusContentTypes.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => onAPlusTypeChange(type)}
              className={`h-8 rounded-lg px-3 text-sm font-medium transition ${aPlusType === type ? 'bg-white text-gray-900 shadow-sm dark:bg-white/10 dark:text-white' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}
            >
              {getAPlusContentTypeLabel(type)}
            </button>
          ))}
        </div>
      )}
      <label className={`mt-3 block rounded-xl transition ${getGuideFocusClass('planner-input')}`}>
        <span className={labelClass}>{plannerMode === 'aplus' ? '标题 / 五点描述 / 品牌说明' : '标题 / 五点描述'}</span>
        <textarea
          value={listingText}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onListingTextChange(event.target.value)}
          className={`${fieldClass} min-h-[138px] resize-y`}
          placeholder={
            plannerMode === 'aplus'
              ? 'Title: ...\n\nAbout this item\n- Bullet 1...\n- Bullet 2...\n\nBrand story / tone: ...'
              : 'Title: ...\n\nAbout this item\n- Bullet 1...\n- Bullet 2...\n- Bullet 3...\n- Bullet 4...\n- Bullet 5...'
          }
        />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div
          aria-label="AI 策划模型"
          className={`min-w-[10rem] flex-1 rounded-xl transition sm:max-w-52 ${getGuideFocusClass('planner-api')}`}
        >
          <Select
            value={plannerProfile?.model ?? ''}
            onChange={(value) => onPlannerModelChange(String(value))}
            disabled={!plannerProfile}
            options={plannerModelOptions}
            className={`h-10 rounded-xl border bg-white px-3 text-sm text-gray-800 outline-none dark:bg-gray-950 dark:text-gray-100 ${plannerProfileValidation ? 'border-amber-300 dark:border-amber-400/40' : 'border-gray-200 dark:border-white/[0.08]'}`}
          />
        </div>
        <div
          className={`ml-auto flex flex-wrap items-center justify-end gap-2 rounded-xl transition ${getGuideFocusClass('planner-action')}`}
        >
          <button
            type="button"
            onClick={onConfirmCreatePlan}
            disabled={isPlanning || Boolean(plannerProfileValidation)}
            className={`inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold text-white transition ${isPlanning ? 'cursor-wait bg-gray-400' : plannerProfileValidation ? 'cursor-not-allowed bg-gray-300 dark:bg-white/[0.12]' : 'bg-blue-600 hover:bg-blue-500'}`}
          >
            {isPlanning ? '策划中...' : plannerMode === 'aplus' ? 'AI策划A+' : 'AI策划'}
          </button>
          {isPlanning && (
            <button
              type="button"
              onClick={onStopPlan}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 text-sm font-semibold text-red-600 transition hover:bg-red-50 dark:border-red-400/20 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-400/10"
            >
              <CloseIcon className="h-4 w-4" />
              停止
            </button>
          )}
          {hasListingContent && (
            <button
              type="button"
              onClick={onClearListingPlan}
              className="inline-flex h-10 items-center rounded-xl px-3 text-sm font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
            >
              清空
            </button>
          )}
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex h-10 items-center rounded-xl px-3 text-sm font-medium text-blue-600 transition hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-400/10"
          >
            设置
          </button>
        </div>
      </div>
      {plannerError && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-800 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-200">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-semibold">AI 策划失败详情</span>
            <button
              type="button"
              onClick={onCopyPlannerError}
              className="rounded-md px-2 py-1 text-[11px] font-medium text-red-700 transition hover:bg-red-100 dark:text-red-200 dark:hover:bg-red-400/10"
            >
              复制错误
            </button>
          </div>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
            {plannerError}
          </pre>
        </div>
      )}
    </>
  )
}
