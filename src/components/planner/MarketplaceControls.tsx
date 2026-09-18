import { AMAZON_MARKETPLACES, getAmazonMarketplace, type AmazonMarketplaceId } from '../../lib/amazonMarketplaces'

interface MarketplaceControlsProps {
  marketplaceId: AmazonMarketplaceId
  onChange: (marketplaceId: AmazonMarketplaceId) => void
  disabled?: boolean
}

export default function MarketplaceControls({ marketplaceId, onChange, disabled = false }: MarketplaceControlsProps) {
  const marketplace = getAmazonMarketplace(marketplaceId)

  return (
    <div className="mt-3 grid gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-white/[0.08] dark:bg-gray-950 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center">
      <div>
        <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Amazon 目标站点</div>
        <div className="mt-0.5 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
          Prompt 主体保持英文；图片里可见文案使用 {marketplace.onImageCopyLanguage}。
        </div>
      </div>
      <select
        value={marketplaceId}
        onChange={(event) => onChange(event.target.value as AmazonMarketplaceId)}
        disabled={disabled}
        className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-sm font-semibold text-gray-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-100 dark:disabled:bg-white/[0.04] dark:disabled:text-gray-500"
      >
        {AMAZON_MARKETPLACES.map((option) => (
          <option key={option.id} value={option.id}>
            {option.shortLabel} · {option.label} · {option.domain}
          </option>
        ))}
      </select>
    </div>
  )
}
