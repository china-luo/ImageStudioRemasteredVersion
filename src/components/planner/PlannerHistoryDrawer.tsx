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
    <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/[0.08] dark:bg-gray-950">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">策划历史</div>
          <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            保存在当前浏览器中，恢复后会带回 Listing、策划卡片、风格候选和已选风格板。
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-xs font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
        >
          收起
        </button>
      </div>
      {sessions.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="rounded-lg border border-gray-200 bg-white p-3 dark:border-white/[0.08] dark:bg-gray-900"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{session.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
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
                {currentSessionId === session.id && (
                  <span className="shrink-0 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    当前
                  </span>
                )}
              </div>
              <div className="mt-2 line-clamp-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
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
                  className="inline-flex h-8 items-center rounded-lg bg-gray-900 px-3 text-xs font-semibold text-white transition hover:bg-gray-700 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-200"
                >
                  恢复
                </button>
                <button
                  type="button"
                  onClick={() => void onRemove(session.id)}
                  className="inline-flex h-8 items-center rounded-lg px-2 text-xs font-medium text-red-600 transition hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-400/10"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-200 bg-white px-3 py-4 text-center text-xs text-gray-500 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-400">
          暂无策划历史。AI 策划成功后会自动保存。
        </div>
      )}
    </div>
  )
}
