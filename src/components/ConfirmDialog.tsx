import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { Checkbox } from './Checkbox'
import { CopyIcon } from './icons'

function renderMessage(message: string) {
  return message.split(/(`[^`]+`|「[^」]+」|\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={index}
          className="rounded-md bg-[var(--surface-inset)] px-1.5 py-0.5 font-mono text-[0.85em] text-[var(--text-1)] shadow-[inset_0_0_0_1px_var(--line)]"
        >
          {part.slice(1, -1)}
        </code>
      )
    }

    if (part.startsWith('「') && part.endsWith('」')) {
      return (
        <strong key={index} className="font-semibold text-[var(--text-1)]">
          {part}
        </strong>
      )
    }

    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} className="font-semibold text-[var(--text-1)]">
          {part.slice(2, -2)}
        </strong>
      )
    }

    return part
  })
}

function getActionButtonClass(tone: 'primary' | 'secondary' | 'danger' | 'warning' = 'primary') {
  if (tone === 'secondary') return 'ui-btn'
  if (tone === 'warning')
    return 'ui-btn border-0 bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-md hover:brightness-105'
  if (tone === 'danger') return 'ui-btn ui-btn-danger'
  return 'ui-btn ui-btn-primary'
}

export default function ConfirmDialog() {
  const confirmDialog = useStore((s) => s.confirmDialog)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const [canConfirm, setCanConfirm] = useState(true)
  const [checkboxChecked, setCheckboxChecked] = useState(false)

  useEffect(() => {
    const delay = confirmDialog?.minConfirmDelayMs ?? 0
    if (!confirmDialog || delay <= 0) {
      setCanConfirm(true)
      return
    }

    setCanConfirm(false)
    const timer = window.setTimeout(() => setCanConfirm(true), delay)
    return () => window.clearTimeout(timer)
  }, [confirmDialog])

  useEffect(() => {
    setCheckboxChecked(confirmDialog?.checkbox?.defaultChecked ?? false)
  }, [confirmDialog])

  const handleClose = () => {
    if (!canConfirm) return
    setConfirmDialog(null)
  }

  const handleCancel = () => {
    confirmDialog?.cancelAction?.(checkboxChecked)
    handleClose()
  }

  useCloseOnEscape(Boolean(confirmDialog) && canConfirm, handleClose)
  usePreventBackgroundScroll(Boolean(confirmDialog))

  if (!confirmDialog) return null
  const isDestructive = confirmDialog.title.includes('删除') || confirmDialog.title.includes('清空')
  const confirmTone = confirmDialog.tone ?? (isDestructive ? 'danger' : undefined)
  const confirmClassName = getActionButtonClass(
    confirmTone === 'danger' || confirmTone === 'warning' ? confirmTone : 'primary',
  )
  const confirmText = confirmDialog.confirmText ?? (isDestructive ? '确认删除' : '确认')
  const cancelText = confirmDialog.cancelText ?? '取消'
  const customButtons = confirmDialog.buttons?.filter((button) => button.label.trim()) ?? []

  return (
    <div
      data-no-drag-select
      className="fixed inset-0 z-[110] flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div className="ui-backdrop animate-overlay-in absolute inset-0" />
      <div
        className="ui-modal animate-confirm-in relative z-10 w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2.5 flex items-center gap-2.5 text-base font-bold text-[var(--text-1)]">
          {confirmDialog.icon === 'info' && (
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                viewBox="0 0 24 24"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
            </span>
          )}
          {confirmDialog.icon === 'copy' && (
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
              <CopyIcon className="h-4 w-4" />
            </span>
          )}
          {confirmDialog.title}
        </h3>
        <p
          className={`whitespace-pre-line text-sm leading-relaxed text-[var(--text-2)] ${confirmDialog.checkbox ? 'mb-4' : 'mb-6'} ${confirmDialog.messageAlign === 'center' ? 'text-center' : ''}`}
        >
          {renderMessage(confirmDialog.message)}
        </p>
        {confirmDialog.checkbox && (
          <Checkbox
            checked={checkboxChecked}
            onChange={setCheckboxChecked}
            label={confirmDialog.checkbox.label}
            tone={confirmDialog.checkbox.tone}
            disabled={confirmDialog.checkbox.disabled}
            className="mb-6"
          />
        )}
        {customButtons.length > 0 ? (
          <div className="flex gap-2.5">
            {customButtons.map((button) => (
              <button
                key={button.label}
                onClick={() => {
                  if (!canConfirm) return
                  button.action(checkboxChecked)
                  setConfirmDialog(null)
                }}
                disabled={!canConfirm}
                className={`flex-1 ${getActionButtonClass(button.tone)}`}
              >
                {button.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex gap-2.5">
            {confirmDialog.showCancel !== false && (
              <button onClick={handleCancel} className="ui-btn flex-1">
                {cancelText}
              </button>
            )}
            <button
              onClick={() => {
                if (!canConfirm) return
                confirmDialog.action?.(checkboxChecked)
                setConfirmDialog(null)
              }}
              disabled={!canConfirm}
              className={`flex-1 ${confirmClassName}`}
            >
              {confirmText}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
