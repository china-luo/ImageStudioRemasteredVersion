import { useStore } from '../store'

export default function Toast() {
  const toast = useStore((s) => s.toast)

  if (!toast) return null

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )
      case 'error':
        return (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500/15 text-red-600 dark:text-red-400">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        )
      default:
        return (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
        )
    }
  }

  return (
    <div className="pointer-events-none fixed bottom-24 left-1/2 z-[120] toast-enter">
      <div className="flex w-max max-w-[calc(100vw-32px)] items-center gap-2.5 rounded-full bg-[var(--surface-panel-strong)] px-5 py-3 text-sm font-medium text-[var(--text-1)] shadow-[var(--shadow-float)] backdrop-blur-2xl sm:max-w-[min(28rem,60vw)]">
        <span className="flex-shrink-0">{getIcon()}</span>
        <span className="whitespace-pre-line text-center leading-5">{toast.message}</span>
      </div>
    </div>
  )
}
