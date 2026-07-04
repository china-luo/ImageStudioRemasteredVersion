import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { getPublicAssetUrl } from '../lib/publicAsset'
import { APP_REPOSITORY_URL } from '../lib/appBrand'
import { CloseIcon } from './icons'

export default function SupportPromptModal() {
  const supportPromptOpen = useStore((s) => s.supportPromptOpen)
  const dismissSupportPrompt = useStore((s) => s.dismissSupportPrompt)
  const confirmDialog = useStore((s) => s.confirmDialog)
  const detailTaskId = useStore((s) => s.detailTaskId)
  const lightboxImageId = useStore((s) => s.lightboxImageId)
  const showSettings = useStore((s) => s.showSettings)
  const maskEditorImageId = useStore((s) => s.maskEditorImageId)

  const blockedByHigherPriorityModal = Boolean(
    confirmDialog || detailTaskId || lightboxImageId || showSettings || maskEditorImageId,
  )
  const visible = supportPromptOpen && !blockedByHigherPriorityModal

  useCloseOnEscape(visible, dismissSupportPrompt)
  usePreventBackgroundScroll(visible)

  if (!visible) return null

  return createPortal(
    <div
      data-no-drag-select
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      onClick={dismissSupportPrompt}
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in" />
      <div
        className="relative z-10 flex max-h-[92vh] w-full max-w-md flex-col overflow-y-auto rounded-[2rem] border border-white/50 bg-white/95 p-6 pb-7 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="absolute right-4 top-4">
          <button
            type="button"
            onClick={dismissSupportPrompt}
            className="rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-white/[0.08] dark:hover:text-gray-200"
            aria-label="关闭"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-5 mt-4 flex justify-center">
          <img
            src={getPublicAssetUrl('support-wechat-pay-qr.png')}
            alt="微信赞助码"
            className="w-full max-w-[280px] rounded-[1.5rem] border border-gray-200 bg-white object-contain p-1.5 shadow-sm dark:border-white/[0.08]"
          />
        </div>

        <h3 className="mb-3 text-center text-xl font-bold text-gray-800 dark:text-gray-100">
          感谢支持
        </h3>

        <p className="mb-5 px-2 text-center text-[15px] leading-relaxed text-gray-500 dark:text-gray-400">
          你已经成功生成了超过 <strong className="font-semibold text-gray-800 dark:text-gray-200">50</strong> 张图片。若这个工作台帮到了你，可以扫码赞助支持继续优化。
        </p>

        <div className="mb-6 flex justify-center">
          <a
            href={APP_REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-white"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.589 2 12.253c0 4.531 2.865 8.374 6.839 9.731.5.095.683-.222.683-.494 0-.244-.009-.89-.014-1.747-2.782.62-3.369-1.375-3.369-1.375-.455-1.186-1.11-1.502-1.11-1.502-.908-.636.069-.623.069-.623 1.004.072 1.532 1.057 1.532 1.057.892 1.565 2.341 1.113 2.91.851.091-.662.349-1.113.635-1.369-2.221-.259-4.556-1.138-4.556-5.064 0-1.119.39-2.034 1.029-2.751-.103-.26-.446-1.303.098-2.716 0 0 .84-.276 2.75 1.051A9.384 9.384 0 0 1 12 6.957a9.37 9.37 0 0 1 2.504.345c1.909-1.327 2.747-1.051 2.747-1.051.546 1.413.203 2.456.1 2.716.64.717 1.028 1.632 1.028 2.751 0 3.936-2.339 4.802-4.566 5.056.359.317.678.943.678 1.9 0 1.371-.012 2.477-.012 2.816 0 .274.18.594.688.493C21.138 20.623 24 16.782 24 12.253 24 6.589 19.523 2 12 2Z" />
            </svg>
            @china-luo
          </a>
        </div>

        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={dismissSupportPrompt}
            className="rounded-2xl bg-gray-900 px-5 py-3 text-[15px] font-semibold text-white transition hover:bg-gray-700 active:scale-[0.98] dark:bg-white dark:text-gray-950 dark:hover:bg-gray-200"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
