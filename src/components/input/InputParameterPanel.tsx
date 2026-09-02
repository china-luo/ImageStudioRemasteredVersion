import type { ReactNode } from 'react'
import type { TaskParams } from '../../types'
import Select from '../Select'
import ViewportTooltip from '../ViewportTooltip'

type HintController = {
  visible: boolean
  show: () => void
  hide: () => void
  startTouch: () => void
  clearTimer: () => void
}

type InputParameterPanelProps = {
  cols: string
  params: TaskParams
  codexCli: boolean
  isFalProvider: boolean
  isFalTextToImage: boolean
  displaySize: string
  qualityOptions: Array<{ label: string; value: string }>
  outputCompressionInput: string
  compressionDisabled: boolean
  moderationDisabled: boolean
  nInput: string
  outputImageLimit: number
  nLimitHintText: string
  sizeHint: HintController
  qualityHint: HintController
  compressionHint: HintController
  moderationHint: HintController
  nLimitHint: Pick<HintController, 'visible' | 'hide'>
  onOpenSizePicker: () => void
  onParamsChange: (patch: Partial<TaskParams>) => void
  onCompressionInputChange: (value: string) => void
  onCommitCompression: () => void
  onNInputChange: (value: string) => void
  onNInputFocusChange: (focused: boolean) => void
  onCommitN: () => void
  onNLimitIncreaseAttempt: (preventDefault: () => void) => void
}

function ParameterTooltip({ visible, children }: { visible: boolean; children: ReactNode }) {
  if (!visible) return null
  return (
    <ViewportTooltip visible className="z-10 whitespace-nowrap">
      {children}
    </ViewportTooltip>
  )
}

export function InputParameterPanel({
  cols,
  params,
  codexCli,
  isFalProvider,
  isFalTextToImage,
  displaySize,
  qualityOptions,
  outputCompressionInput,
  compressionDisabled,
  moderationDisabled,
  nInput,
  outputImageLimit,
  nLimitHintText,
  sizeHint,
  qualityHint,
  compressionHint,
  moderationHint,
  nLimitHint,
  onOpenSizePicker,
  onParamsChange,
  onCompressionInputChange,
  onCommitCompression,
  onNInputChange,
  onNInputFocusChange,
  onCommitN,
  onNLimitIncreaseAttempt,
}: InputParameterPanelProps) {
  const selectClass =
    'px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] hover:bg-white dark:hover:bg-white/[0.06] focus:outline-none text-xs transition-all duration-200 shadow-sm'

  return (
    <div className={`grid ${cols} gap-2 text-xs min-w-0 flex-1 lg:w-full lg:flex-none`}>
      <label
        className="relative flex flex-col gap-0.5"
        onMouseEnter={sizeHint.show}
        onMouseLeave={sizeHint.hide}
        onTouchStart={sizeHint.startTouch}
        onTouchEnd={sizeHint.clearTimer}
        onTouchCancel={sizeHint.hide}
        onClick={sizeHint.show}
      >
        <span className="text-gray-400 dark:text-gray-500 ml-1">尺寸</span>
        <button
          type="button"
          onClick={onOpenSizePicker}
          className="px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] hover:bg-white dark:hover:bg-white/[0.06] focus:outline-none text-xs text-left transition-all duration-200 shadow-sm font-mono"
          title="选择尺寸"
        >
          {displaySize}
        </button>
        <ParameterTooltip visible={isFalTextToImage && sizeHint.visible}>
          fal.ai 的文生图模式不支持 <code className="rounded bg-white/10 px-1 py-0.5 font-mono">auto</code> 参数
        </ParameterTooltip>
      </label>
      <label
        className="relative flex flex-col gap-0.5"
        onMouseEnter={qualityHint.show}
        onMouseLeave={qualityHint.hide}
        onTouchStart={qualityHint.startTouch}
        onTouchEnd={qualityHint.clearTimer}
        onTouchCancel={qualityHint.hide}
        onClick={qualityHint.show}
      >
        <span className="text-gray-400 dark:text-gray-500 ml-1">质量</span>
        <Select
          value={codexCli ? 'auto' : isFalProvider && params.quality === 'auto' ? 'high' : params.quality}
          onChange={(value) => !codexCli && onParamsChange({ quality: value as TaskParams['quality'] })}
          options={qualityOptions}
          disabled={codexCli}
          className={
            codexCli
              ? 'px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-gray-100/50 dark:bg-white/[0.05] opacity-50 cursor-not-allowed text-xs transition-all duration-200 shadow-sm'
              : selectClass
          }
        />
        <ParameterTooltip visible={(codexCli || isFalProvider) && qualityHint.visible}>
          {isFalProvider ? (
            <>
              fal.ai 不支持 <code className="rounded bg-white/10 px-1 py-0.5 font-mono">auto</code> 质量参数
            </>
          ) : (
            'Codex CLI 不支持质量参数'
          )}
        </ParameterTooltip>
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-gray-400 dark:text-gray-500 ml-1">格式</span>
        <Select
          value={params.output_format}
          onChange={(value) => onParamsChange({ output_format: value as TaskParams['output_format'] })}
          options={[
            { label: 'PNG', value: 'png' },
            { label: 'JPEG', value: 'jpeg' },
            { label: 'WebP', value: 'webp' },
          ]}
          className={selectClass}
        />
      </label>
      <label
        className="relative flex flex-col gap-0.5"
        onMouseEnter={compressionHint.show}
        onMouseLeave={compressionHint.hide}
        onTouchStart={compressionHint.startTouch}
        onTouchEnd={compressionHint.clearTimer}
        onTouchCancel={compressionHint.hide}
        onClick={compressionHint.show}
      >
        <span className="text-gray-400 dark:text-gray-500 ml-1">压缩率</span>
        <input
          value={outputCompressionInput}
          onChange={(event) => onCompressionInputChange(event.target.value)}
          onBlur={onCommitCompression}
          disabled={compressionDisabled}
          type="number"
          min={0}
          max={100}
          placeholder="0-100"
          className={`px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] focus:outline-none text-xs transition-all duration-200 shadow-sm ${
            compressionDisabled
              ? 'bg-gray-100/50 dark:bg-white/[0.05] opacity-50 cursor-not-allowed'
              : 'bg-white/50 dark:bg-white/[0.03]'
          }`}
        />
        <ParameterTooltip visible={compressionHint.visible}>
          {isFalProvider ? 'fal.ai 不支持压缩率参数' : '仅 JPEG 和 WebP 支持压缩率'}
        </ParameterTooltip>
      </label>
      <label
        className="relative flex flex-col gap-0.5"
        onMouseEnter={moderationHint.show}
        onMouseLeave={moderationHint.hide}
        onTouchStart={moderationHint.startTouch}
        onTouchEnd={moderationHint.clearTimer}
        onTouchCancel={moderationHint.hide}
        onClick={moderationHint.show}
      >
        <span className="text-gray-400 dark:text-gray-500 ml-1">审核</span>
        <Select
          value={moderationDisabled ? 'auto' : params.moderation}
          onChange={(value) => !moderationDisabled && onParamsChange({ moderation: value as TaskParams['moderation'] })}
          options={[
            { label: 'auto', value: 'auto' },
            { label: 'low', value: 'low' },
          ]}
          disabled={moderationDisabled}
          className={
            moderationDisabled
              ? 'px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-gray-100/50 dark:bg-white/[0.05] opacity-50 cursor-not-allowed text-xs transition-all duration-200 shadow-sm'
              : selectClass
          }
        />
        <ParameterTooltip visible={moderationDisabled && moderationHint.visible}>
          fal.ai 不支持审核参数
        </ParameterTooltip>
      </label>
      <label className="relative flex flex-col gap-0.5" onMouseLeave={nLimitHint.hide} onTouchCancel={nLimitHint.hide}>
        <span className="text-gray-400 dark:text-gray-500 ml-1">数量</span>
        <input
          value={nInput}
          onChange={(event) => onNInputChange(event.target.value)}
          onFocus={() => onNInputFocusChange(true)}
          onBlur={() => {
            onNInputFocusChange(false)
            onCommitN()
          }}
          onKeyDown={(event) => event.key === 'ArrowUp' && onNLimitIncreaseAttempt(() => event.preventDefault())}
          onWheel={(event) => event.deltaY < 0 && onNLimitIncreaseAttempt(() => event.preventDefault())}
          type="number"
          min={1}
          max={outputImageLimit}
          className="px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] focus:outline-none text-xs transition-all duration-200 shadow-sm bg-white/50 dark:bg-white/[0.03]"
        />
        <ParameterTooltip visible={nLimitHint.visible}>{nLimitHintText}</ParameterTooltip>
      </label>
    </div>
  )
}
