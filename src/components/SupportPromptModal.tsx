import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { getPublicAssetUrl } from '../lib/publicAsset'
import { APP_REPOSITORY_URL } from '../lib/appBrand'
import { SUPPORT_PROMPT_IMAGE_THRESHOLD } from '../lib/supportPrompt'
import { CloseIcon, FavoriteIcon, GithubIcon } from './icons'

export default function SupportPromptModal() {
  const supportPromptOpen = useStore((s) => s.supportPromptOpen)
  const dismissSupportPrompt = useStore((s) => s.dismissSupportPrompt)
  const confirmDialog = useStore((s) => s.confirmDialog)
  const detailTaskId = useStore((s) => s.detailTaskId)
  const lightboxImageId = useStore((s) => s.lightboxImageId)
  const showSettings = useStore((s) => s.showSettings)
  const maskEditorImageId = useStore((s) => s.maskEditorImageId)
  const [showDonationQr, setShowDonationQr] = useState(false)

  const blockedByHigherPriorityModal = Boolean(
    confirmDialog || detailTaskId || lightboxImageId || showSettings || maskEditorImageId,
  )
  const visible = supportPromptOpen && !blockedByHigherPriorityModal

  useCloseOnEscape(visible, dismissSupportPrompt)
  usePreventBackgroundScroll(visible)

  useEffect(() => {
    if (!visible) setShowDonationQr(false)
  }, [visible])

  if (!visible) return null

  return createPortal(
    <div
      data-no-drag-select
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      onClick={dismissSupportPrompt}
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="support-prompt-title"
        className="relative z-10 flex max-h-[92vh] w-full max-w-sm flex-col overflow-y-auto rounded-2xl border border-white/50 bg-white/95 p-6 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10"
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

        <div className="mx-auto mt-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/20">
          <FavoriteIcon filled className="h-5 w-5" />
        </div>

        <h3 id="support-prompt-title" className="mt-4 text-center text-xl font-bold text-gray-900 dark:text-gray-100">
          {SUPPORT_PROMPT_IMAGE_THRESHOLD === 1
            ? '第一张图片生成成功'
            : `已成功生成 ${SUPPORT_PROMPT_IMAGE_THRESHOLD} 张图片`}
        </h3>

        <p className="mt-2 px-2 text-center text-sm leading-6 text-gray-500 dark:text-gray-400">
          如果这个工作台帮到了你，可以任选一种方式支持作者继续优化。
        </p>

        <a
          href={APP_REPOSITORY_URL}
          target="_blank"
          rel="noreferrer"
          onClick={dismissSupportPrompt}
          className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gray-950 px-4 text-sm font-semibold text-white transition hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 active:scale-[0.99] dark:bg-white dark:text-gray-950 dark:hover:bg-gray-200 dark:focus:ring-offset-gray-900"
        >
          <GithubIcon className="h-4 w-4" />
          去 GitHub 点个 Star
        </a>

        {!showDonationQr && (
          <button
            type="button"
            onClick={() => setShowDonationQr(true)}
            className="mt-3 inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-300 focus:ring-offset-2 active:scale-[0.99] dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200 dark:hover:bg-rose-400/15 dark:focus:ring-offset-gray-900"
          >
            <FavoriteIcon filled className="h-4 w-4" />
            打赏 1 元
          </button>
        )}

        {showDonationQr && (
          <div className="mt-4">
            <img
              src={getPublicAssetUrl('support-wechat-pay-qr.png')}
              alt="微信 / 支付宝打赏码"
              className="mx-auto w-full max-w-[280px] rounded-xl border border-gray-200 bg-white object-contain p-1.5 shadow-sm dark:border-white/[0.08]"
            />
            <p className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400">
              微信 / 支付宝扫码打赏 1 元
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
