import type { ChangeEvent } from 'react'
import type {
  APlusContentType,
  AmazonPlannerMode,
  CommercePlannerPlatform,
  TiktokDesignType,
} from '../../lib/listingPlanner'
import type { AmazonMarketplaceId } from '../../lib/amazonMarketplaces'
import type { ApiProfile } from '../../types'
import { CloseIcon, SettingsIcon, SparklesIcon } from '../icons'
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
  planningStage: 'idle' | 'preparing' | 'requesting' | 'parsing'
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
  planningStage,
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
  const isBusy = isPlanning
  const trimmedLength = listingText.trim().length
  const nonEmptyLines = trimmedLength ? listingText.split(/\r?\n/).filter((line) => line.trim()).length : 0

  return (
    <>
      {plannerGuideActive && <div className={`${guideHintClass} mt-3`}>{guideMessage}</div>}
      {plannerPlatform === 'tiktok' && (
        <div className="mt-3 rounded-lg border border-pink-200/80 bg-pink-50/75 px-3 py-2 text-xs leading-relaxed text-pink-800 dark:border-pink-400/20 dark:bg-pink-500/10 dark:text-pink-200">
          {tiktokDesignType === 'detail'
            ? '当前板块：TikTok 商品详情图。AI 会按 TikTok Shop 移动端详情页节奏生成 8 张竖版说明图方案。'
            : '当前板块：TikTok 商品主图。AI 会生成 6 张方形主图/卖点图方案，适合移动端商品卡片和详情首屏。'}
        </div>
      )}
      {plannerPlatform === 'amazon' && (
        <MarketplaceControls marketplaceId={marketplaceId} onChange={onMarketplaceChange} disabled={isBusy} />
      )}
      {plannerMode === 'aplus' && (
        <div className="mt-3 inline-flex rounded-[9px] bg-[var(--surface-inset)] p-[3px] shadow-[inset_0_0_0_1px_var(--line)]">
          {aPlusContentTypes.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => onAPlusTypeChange(type)}
              disabled={isBusy}
              className={`h-7 rounded-[6px] px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                aPlusType === type
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-white/10 dark:text-white'
                  : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
              }`}
            >
              {getAPlusContentTypeLabel(type)}
            </button>
          ))}
        </div>
      )}
      <div className={`mt-3.5 rounded-xl transition ${getGuideFocusClass('planner-input')}`}>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <label htmlFor="planner-listing-input" className={`${labelClass} !mb-0`}>
            {plannerMode === 'aplus' ? '标题 / 五点描述 / 品牌说明' : '标题 / 五点描述'}
          </label>
          {trimmedLength > 0 && (
            <span className="text-[11px] font-medium tabular-nums text-[var(--text-3)]">
              {trimmedLength} 字符 · {nonEmptyLines} 行
            </span>
          )}
        </div>
        <textarea
          id="planner-listing-input"
          value={listingText}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onListingTextChange(event.target.value)}
          disabled={isBusy}
          className={`${fieldClass} min-h-[168px] resize-y`}
          placeholder={
            plannerMode === 'aplus'
              ? 'Title: ...\n\nAbout this item\n- Bullet 1...\n- Bullet 2...\n\nBrand story / tone: ...'
              : 'Title: ...\n\nAbout this item\n- Bullet 1...\n- Bullet 2...\n- Bullet 3...\n- Bullet 4...\n- Bullet 5...'
          }
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div
          aria-label="AI 策划模型"
          className={`min-w-[10rem] flex-1 rounded-lg transition sm:max-w-52 ${getGuideFocusClass('planner-api')}`}
        >
          <Select
            value={plannerProfile?.model ?? ''}
            onChange={(value) => onPlannerModelChange(String(value))}
            disabled={!plannerProfile || isBusy}
            options={plannerModelOptions}
            className={`h-9 rounded-[var(--radius-control)] border bg-[var(--surface-solid)] px-3 text-xs font-medium text-[var(--text-1)] outline-none transition ${
              plannerProfileValidation
                ? 'border-amber-400/75 shadow-[0_0_0_3px_rgb(217_119_6/0.12)]'
                : 'border-[var(--line-strong)] hover:border-[var(--text-3)]'
            }`}
          />
        </div>
        <div
          className={`ml-auto flex flex-wrap items-center justify-end gap-2 rounded-lg transition ${getGuideFocusClass('planner-action')}`}
        >
          <button
            type="button"
            onClick={onConfirmCreatePlan}
            disabled={isBusy || Boolean(plannerProfileValidation)}
            className={`ui-btn h-9 px-4 text-xs sm:text-[13px] ${
              isBusy ? 'ui-btn-soft cursor-wait' : plannerProfileValidation ? '' : 'ui-btn-primary'
            }`}
          >
            <SparklesIcon className="h-3.5 w-3.5" />
            {isPlanning
              ? planningStage === 'preparing'
                ? '准备参考图...'
                : planningStage === 'parsing'
                  ? '解析结果...'
                  : '请求模型...'
              : plannerMode === 'aplus'
                ? 'AI策划A+'
                : 'AI策划'}
          </button>
          {isBusy && (
            <button type="button" onClick={onStopPlan} className="ui-btn ui-btn-danger-soft h-9 px-3 text-xs">
              <CloseIcon className="h-3.5 w-3.5" />
              停止
            </button>
          )}
          {hasListingContent && (
            <button
              type="button"
              onClick={onClearListingPlan}
              disabled={isBusy}
              className="ui-btn ui-btn-ghost h-9 px-2.5 text-xs"
            >
              清空
            </button>
          )}
          <button type="button" onClick={onOpenSettings} disabled={isBusy} className="ui-btn h-9 px-3 text-xs">
            <SettingsIcon className="h-3.5 w-3.5" />
            设置
          </button>
        </div>
      </div>
      {isBusy && (
        <div role="status" className="ui-callout ui-callout-accent mt-3 items-center py-2 text-xs font-medium">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--accent)]" />
          {planningStage === 'preparing'
            ? '正在处理参考图'
            : planningStage === 'parsing'
              ? '模型已返回，正在解析策划结果'
              : '已提交请求，正在等待模型返回'}
        </div>
      )}
      {plannerError && (
        <div className="ui-callout ui-callout-danger mt-3 flex-col gap-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">AI 处理失败详情</span>
            <button
              type="button"
              onClick={onCopyPlannerError}
              className="rounded-md bg-red-500/15 px-2.5 py-1 text-[11px] font-semibold transition hover:bg-red-500/25"
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
