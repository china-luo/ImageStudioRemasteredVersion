import { useState, type ReactNode } from 'react'
import ViewportTooltip from '../ViewportTooltip'

type InputSubmitControlsProps = {
  mobileCollapsed: boolean
  atImageLimit: boolean
  uploadImageTooltipText: string
  hasSubmitApiConfig: boolean
  missingRequiredImage: boolean
  canSubmit: boolean
  submitTooltipText: string
  submitButtonAriaLabel: string
  submitLabel: string
  renderParams: (cols: string) => ReactNode
  onChooseFiles: () => void
  onTakePhoto: () => void
  onSubmit: () => void
  onOpenSettings: () => void
}

function Tooltip({ visible, text }: { visible: boolean; text: string }) {
  if (!visible) return null
  return (
    <ViewportTooltip visible className="z-10 whitespace-nowrap">
      {text}
    </ViewportTooltip>
  )
}

function SubmitButton({
  mobile,
  hasSubmitApiConfig,
  missingRequiredImage,
  canSubmit,
  tooltipText,
  ariaLabel,
  label,
  onSubmit,
  onOpenSettings,
}: {
  mobile: boolean
  hasSubmitApiConfig: boolean
  missingRequiredImage: boolean
  canSubmit: boolean
  tooltipText: string
  ariaLabel: string
  label: string
  onSubmit: () => void
  onOpenSettings: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      className={mobile ? 'relative flex-1' : 'relative'}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Tooltip visible={(!hasSubmitApiConfig || missingRequiredImage) && hovered} text={tooltipText} />
      <button
        type="button"
        onClick={hasSubmitApiConfig ? onSubmit : onOpenSettings}
        disabled={hasSubmitApiConfig ? !canSubmit : false}
        aria-label={ariaLabel}
        className={`${mobile ? 'w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium' : 'p-2.5'} rounded-xl transition-all shadow-sm hover:shadow ${
          !hasSubmitApiConfig
            ? 'bg-gray-300 dark:bg-white/[0.06] text-white cursor-pointer'
            : 'bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-white/[0.04] disabled:opacity-50 disabled:cursor-not-allowed'
        }`}
      >
        <svg className={mobile ? 'w-4 h-4' : 'w-5 h-5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
        </svg>
        {mobile && label}
      </button>
    </div>
  )
}

export function InputSubmitControls(props: InputSubmitControlsProps) {
  const [attachHovered, setAttachHovered] = useState(false)
  const [showMobileUploadMenu, setShowMobileUploadMenu] = useState(false)
  const submitProps = {
    hasSubmitApiConfig: props.hasSubmitApiConfig,
    missingRequiredImage: props.missingRequiredImage,
    canSubmit: props.canSubmit,
    tooltipText: props.submitTooltipText,
    ariaLabel: props.submitButtonAriaLabel,
    label: props.submitLabel,
    onSubmit: props.onSubmit,
    onOpenSettings: props.onOpenSettings,
  }
  const uploadButtonClass = props.atImageLimit
    ? 'bg-gray-200 dark:bg-white/[0.04] text-gray-300 dark:text-gray-500 cursor-not-allowed'
    : 'bg-gray-200 dark:bg-white/[0.06] hover:bg-gray-300 dark:hover:bg-white/[0.1] text-gray-500 dark:text-gray-300'

  return (
    <>
      <div className="hidden items-end justify-between gap-3 sm:flex lg:flex-col lg:items-stretch">
        {props.renderParams('grid-cols-6 lg:grid-cols-3')}
        <div className="mb-0.5 flex flex-shrink-0 gap-2 lg:mb-0 lg:justify-end">
          <div
            className="relative"
            onMouseEnter={() => setAttachHovered(true)}
            onMouseLeave={() => setAttachHovered(false)}
          >
            <Tooltip visible={attachHovered} text={props.uploadImageTooltipText} />
            <button
              type="button"
              onClick={() => !props.atImageLimit && props.onChooseFiles()}
              className={`p-2.5 rounded-xl transition-all shadow-sm ${uploadButtonClass}`}
              aria-label={props.uploadImageTooltipText}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                />
              </svg>
            </button>
          </div>
          <SubmitButton mobile={false} {...submitProps} />
        </div>
      </div>

      <div className="sm:hidden flex flex-col gap-2">
        <div className={`collapse-section${props.mobileCollapsed ? ' collapsed' : ''}`}>
          <div className="collapse-inner">
            {props.renderParams('grid-cols-2')}
            <div className="h-2" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="relative"
            onMouseEnter={() => setAttachHovered(true)}
            onMouseLeave={() => setAttachHovered(false)}
          >
            <Tooltip visible={attachHovered} text={props.uploadImageTooltipText} />
            <button
              type="button"
              onClick={() => !props.atImageLimit && setShowMobileUploadMenu((visible) => !visible)}
              className={`p-2.5 rounded-xl transition-all shadow-sm flex-shrink-0 ${uploadButtonClass}`}
              aria-label={props.uploadImageTooltipText}
            >
              <svg
                className={`w-5 h-5 transition-transform duration-200 ${showMobileUploadMenu ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
            {showMobileUploadMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMobileUploadMenu(false)} />
                <div className="absolute bottom-full left-0 mb-2 w-32 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
                  <button
                    type="button"
                    className="w-full px-4 py-3 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2 transition-colors"
                    onClick={() => {
                      setShowMobileUploadMenu(false)
                      props.onTakePhoto()
                    }}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                    拍照
                  </button>
                  <button
                    type="button"
                    className="w-full px-4 py-3 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2 transition-colors"
                    onClick={() => {
                      setShowMobileUploadMenu(false)
                      props.onChooseFiles()
                    }}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                      />
                    </svg>
                    上传图片
                  </button>
                </div>
              </>
            )}
          </div>
          <SubmitButton mobile {...submitProps} />
        </div>
      </div>
    </>
  )
}
