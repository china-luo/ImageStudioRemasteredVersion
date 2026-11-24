import { APP_BRAND_NAME, APP_REPOSITORY_URL } from '../../lib/appBrand'
import { getPublicAssetUrl } from '../../lib/publicAsset'

interface SettingsAboutTabProps {
  description: string
  descriptionExpanded: boolean
  onToggleDescription: () => void
}

export default function SettingsAboutTab({
  description,
  descriptionExpanded,
  onToggleDescription,
}: SettingsAboutTabProps) {
  return (
    <div className="flex h-full min-h-[300px] flex-col items-center overflow-y-auto px-6 py-6">
      <div className="mb-4 flex h-[88px] w-[88px] items-center justify-center rounded-3xl bg-[var(--surface-solid)] p-1.5 shadow-[var(--shadow-panel)]">
        <img
          src={getPublicAssetUrl('pwa-icon.png')}
          alt={`${APP_BRAND_NAME} Logo`}
          className="h-full w-full rounded-[1.25rem] object-cover"
        />
      </div>
      <h4 className="text-lg font-bold tracking-tight text-[var(--text-1)]">{APP_BRAND_NAME}</h4>
      <button
        type="button"
        title={description}
        onClick={onToggleDescription}
        className="group mt-2.5 max-w-[460px] rounded-2xl px-3.5 py-2 text-center transition hover:bg-[var(--surface-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
        aria-expanded={descriptionExpanded}
      >
        <span
          className="block text-[13px] leading-relaxed text-[var(--text-2)]"
          style={
            descriptionExpanded
              ? undefined
              : {
                  display: '-webkit-box',
                  WebkitBoxOrient: 'vertical',
                  WebkitLineClamp: 2,
                  overflow: 'hidden',
                }
          }
        >
          {description}
        </span>
        <span className="mt-1 block text-[11px] font-semibold text-[var(--accent)] opacity-0 transition group-hover:opacity-100 group-focus:opacity-100">
          {descriptionExpanded ? '收起介绍' : '查看完整介绍'}
        </span>
      </button>
      <div className="ui-inset mt-5 flex w-full max-w-[420px] flex-col items-center gap-3.5 p-5">
        <a href={APP_REPOSITORY_URL} target="_blank" rel="noreferrer" className="ui-btn ui-btn-sm rounded-full px-4">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M12 2C6.477 2 2 6.589 2 12.253c0 4.531 2.865 8.374 6.839 9.731.5.095.683-.222.683-.494 0-.244-.009-.89-.014-1.747-2.782.62-3.369-1.375-3.369-1.375-.455-1.186-1.11-1.502-1.11-1.502-.908-.636.069-.623.069-.623 1.004.072 1.532 1.057 1.532 1.057.892 1.565 2.341 1.113 2.91.851.091-.662.349-1.113.635-1.369-2.221-.259-4.556-1.138-4.556-5.064 0-1.119.39-2.034 1.029-2.751-.103-.26-.446-1.303.098-2.716 0 0 .84-.276 2.75 1.051A9.384 9.384 0 0 1 12 6.957a9.37 9.37 0 0 1 2.504.345c1.909-1.327 2.747-1.051 2.747-1.051.546 1.413.203 2.456.1 2.716.64.717 1.028 1.632 1.028 2.751 0 3.936-2.339 4.802-4.566 5.056.359.317.678.943.678 1.9 0 1.371-.012 2.477-.012 2.816 0 .274.18.594.688.493C21.138 20.623 24 16.782 24 12.253 24 6.589 19.523 2 12 2Z"
            />
          </svg>
          github.com/china-luo/ImageStudioRemasteredVersion
        </a>
        <div className="flex flex-col items-center gap-2">
          <img
            src={getPublicAssetUrl('support-wechat-pay-qr.png')}
            alt="微信赞助码"
            className="w-full max-w-[200px] rounded-2xl border border-[var(--line)] bg-white object-contain p-1.5 shadow-sm"
          />
          <span className="text-xs text-[var(--text-3)]">微信赞助码</span>
        </div>
      </div>
    </div>
  )
}
