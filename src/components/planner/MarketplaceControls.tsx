import { AMAZON_MARKETPLACES, getAmazonMarketplace, type AmazonMarketplaceId } from '../../lib/amazonMarketplaces'

interface MarketplaceControlsProps {
  marketplaceId: AmazonMarketplaceId
  onChange: (marketplaceId: AmazonMarketplaceId) => void
  disabled?: boolean
}

export default function MarketplaceControls({ marketplaceId, onChange, disabled = false }: MarketplaceControlsProps) {
  const marketplace = getAmazonMarketplace(marketplaceId)

  return (
    <div className="ui-inset mt-3 grid gap-2.5 px-3.5 py-2.5 lg:grid-cols-[minmax(0,1fr)_228px] lg:items-center">
      <div>
        <div className="text-xs font-semibold text-[var(--text-1)]">Amazon 目标站点</div>
        <div className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-3)]">
          Prompt 主体保持英文；图片里可见文案使用 <span className="font-medium text-[var(--text-2)]">{marketplace.onImageCopyLanguage}</span>。
        </div>
      </div>
      <select
        value={marketplaceId}
        onChange={(event) => onChange(event.target.value as AmazonMarketplaceId)}
        disabled={disabled}
        className="ui-input h-9 min-h-0 py-0 text-[13px] font-semibold"
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
