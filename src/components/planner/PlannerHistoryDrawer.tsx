import type { AmazonPlannerSession } from '../../types'
import { getAmazonMarketplaceLabel } from '../../lib/amazonMarketplaces'
import { getAPlusContentTypeLabel } from '../../lib/listingPlanner'
import { formatPlannerSessionTime } from './plannerHelpers'

interface PlannerHistoryDrawerProps {
  sessions: AmazonPlannerSession[]
  currentSessionId: string | null
  onClose: () => void
  onRestore: (session: AmazonPlannerSession) => Promise<void>
  onRemove: (sessionId: string) => Promise<void>
  onError: (message: string) => void
}

export default function PlannerHistoryDrawer({
  sessions,
  currentSessionId,
  onClose,
  onRestore,
  onRemove,
  onError,
}: PlannerHistoryDrawerProps) {
  return (
    <div className="ui-inset animate-fade-up mt-4 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-[var(--text-1)]">策划历史</div>
          <div className="mt-0.5 text-xs text-[var(--text-3)]">
            保存在当前浏览器中，恢复后会带回 Listing、策划卡片、风格候选和已选风格板。
          </div>
        </div>
        <button type="button" onClick={onClose} className="ui-btn ui-btn-ghost ui-btn-sm">
          收起
        </button>
      </div>
      {sessions.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sessions.map((session) => {
            const isCurrent = currentSessionId === session.id
            return (
              <div
                key={session.id}
                className={`rounded-xl border p-3.5 transition ${
                  isCurrent
                    ? 'border-[var(--accent-ring)] bg-[var(--surface-solid)] shadow-sm'
                    : 'border-[var(--line)] bg-[var(--surface-solid)] hover:border-[var(--line-strong)]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--text-1)]">{session.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-3)]">
                      <span>{session.mode === 'aplus' ? 'A+ 图' : 'Listing 图'}</span>
                      <span>·</span>
                      <span>
                        {session.platform === 'tiktok' ? 'TikTok' : getAmazonMarketplaceLabel(session.marketplaceId)}
                      </span>
                      <span>·</span>
                      <span>
                        {session.mode === 'aplus'
                          ? getAPlusContentTypeLabel(session.aPlusType)
                          : `${session.imagePlans.length} 张`}
                      </span>
                      <span>·</span>
                      <span>{formatPlannerSessionTime(session.updatedAt)}</span>
                    </div>
                  </div>
                  {isCurrent && <span className="ui-badge ui-badge-accent shrink-0">当前</span>}
                </div>
                <div className="mt-2 line-clamp-2 text-xs leading-relaxed text-[var(--text-2)]">
                  {session.listingText || session.draft.sellingPoints || '无 Listing 文本'}
                </div>
                <div className="mt-3 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void onRestore(session).catch((err) => {
                        onError(`策划历史恢复失败：${err instanceof Error ? err.message : String(err)}`)
                      })
                    }}
                    className="ui-btn ui-btn-primary ui-btn-sm"
                  >
                    恢复
                  </button>
                  <button
                    type="button"
                    onClick={() => void onRemove(session.id)}
                    className="ui-btn ui-btn-danger-soft ui-btn-sm"
                  >
                    删除
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--line-strong)] bg-[var(--surface-solid)] px-4 py-6 text-center text-xs text-[var(--text-3)]">
          暂无策划历史。AI 策划成功后会自动保存。
        </div>
      )}
    </div>
  )
}
