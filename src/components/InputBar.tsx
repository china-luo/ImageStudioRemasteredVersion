import {
  useRef,
  useEffect,
  useCallback,
  useState,
  useMemo,
  useLayoutEffect,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  useStore,
  submitTask,
  addImageFromFile,
  createInputImageFromFile,
  deleteImageIfUnreferenced,
  updateTaskInStore,
  removeMultipleTasks,
  ensureImageCached,
} from '../store'
import { DEFAULT_PARAMS } from '../types'
import { getActiveApiProfile, normalizeSettings } from '../lib/apiProfiles'
import {
  DEFAULT_FAL_IMAGE_SIZE,
  getChangedParams,
  getInputImageLimitForSettings,
  getOutputImageLimitForSettings,
  normalizeParamsForSettings,
} from '../lib/paramCompatibility'
import {
  getAtImageQuery,
  getImageMentionLabel,
  getPromptIndexFromVisibleIndex,
  getPromptMentionParts,
  getSelectedImageMentionLabel,
  imageMentionMatches,
  insertImageMentionAtVisibleRange,
  isCursorInSelectedImageMention,
  stripImageMentionMarkers,
} from '../lib/promptImageMentions'
import { normalizeImageSize } from '../lib/size'
import { createMaskPreviewDataUrl } from '../lib/canvasImage'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import { getSafeBoundingClientRect } from '../lib/domRect'
import { getFilteredTasks, getSelectionToggleTaskIds } from '../lib/taskSelection'
import { useHintTooltip } from '../hooks/useHintTooltip'
import SizePickerModal from './SizePickerModal'
import ViewportTooltip from './ViewportTooltip'
import { CloseIcon, ImportIcon } from './icons'
import { SelectionToolbar } from './input/SelectionToolbar'
import { InputParameterPanel } from './input/InputParameterPanel'
import { useSelectionDownload } from './input/useSelectionDownload'
import { InputSubmitControls } from './input/InputSubmitControls'
import { normalizeCompressionInput, normalizeCountInput } from './input/inputBarParams'
import {
  getContentEditableCursor,
  getContentEditablePlainText,
  getContentEditableSelection,
  getMentionTagHtml,
  setContentEditableCursor,
  setContentEditableSelection,
  syncMentionTagSelection,
} from '../lib/contentEditableMentions'

/** 通用悬浮气泡提示 */
function ButtonTooltip({ visible, text }: { visible: boolean; text: ReactNode }) {
  if (!visible) return null

  return (
    <ViewportTooltip visible className="z-10 whitespace-nowrap">
      {text}
    </ViewportTooltip>
  )
}

/** API 支持的最大参考图数量 */
const DESKTOP_DOCK_MIN_WIDTH = 1024
const DESKTOP_DOCK_BOTTOM_CLEARANCE = 32
const AT_IMAGE_MENU_WIDTH = 256
const AT_IMAGE_MENU_MAX_HEIGHT = 256
const AT_IMAGE_MENU_MIN_HEIGHT = 96
const AT_IMAGE_MENU_GAP = 8
const AT_IMAGE_MENU_VIEWPORT_PADDING = 8
const AT_IMAGE_MENU_DESKTOP_TOP_CLEARANCE = 68

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return isMobile
}

type AtImageOption = { type: 'input'; key: string; label: string; imageId: string; dataUrl: string; imageIndex: number }

type AtImageMenuAnchor = {
  left: number
  top: number
  bottom: number
}

function AtImageOptionThumb({ option }: { option: AtImageOption }) {
  return (
    <span className="h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-gray-200/70 bg-gray-100 dark:border-white/[0.08] dark:bg-white/[0.04]">
      <img src={option.dataUrl} className="h-full w-full object-cover" alt="" />
    </span>
  )
}

export default function InputBar() {
  const prompt = useStore((s) => s.prompt)
  const setPrompt = useStore((s) => s.setPrompt)
  const inputImages = useStore((s) => s.inputImages)
  const addInputImage = useStore((s) => s.addInputImage)
  const replaceInputImage = useStore((s) => s.replaceInputImage)
  const removeInputImage = useStore((s) => s.removeInputImage)
  const clearInputImages = useStore((s) => s.clearInputImages)
  const params = useStore((s) => s.params)
  const setParams = useStore((s) => s.setParams)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const reusedTaskApiProfileId = useStore((s) => s.reusedTaskApiProfileId)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const showToast = useStore((s) => s.showToast)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const selectedTaskIds = useStore((s) => s.selectedTaskIds)
  const setSelectedTaskIds = useStore((s) => s.setSelectedTaskIds)
  const clearSelection = useStore((s) => s.clearSelection)
  const tasks = useStore((s) => s.tasks)
  const filterStatus = useStore((s) => s.filterStatus)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const searchQuery = useStore((s) => s.searchQuery)
  const filterProductTitle = useStore((s) => s.filterProductTitle)
  const filterWorkflow = useStore((s) => s.filterWorkflow)
  const filterAspect = useStore((s) => s.filterAspect)

  const filteredTasks = useMemo(
    () =>
      getFilteredTasks(tasks, {
        searchQuery,
        filterStatus,
        filterFavorite,
        filterProductTitle,
        filterWorkflow,
        filterAspect,
      }),
    [tasks, searchQuery, filterStatus, filterFavorite, filterProductTitle, filterWorkflow, filterAspect],
  )

  const handleSelectAllToggle = useCallback(() => {
    const nextSelectedTaskIds = getSelectionToggleTaskIds(selectedTaskIds, filteredTasks)
    if (nextSelectedTaskIds == null) {
      clearSelection()
    } else {
      setSelectedTaskIds(nextSelectedTaskIds)
    }
  }, [selectedTaskIds.length, filteredTasks, clearSelection, setSelectedTaskIds])

  const handleToggleFavorite = useCallback(() => {
    const selectedTasks = tasks.filter((t) => selectedTaskIds.includes(t.id))
    const allFavorite = selectedTasks.length > 0 && selectedTasks.every((t) => t.isFavorite)
    const newFavoriteState = !allFavorite
    setConfirmDialog({
      title: newFavoriteState ? '批量收藏' : '批量取消收藏',
      message: newFavoriteState
        ? `确定要收藏选中的 ${selectedTaskIds.length} 条记录吗？`
        : `确定要取消收藏选中的 ${selectedTaskIds.length} 条记录吗？`,
      confirmText: newFavoriteState ? '确认收藏' : '确认取消',
      action: () => {
        selectedTaskIds.forEach((id) => {
          updateTaskInStore(id, { isFavorite: newFavoriteState })
        })
        clearSelection()
      },
    })
  }, [tasks, selectedTaskIds, clearSelection, setConfirmDialog])

  const handleDeleteSelected = useCallback(() => {
    setConfirmDialog({
      title: '批量删除',
      message: `确定要删除选中的 ${selectedTaskIds.length} 条记录吗？`,
      action: () => {
        removeMultipleTasks(selectedTaskIds)
      },
    })
  }, [selectedTaskIds, setConfirmDialog])

  const handleDownloadSelected = useSelectionDownload({ tasks, selectedTaskIds, showToast, clearSelection })

  const maskDraft = useStore((s) => s.maskDraft)
  const setMaskEditorImageId = useStore((s) => s.setMaskEditorImageId)
  const moveInputImage = useStore((s) => s.moveInputImage)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const replaceFileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const imagesRef = useRef<HTMLDivElement>(null)
  const paramsPanelRef = useRef<HTMLDivElement>(null)
  const prevHeightRef = useRef(42)

  const [isDragging, setIsDragging] = useState(false)
  const [isSingleLine, setIsSingleLine] = useState(true)
  const [imageHintId, setImageHintId] = useState<string | null>(null)
  const [mobileCollapsed, setMobileCollapsed] = useState(false)
  const [showSizePicker, setShowSizePicker] = useState(false)
  const [maskPreviewUrl, setMaskPreviewUrl] = useState('')
  const [imageDragIndex, setImageDragIndex] = useState<number | null>(null)
  const [imageDragOverIndex, setImageDragOverIndex] = useState<number | null>(null)
  const [atImageMenuIndex, setAtImageMenuIndex] = useState(0)
  const [atImageMenuDismissed, setAtImageMenuDismissed] = useState(false)
  const [touchDragPreview, setTouchDragPreview] = useState<{ src: string; x: number; y: number } | null>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const dragTouchRef = useRef({ startY: 0, moved: false })
  const suppressHandleClickUntilRef = useRef(0)
  const imageDragIndexRef = useRef<number | null>(null)
  const imageTouchDragRef = useRef({ index: null as number | null, startX: 0, startY: 0, moved: false })
  const imageDragOverIndexRef = useRef<number | null>(null)
  const imageDragPreviewRef = useRef<HTMLElement | null>(null)
  const suppressImageClickRef = useRef(false)
  const replaceImageTargetRef = useRef<{ index: number; id: string } | null>(null)
  const isUserInputRef = useRef(false)
  const imageHintLockedRef = useRef(false)
  const imageHintReleaseRef = useRef<(() => void) | null>(null)
  const atImageMenuAnchorRef = useRef<AtImageMenuAnchor | null>(null)
  const [cursorPos, setCursorPos] = useState(0)
  const [menuLeft, setMenuLeft] = useState(0)
  const [atImageMenuStyle, setAtImageMenuStyle] = useState<CSSProperties>({
    left: AT_IMAGE_MENU_VIEWPORT_PADDING,
    bottom: AT_IMAGE_MENU_VIEWPORT_PADDING,
    maxHeight: AT_IMAGE_MENU_MAX_HEIGHT,
  })
  const maskConflictNoticeShownRef = useRef(false)

  const updateInputBarClearance = useCallback(() => {
    const bar = cardRef.current?.closest<HTMLElement>('[data-input-bar]')
    if (!bar) return

    if (window.innerWidth >= DESKTOP_DOCK_MIN_WIDTH) {
      document.documentElement.style.setProperty('--input-bar-clearance', `${DESKTOP_DOCK_BOTTOM_CLEARANCE}px`)
      return
    }

    const rect = bar.getBoundingClientRect()
    const clearance = Math.max(0, window.innerHeight - rect.top)
    document.documentElement.style.setProperty('--input-bar-clearance', `${Math.ceil(clearance)}px`)
  }, [])

  useLayoutEffect(() => {
    const bar = cardRef.current?.closest<HTMLElement>('[data-input-bar]')
    if (!bar) return

    const frame = window.requestAnimationFrame(updateInputBarClearance)
    const observer = new ResizeObserver(updateInputBarClearance)
    observer.observe(bar)

    const visualViewport = window.visualViewport
    window.addEventListener('resize', updateInputBarClearance)
    visualViewport?.addEventListener('resize', updateInputBarClearance)
    visualViewport?.addEventListener('scroll', updateInputBarClearance)

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', updateInputBarClearance)
      visualViewport?.removeEventListener('resize', updateInputBarClearance)
      visualViewport?.removeEventListener('scroll', updateInputBarClearance)
      document.documentElement.style.removeProperty('--input-bar-clearance')
    }
  }, [updateInputBarClearance])
  const imageHintTimerRef = useRef<number | null>(null)
  const [outputCompressionInput, setOutputCompressionInput] = useState(
    params.output_compression == null ? '' : String(params.output_compression),
  )
  const [nInput, setNInput] = useState(String(params.n))
  const [nInputFocused, setNInputFocused] = useState(false)
  const dragCounter = useRef(0)
  const isMobile = useIsMobile()

  const currentActiveProfile = useMemo(() => getActiveApiProfile(settings), [settings])
  const activeProfile = useMemo(
    () =>
      settings.reuseTaskApiProfileTemporarily && reusedTaskApiProfileId
        ? (settings.profiles.find((profile) => profile.id === reusedTaskApiProfileId) ?? currentActiveProfile)
        : currentActiveProfile,
    [currentActiveProfile, reusedTaskApiProfileId, settings],
  )
  const effectiveSettings = useMemo(
    () =>
      activeProfile.id === currentActiveProfile.id
        ? settings
        : normalizeSettings({ ...settings, activeProfileId: activeProfile.id }),
    [activeProfile.id, currentActiveProfile.id, settings],
  )
  const hasSubmitApiConfig = Boolean(activeProfile.apiKey)
  const missingRequiredImage = inputImages.length === 0
  const canSubmit = Boolean(prompt.trim() && hasSubmitApiConfig && !missingRequiredImage)
  const submitButtonAriaLabel = missingRequiredImage
    ? '请先上传图片'
    : hasSubmitApiConfig
      ? maskDraft
        ? '遮罩编辑'
        : '生成图像'
      : '请先配置 API'
  const submitTooltipText = !hasSubmitApiConfig
    ? '尚未完成 API 配置，请在右上角设置中进行'
    : missingRequiredImage
      ? '请先上传至少 1 张参考图，再生成图片'
      : ''
  const promptPlaceholder = '描述你想生成的图片，可输入 @ 来指定参考图...'
  const submitCurrentMode = useCallback(() => {
    void submitTask()
  }, [])
  const syncPromptFromContentEditable = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    isUserInputRef.current = true
    const range = getContentEditableSelection(el)
    setCursorPos(range.start)
    syncMentionTagSelection(el)
    setPrompt(getContentEditablePlainText(el))
  }, [setPrompt])
  const activeProvider = activeProfile.provider
  const isFalProvider = activeProvider === 'fal'
  const moderationDisabled = isFalProvider
  const compressionDisabled = params.output_format === 'png' || isFalProvider
  const outputImageLimit = getOutputImageLimitForSettings(effectiveSettings)
  const inputImageLimit = getInputImageLimitForSettings(effectiveSettings)
  const isFalTextToImage = isFalProvider && inputImages.length === 0
  const nLimitHintText = isFalProvider
    ? `fal.ai 最大请求数量为 ${outputImageLimit}`
    : `OpenAI 最大请求数量为 ${outputImageLimit}`
  const displaySize =
    isFalTextToImage && params.size === 'auto'
      ? DEFAULT_FAL_IMAGE_SIZE
      : normalizeImageSize(params.size) || DEFAULT_PARAMS.size

  const qualityOptions = isFalProvider
    ? [
        { label: 'low', value: 'low' },
        { label: 'medium', value: 'medium' },
        { label: 'high', value: 'high' },
      ]
    : [
        { label: 'auto', value: 'auto' },
        { label: 'low', value: 'low' },
        { label: 'medium', value: 'medium' },
        { label: 'high', value: 'high' },
      ]
  const atImageLimit = inputImages.length >= inputImageLimit
  const uploadImageTooltipText = atImageLimit ? `参考图数量已达上限（${inputImageLimit} 张），无法继续添加` : '上传图片'
  const compressionHint = useHintTooltip({ enabled: () => compressionDisabled })
  const moderationHint = useHintTooltip({ enabled: () => moderationDisabled })
  const sizeHint = useHintTooltip({ enabled: () => isFalTextToImage })
  const qualityHint = useHintTooltip({ enabled: () => settings.codexCli || isFalProvider })
  const nLimitHint = useHintTooltip({ autoHideMs: 2000 })
  const maskTargetImage = maskDraft ? (inputImages.find((img) => img.id === maskDraft.targetImageId) ?? null) : null
  const referenceImages = maskTargetImage ? inputImages.filter((img) => img.id !== maskTargetImage.id) : inputImages
  const cursorPosition = cursorPos
  const visiblePrompt = stripImageMentionMarkers(prompt)
  const atImageSourceCount = inputImages.length
  const atImageQuery = isCursorInSelectedImageMention(prompt, cursorPosition)
    ? null
    : getAtImageQuery(visiblePrompt, cursorPosition, { length: atImageSourceCount })
  const atImageOptions = atImageQuery
    ? [
        ...inputImages
          .map(
            (img, index) =>
              ({
                type: 'input',
                key: `input:${img.id}:${index}`,
                label: getImageMentionLabel(index),
                imageId: img.id,
                dataUrl: img.dataUrl,
                imageIndex: index,
              }) satisfies AtImageOption,
          )
          .filter((option) => imageMentionMatches(atImageQuery.query, option.imageIndex)),
      ]
    : []
  const showAtImageMenu = !atImageMenuDismissed && atImageOptions.length > 0

  const updateAtImageMenuPosition = useCallback(
    (anchorLeft = menuLeft, anchor = atImageMenuAnchorRef.current) => {
      const el = textareaRef.current
      if (!el) return

      const rect = el.getBoundingClientRect()
      const anchorRect = anchor ?? {
        left: rect.left + anchorLeft,
        top: rect.top,
        bottom: rect.bottom,
      }
      const visualViewport = window.visualViewport
      const viewportLeft = visualViewport?.offsetLeft ?? 0
      const viewportTop = visualViewport?.offsetTop ?? 0
      const viewportWidth = visualViewport?.width ?? window.innerWidth
      const viewportHeight = visualViewport?.height ?? window.innerHeight
      const minLeft = viewportLeft + AT_IMAGE_MENU_VIEWPORT_PADDING
      const maxLeft = Math.max(
        minLeft,
        viewportLeft + viewportWidth - AT_IMAGE_MENU_VIEWPORT_PADDING - AT_IMAGE_MENU_WIDTH,
      )
      const left = Math.min(Math.max(anchorRect.left, minLeft), maxLeft)
      const topBoundary =
        viewportTop + (window.innerWidth >= 640 ? AT_IMAGE_MENU_DESKTOP_TOP_CLEARANCE : AT_IMAGE_MENU_VIEWPORT_PADDING)
      const bottomBoundary = viewportTop + viewportHeight - AT_IMAGE_MENU_VIEWPORT_PADDING
      const spaceAbove = Math.max(0, anchorRect.top - AT_IMAGE_MENU_GAP - topBoundary)
      const spaceBelow = Math.max(0, bottomBoundary - anchorRect.bottom - AT_IMAGE_MENU_GAP)
      const openBelow = spaceBelow >= AT_IMAGE_MENU_MIN_HEIGHT || spaceBelow >= spaceAbove
      const availableHeight = openBelow ? spaceBelow : spaceAbove
      const maxHeight = Math.max(
        AT_IMAGE_MENU_MIN_HEIGHT,
        Math.min(AT_IMAGE_MENU_MAX_HEIGHT, availableHeight || Math.max(spaceAbove, spaceBelow)),
      )

      setAtImageMenuStyle(
        openBelow
          ? {
              left,
              top: Math.max(topBoundary, Math.min(anchorRect.bottom + AT_IMAGE_MENU_GAP, bottomBoundary - maxHeight)),
              maxHeight,
            }
          : {
              left,
              bottom: Math.max(AT_IMAGE_MENU_VIEWPORT_PADDING, window.innerHeight - anchorRect.top + AT_IMAGE_MENU_GAP),
              maxHeight,
            },
      )
    },
    [menuLeft],
  )

  useLayoutEffect(() => {
    if (!showAtImageMenu) return

    const update = () => updateAtImageMenuPosition()
    update()
    const frame = window.requestAnimationFrame(update)
    const visualViewport = window.visualViewport
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    visualViewport?.addEventListener('resize', update)
    visualViewport?.addEventListener('scroll', update)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      visualViewport?.removeEventListener('resize', update)
      visualViewport?.removeEventListener('scroll', update)
    }
  }, [showAtImageMenu, atImageOptions.length, updateAtImageMenuPosition])

  const selectAtImageOption = useCallback(
    (option: AtImageOption) => {
      const el = textareaRef.current
      const cursor = el ? getContentEditableCursor(el) : prompt.length
      const query = getAtImageQuery(stripImageMentionMarkers(prompt), cursor, { length: atImageSourceCount })
      setAtImageMenuDismissed(true)
      setAtImageMenuIndex(0)
      if (!query) return

      const mentionText = getImageMentionLabel(option.imageIndex)
      if (el) {
        el.focus()
        setContentEditableSelection(el, query.start, cursor)
        if (document.execCommand('insertHTML', false, getMentionTagHtml(mentionText))) {
          syncPromptFromContentEditable()
          return
        }
      }

      const next = insertImageMentionAtVisibleRange(prompt, query.start, cursor, option.imageIndex)
      isUserInputRef.current = false
      setPrompt(next.prompt)
      window.setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus()
          setContentEditableCursor(textareaRef.current, next.cursor)
        }
      }, 0)
    },
    [atImageSourceCount, prompt, setPrompt, syncPromptFromContentEditable],
  )

  const insertPromptTextAtSelection = useCallback(
    (text: string) => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        if (document.execCommand('insertText', false, text)) {
          syncPromptFromContentEditable()
          return
        }
      }

      const selection = el ? getContentEditableSelection(el) : { start: prompt.length, end: prompt.length }
      const promptStart = getPromptIndexFromVisibleIndex(prompt, selection.start)
      const promptEnd = getPromptIndexFromVisibleIndex(prompt, selection.end)
      const nextPrompt = `${prompt.slice(0, promptStart)}${text}${prompt.slice(promptEnd)}`
      const nextCursor = selection.start + text.length
      isUserInputRef.current = false
      setPrompt(nextPrompt)
      window.setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus()
          setContentEditableCursor(textareaRef.current, nextCursor)
        }
      }, 0)
    },
    [prompt, setPrompt, syncPromptFromContentEditable],
  )

  const handleClearPrompt = useCallback(() => {
    isUserInputRef.current = false
    setPrompt('')
    if (textareaRef.current) {
      textareaRef.current.innerHTML = ''
      textareaRef.current.focus()
    }
  }, [setPrompt])

  useEffect(() => {
    setOutputCompressionInput(params.output_compression == null ? '' : String(params.output_compression))
  }, [params.output_compression])

  useEffect(() => {
    setNInput(String(params.n))
  }, [params.n])

  useEffect(() => {
    const normalizedParams = normalizeParamsForSettings(params, effectiveSettings, {
      hasInputImages: inputImages.length > 0,
    })
    const patch = getChangedParams(params, normalizedParams)
    if (Object.keys(patch).length) {
      setParams(patch)
    }
  }, [inputImages.length, params, effectiveSettings, setParams])

  useEffect(
    () => () => {
      if (imageHintTimerRef.current != null) {
        window.clearTimeout(imageHintTimerRef.current)
      }
      imageHintReleaseRef.current?.()
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    if (!maskDraft || !maskTargetImage) {
      setMaskPreviewUrl('')
      return
    }

    createMaskPreviewDataUrl(maskTargetImage.dataUrl, maskDraft.maskDataUrl)
      .then((url) => {
        if (!cancelled) setMaskPreviewUrl(url)
      })
      .catch(() => {
        if (!cancelled) setMaskPreviewUrl('')
      })

    return () => {
      cancelled = true
    }
  }, [maskDraft, maskTargetImage?.id, maskTargetImage?.dataUrl])

  const commitOutputCompression = useCallback(() => {
    const normalized = normalizeCompressionInput(outputCompressionInput, params.output_compression)
    setOutputCompressionInput(normalized.input)
    if (normalized.value !== undefined) setParams({ output_compression: normalized.value })
  }, [outputCompressionInput, params.output_compression, setParams])

  const commitN = useCallback(() => {
    nLimitHint.hide()
    const normalized = normalizeCountInput(nInput, params.n, outputImageLimit)
    setNInput(normalized.input)
    setParams({ n: normalized.value })
  }, [nInput, nLimitHint, outputImageLimit, params.n, setParams])

  const showNLimitHint = useCallback(() => {
    nLimitHint.show()
  }, [nLimitHint])

  const hideNLimitHint = useCallback(() => {
    nLimitHint.hide()
  }, [nLimitHint])

  const handleNInputChange = useCallback(
    (value: string) => {
      setNInput(value)
      const nextValue = Number(value)
      if (!Number.isNaN(nextValue) && nextValue > outputImageLimit) {
        showNLimitHint()
      } else {
        hideNLimitHint()
      }
    },
    [hideNLimitHint, outputImageLimit, showNLimitHint],
  )

  const handleNLimitIncreaseAttempt = useCallback(
    (preventDefault: () => void) => {
      const currentValue = Number(nInput)
      const effectiveValue = Number.isNaN(currentValue) ? params.n : currentValue
      if (!nInputFocused || effectiveValue < outputImageLimit) return

      preventDefault()
      showNLimitHint()
    },
    [nInput, nInputFocused, outputImageLimit, params.n, showNLimitHint],
  )

  const clearImageHintTimer = () => {
    if (imageHintTimerRef.current != null) {
      window.clearTimeout(imageHintTimerRef.current)
      imageHintTimerRef.current = null
    }
  }

  const showImageHint = (id: string) => setImageHintId(id)

  const hideImageHint = () => {
    if (imageHintLockedRef.current) return
    setImageHintId(null)
    clearImageHintTimer()
  }

  const hideLockedImageHint = () => {
    imageHintLockedRef.current = false
    imageHintReleaseRef.current?.()
    imageHintReleaseRef.current = null
    setImageHintId(null)
    clearImageHintTimer()
  }

  const showImageHintUntilRelease = (id: string) => {
    if (imageHintLockedRef.current) {
      setImageHintId(id)
      return
    }
    imageHintLockedRef.current = true
    setImageHintId(id)
    const release = () => {
      window.removeEventListener('mouseup', release)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('dragend', release)
      if (imageHintReleaseRef.current === release) {
        imageHintReleaseRef.current = null
        imageHintLockedRef.current = false
        setImageHintId(null)
        clearImageHintTimer()
      }
    }
    imageHintReleaseRef.current = release
    window.addEventListener('mouseup', release)
    window.addEventListener('pointerup', release)
    window.addEventListener('dragend', release)
  }

  const handleFiles = async (files: FileList | File[]) => {
    try {
      const currentCount = useStore.getState().inputImages.length
      if (currentCount >= inputImageLimit) {
        useStore.getState().showToast(`参考图数量已达上限（${inputImageLimit} 张），无法继续添加`, 'error')
        return
      }

      const remaining = inputImageLimit - currentCount
      const accepted = Array.from(files).filter((f) => f.type.startsWith('image/'))
      const toAdd = accepted.slice(0, remaining)
      const discarded = accepted.length - toAdd.length

      for (const file of toAdd) {
        await addImageFromFile(file)
      }

      if (discarded > 0) {
        useStore.getState().showToast(`已达上限 ${inputImageLimit} 张，${discarded} 张图片被丢弃`, 'error')
      }
    } catch (err) {
      useStore.getState().showToast(`图片添加失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  const handleFilesRef = useRef(handleFiles)
  handleFilesRef.current = handleFiles

  const openReplaceReferenceFilePicker = useCallback((idx: number, imageId: string) => {
    replaceImageTargetRef.current = { index: idx, id: imageId }
    replaceFileInputRef.current?.click()
  }, [])

  const commitReferenceEditChoice = useCallback(
    (choice: 'replace-reference' | 'add-mask', remember?: boolean) => {
      if (remember) setSettings({ referenceImageEditAction: choice })
    },
    [setSettings],
  )

  const handleEditReferenceImage = useCallback(
    (img: (typeof inputImages)[number], idx: number, isMaskTarget: boolean) => {
      if (isMaskTarget) {
        setMaskEditorImageId(img.id)
        return
      }

      if (settings.referenceImageEditAction === 'replace-reference') {
        openReplaceReferenceFilePicker(idx, img.id)
        return
      }

      if (settings.referenceImageEditAction === 'add-mask') {
        setMaskEditorImageId(img.id)
        return
      }

      setConfirmDialog({
        title: '编辑参考图',
        message: '请选择这次要执行的操作。若不勾选下方的选项，则每次都询问；勾选后可在 **设置-习惯配置** 修改选择。',
        checkbox: { label: '以后默认执行此选择' },
        buttons: [
          {
            label: '替换参考图',
            tone: 'secondary',
            action: (remember) => {
              commitReferenceEditChoice('replace-reference', remember)
              openReplaceReferenceFilePicker(idx, img.id)
            },
          },
          {
            label: '添加遮罩',
            tone: 'primary',
            action: (remember) => {
              commitReferenceEditChoice('add-mask', remember)
              setMaskEditorImageId(img.id)
            },
          },
        ],
      })
    },
    [
      commitReferenceEditChoice,
      openReplaceReferenceFilePicker,
      setConfirmDialog,
      setMaskEditorImageId,
      settings.referenceImageEditAction,
    ],
  )

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await handleFilesRef.current(e.target.files || [])
    e.target.value = ''
  }

  const handleReplaceFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    const target = replaceImageTargetRef.current
    replaceImageTargetRef.current = null
    if (!file || !target) return

    try {
      const image = await createInputImageFromFile(file)
      if (!image) {
        showToast('请选择有效图片', 'error')
        return
      }

      const currentImages = useStore.getState().inputImages
      const currentIdx = currentImages.findIndex((item) => item.id === target.id)
      const targetIdx = currentIdx >= 0 ? currentIdx : target.index
      const previous = currentImages[targetIdx]
      if (!previous) {
        void deleteImageIfUnreferenced(image.id)
        showToast('原参考图已不存在', 'error')
        return
      }
      if (previous.id === image.id) {
        showToast('参考图未变化', 'info')
        return
      }
      if (currentImages.some((item, itemIdx) => itemIdx !== targetIdx && item.id === image.id)) {
        showToast('这张图片已在参考图中', 'info')
        return
      }

      replaceInputImage(targetIdx, image)
      showToast('参考图已替换', 'success')
    } catch (err) {
      showToast(`参考图替换失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (showAtImageMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setAtImageMenuIndex((idx) => (idx + 1) % atImageOptions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setAtImageMenuIndex((idx) => (idx - 1 + atImageOptions.length) % atImageOptions.length)
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault()
        selectAtImageOption(atImageOptions[atImageMenuIndex] ?? atImageOptions[0])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setAtImageMenuIndex(0)
        textareaRef.current?.blur()
        return
      }
    }

    // 阻止 contentEditable 默认换行
    if (e.key === 'Enter') {
      e.preventDefault()

      const isModifier = e.ctrlKey || e.metaKey

      if (settings.enterSubmit) {
        if (e.shiftKey) {
          insertPromptTextAtSelection('\n')
        } else if (!isModifier) {
          if (canSubmit) submitCurrentMode()
        }
      } else {
        if (isModifier) {
          if (canSubmit) submitCurrentMode()
        } else {
          insertPromptTextAtSelection('\n')
        }
      }
      return
    }
  }

  const handlePromptPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    if (Array.from(e.clipboardData.items).some((item) => item.type.startsWith('image/'))) return

    e.preventDefault()
    insertPromptTextAtSelection(text.replace(/\r\n?/g, '\n'))
  }

  const handlePromptCopy = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const el = textareaRef.current
    if (!el) return

    const selection = getContentEditableSelection(el)
    if (selection.start === selection.end) return

    const promptStart = getPromptIndexFromVisibleIndex(prompt, selection.start)
    const promptEnd = getPromptIndexFromVisibleIndex(prompt, selection.end)
    const text = stripImageMentionMarkers(prompt.slice(promptStart, promptEnd))
    const copyText = /^\s*@图\d+\s*$/.test(text) ? text.trim() : text

    e.preventDefault()
    e.clipboardData.setData('text/plain', copyText)
  }

  // 粘贴图片
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      const imageFiles: File[] = []
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) imageFiles.push(file)
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault()
        handleFilesRef.current(imageFiles)
      }
    }
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [])

  // 拖拽图片 - 监听整个页面
  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current++
      if (e.dataTransfer?.types.includes('Files')) {
        setIsDragging(true)
      }
    }

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current--
      if (dragCounter.current === 0) {
        setIsDragging(false)
      }
    }

    const handleDrop = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current = 0
      setIsDragging(false)
      const files = e.dataTransfer?.files
      if (files && files.length > 0) {
        handleFilesRef.current(files)
        return
      }

      const transferredText = e.dataTransfer?.getData('text/plain')

      const imageIds = transferredText?.startsWith('agent-images:')
        ? transferredText.slice('agent-images:'.length).split(',')
        : transferredText?.startsWith('agent-image:')
          ? [transferredText.slice('agent-image:'.length)]
          : []

      if (imageIds.length > 0) {
        Promise.all(
          imageIds.map(async (imageId) => {
            const dataUrl = await ensureImageCached(imageId)
            if (!dataUrl) {
              showToast('部分图片已不存在', 'error')
              return
            }
            addInputImage({ id: imageId, dataUrl })
          }),
        )
          .then(() => {
            showToast('已上传图片', 'success')
          })
          .catch((err) => showToast(`上传图片失败：${err instanceof Error ? err.message : String(err)}`, 'error'))
      }
    }

    document.addEventListener('dragenter', handleDragEnter)
    document.addEventListener('dragover', handleDragOver)
    document.addEventListener('dragleave', handleDragLeave)
    document.addEventListener('drop', handleDrop)

    return () => {
      document.removeEventListener('dragenter', handleDragEnter)
      document.removeEventListener('dragover', handleDragOver)
      document.removeEventListener('dragleave', handleDragLeave)
      document.removeEventListener('drop', handleDrop)
    }
  }, [addInputImage, showToast])

  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return

    const isDesktopDock = window.innerWidth >= DESKTOP_DOCK_MIN_WIDTH

    const imagesHeight = imagesRef.current?.offsetHeight ?? 0
    const paramsHeight = paramsPanelRef.current?.offsetHeight ?? 0

    // 右侧 Dock：文本框吃掉中间剩余空间，参数和按钮贴到底部。
    // 底部输入栏：沿用内容自适应，最高不超过页面 40%。
    const maxH = isDesktopDock
      ? Math.max((cardRef.current?.clientHeight ?? window.innerHeight - 120) - imagesHeight - paramsHeight - 44, 72)
      : Math.max(window.innerHeight * 0.4 - imagesHeight - 140, 80)

    // 1. 关闭过渡动画，设高度为 0 以获取真实的文本内容高度
    el.style.transition = 'none'
    el.style.height = '0'
    el.style.overflowY = 'hidden'
    const scrollH = el.scrollHeight

    const placeholderEl = el.parentElement?.querySelector('.prompt-placeholder')
    const placeholderH = placeholderEl ? placeholderEl.scrollHeight : 0
    const minH = Math.max(42, placeholderH)

    const desired = Math.max(scrollH, minH)
    const targetH = isDesktopDock ? maxH : desired > maxH ? maxH : desired

    // 判断是否只有一行
    setIsSingleLine(desired <= minH)

    // 2. 将高度设回上一次的实际高度，强制重绘，准备开始动画
    el.style.height = prevHeightRef.current + 'px'
    void el.offsetHeight

    // 3. 恢复平滑过渡，并设置目标高度
    el.style.transition = 'height 150ms ease, border-color 200ms, box-shadow 200ms'
    el.style.height = targetH + 'px'
    el.style.overflowY = desired > maxH ? 'auto' : 'hidden'

    prevHeightRef.current = targetH
  }, [])

  // 将 prompt 同步渲染到 contentEditable（含胶囊 tag）
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    // 用户正在输入时不重新渲染 DOM，避免光标跳动
    if (isUserInputRef.current) {
      isUserInputRef.current = false
      return
    }
    const parts = getPromptMentionParts(prompt, inputImages)
    const html = prompt
      ? parts
          .map((part) =>
            part.type === 'mention'
              ? `<span contenteditable="false" class="mention-tag" data-mention-text="${part.mentionText ?? getSelectedImageMentionLabel(part.imageIndex ?? 0)}">${part.text}</span>`
              : part.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
          )
          .join('')
      : ''
    if (el.innerHTML !== html) {
      el.innerHTML = html
    }
  }, [prompt, inputImages])

  useEffect(() => {
    adjustTextareaHeight()
  }, [prompt, inputImages, adjustTextareaHeight])

  // 监听 selectionchange 以在光标移动时更新位置（contentEditable 的 onSelect 不可靠）
  useEffect(() => {
    const handleSelectionChange = () => {
      const el = textareaRef.current
      if (!el) return
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return

      const domRange = sel.getRangeAt(0)
      try {
        if (!domRange.intersectsNode(el)) {
          syncMentionTagSelection(el)
          return
        }
      } catch {
        return
      }

      const range = getContentEditableSelection(el)
      setCursorPos(range.start)
      syncMentionTagSelection(el)

      const rangeRect = domRange.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      const hasRangeRect = rangeRect.width !== 0 || rangeRect.height !== 0
      const nextLeft = rangeRect.left - elRect.left
      const maxLeft = Math.max(0, elRect.width - AT_IMAGE_MENU_WIDTH)
      const clampedLeft = Math.min(Math.max(hasRangeRect ? nextLeft : menuLeft, 0), maxLeft)
      const nextAnchor = hasRangeRect ? { left: rangeRect.left, top: rangeRect.top, bottom: rangeRect.bottom } : null
      atImageMenuAnchorRef.current = nextAnchor
      setMenuLeft(clampedLeft)
      updateAtImageMenuPosition(clampedLeft, nextAnchor)
    }
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [updateAtImageMenuPosition])

  // 点击屏幕外部、空白处、卡片间隙等，使输入栏相关输入框失焦
  useEffect(() => {
    const handleGlobalMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return

      if (document.activeElement instanceof HTMLElement) {
        // 如果当前聚焦的元素属于输入栏（主输入框、数量或压缩率输入框等）
        if (document.activeElement.closest('[data-input-bar]')) {
          // 如果点击的区域不在输入栏内部
          if (!target.closest('[data-input-bar]')) {
            document.activeElement.blur()
          }
        }
      }
    }

    document.addEventListener('mousedown', handleGlobalMouseDown, true)
    return () => {
      document.removeEventListener('mousedown', handleGlobalMouseDown, true)
    }
  }, [])
  useEffect(() => {
    adjustTextareaHeight()
  }, [inputImages.length, Boolean(maskDraft), maskPreviewUrl, adjustTextareaHeight])

  useEffect(() => {
    window.addEventListener('resize', adjustTextareaHeight)
    return () => window.removeEventListener('resize', adjustTextareaHeight)
  }, [adjustTextareaHeight])

  useEffect(() => {
    const observer = new ResizeObserver(adjustTextareaHeight)
    if (cardRef.current) observer.observe(cardRef.current)
    if (imagesRef.current) observer.observe(imagesRef.current)
    if (paramsPanelRef.current) observer.observe(paramsPanelRef.current)
    return () => observer.disconnect()
  }, [adjustTextareaHeight])

  // 移动端拖动条手势
  useEffect(() => {
    const el = handleRef.current
    if (!el) return
    const onTouchStart = (e: TouchEvent) => {
      dragTouchRef.current = { startY: e.touches[0].clientY, moved: false }
    }
    const onTouchMove = (e: TouchEvent) => {
      const dy = e.touches[0].clientY - dragTouchRef.current.startY
      if (Math.abs(dy) > 10) dragTouchRef.current.moved = true
      if (dy > 30) setMobileCollapsed(true)
      if (dy < -30) setMobileCollapsed(false)
    }
    const onTouchEnd = () => {
      if (dragTouchRef.current.moved) {
        suppressHandleClickUntilRef.current = Date.now() + 500
      }
    }
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('touchend', onTouchEnd)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  const getTouchDropIndex = (touch: React.Touch) => {
    const target = document
      .elementFromPoint(touch.clientX, touch.clientY)
      ?.closest<HTMLElement>('[data-input-image-index]')
    if (!target) return null
    const idx = Number(target.dataset.inputImageIndex)
    if (!Number.isInteger(idx)) return null
    const rect = getSafeBoundingClientRect(target)
    if (!rect) return null
    return touch.clientX < rect.left + rect.width / 2 ? idx : idx + 1
  }

  const normalizeImageDropIndex = (idx: number) => {
    const minIdx = maskTargetImage ? 1 : 0
    return Math.max(minIdx, Math.min(inputImages.length, idx))
  }

  const isBeforeMaskDropArea = (clientX: number) => {
    if (!maskTargetImage) return false
    const maskEl = document.querySelector<HTMLElement>('[data-input-image-index="0"]')
    if (!maskEl) return false
    const rect = getSafeBoundingClientRect(maskEl)
    if (!rect) return false
    return clientX < rect.left + rect.width / 2
  }

  const resetImageDrag = () => {
    setImageDragIndex(null)
    setImageDragOverIndex(null)
    imageDragIndexRef.current = null
    imageDragOverIndexRef.current = null
    imageTouchDragRef.current = { index: null, startX: 0, startY: 0, moved: false }
    setTouchDragPreview(null)
    imageDragPreviewRef.current?.remove()
    imageDragPreviewRef.current = null
    hideImageHint()
  }

  useEffect(() => {
    if (!touchDragPreview) return
    const previousOverflow = document.body.style.overflow
    const previousOverscroll = document.body.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscroll
    }
  }, [touchDragPreview])

  const getDataTransferDragIndex = (e: React.DragEvent) => {
    const value = e.dataTransfer.getData('text/plain')
    const idx = Number(value)
    return Number.isInteger(idx) ? idx : null
  }

  const setImageDragTarget = (idx: number | null, clientX?: number) => {
    const fromIdx = imageDragIndexRef.current
    if (fromIdx !== null && maskTargetImage && (idx === 0 || (clientX != null && isBeforeMaskDropArea(clientX)))) {
      showImageHint(maskTargetImage.id)
      imageDragOverIndexRef.current = null
      setImageDragOverIndex(null)
      return
    }

    if (fromIdx !== null) hideImageHint()
    const normalizedIdx = idx == null ? null : normalizeImageDropIndex(idx)
    const isNoopTarget =
      fromIdx !== null && normalizedIdx !== null && (normalizedIdx === fromIdx || normalizedIdx === fromIdx + 1)
    const nextIdx = isNoopTarget ? null : normalizedIdx
    imageDragOverIndexRef.current = nextIdx
    setImageDragOverIndex(nextIdx)
  }

  const renderImageThumb = (img: (typeof inputImages)[number], idx: number) => {
    const isMaskTarget = maskDraft?.targetImageId === img.id
    const canEdit = !maskTargetImage || isMaskTarget
    const imageHintText = isMaskTarget ? '遮罩图必须为第一张图' : ''
    const displaySrc = isMaskTarget && maskPreviewUrl ? maskPreviewUrl : img.dataUrl
    const isImageDragging = imageDragIndex === idx
    const isLast = idx === inputImages.length - 1
    const showDropBefore = imageDragOverIndex === idx && imageDragIndex !== idx
    const showDropAfter = imageDragOverIndex === inputImages.length && isLast && imageDragIndex !== idx

    const handleDragStart = (e: React.DragEvent) => {
      if (isMaskTarget) {
        showImageHintUntilRelease(img.id)
        e.preventDefault()
        return
      }
      hideImageHint()
      imageDragIndexRef.current = idx
      setImageDragIndex(idx)
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(idx))
      const preview = document.createElement('div')
      preview.style.cssText =
        'position:fixed;left:-1000px;top:-1000px;width:52px;height:52px;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.25);'
      const previewImg = document.createElement('img')
      previewImg.src = displaySrc
      previewImg.style.cssText = 'width:52px;height:52px;object-fit:cover;display:block;'
      preview.appendChild(previewImg)
      document.body.appendChild(preview)
      imageDragPreviewRef.current = preview
      e.dataTransfer.setDragImage(preview, 26, 26)
    }

    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const fromIdx = imageDragIndexRef.current
      if (fromIdx === null || fromIdx === idx) return
      const rect = getSafeBoundingClientRect(e.currentTarget)
      if (!rect) return
      setImageDragTarget(e.clientX < rect.left + rect.width / 2 ? idx : idx + 1, e.clientX)
    }

    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault()
      const fromIdx = imageDragIndexRef.current ?? getDataTransferDragIndex(e)
      const toIdx = imageDragOverIndexRef.current
      if (fromIdx !== null && toIdx !== null) {
        moveInputImage(fromIdx, toIdx)
      }
      resetImageDrag()
    }

    const handleTouchStart = (e: React.TouchEvent) => {
      if (isMaskTarget) {
        const touch = e.touches[0]
        imageTouchDragRef.current = { index: idx, startX: touch.clientX, startY: touch.clientY, moved: false }
        return
      }
      const touch = e.touches[0]
      imageDragIndexRef.current = idx
      imageTouchDragRef.current = { index: idx, startX: touch.clientX, startY: touch.clientY, moved: false }
      setTouchDragPreview(null)
    }

    const handleTouchMove = (e: React.TouchEvent) => {
      const touch = e.touches[0]
      const touchDrag = imageTouchDragRef.current
      if (touchDrag.index === null) return

      if (isMaskTarget) {
        if (Math.abs(touch.clientX - touchDrag.startX) > 6 || Math.abs(touch.clientY - touchDrag.startY) > 6) {
          e.preventDefault()
          showImageHintUntilRelease(img.id)
        }
        return
      }

      touchDrag.moved = true
      clearImageHintTimer()
      setImageHintId(null)
      suppressImageClickRef.current = true
      e.preventDefault()
      setImageDragIndex(touchDrag.index)
      setTouchDragPreview({ src: displaySrc, x: touch.clientX, y: touch.clientY })
      const dropIndex = getTouchDropIndex(touch)
      setImageDragTarget(dropIndex, touch.clientX)
    }

    const handleTouchEnd = (e: React.TouchEvent) => {
      const touchDrag = imageTouchDragRef.current
      clearImageHintTimer()
      if (touchDrag.index !== null && imageDragOverIndexRef.current !== null) {
        e.preventDefault()
        moveInputImage(touchDrag.index, imageDragOverIndexRef.current)
        window.setTimeout(() => {
          suppressImageClickRef.current = false
        }, 0)
      }
      resetImageDrag()
      hideLockedImageHint()
    }

    const handleTouchCancel = () => {
      suppressImageClickRef.current = false
      hideLockedImageHint()
      resetImageDrag()
    }

    return (
      <div
        key={img.id}
        data-input-image-index={idx}
        className={`relative group inline-block h-[52px] w-[52px] shrink-0 self-start transition-opacity ${isImageDragging ? 'opacity-40' : ''}`}
        style={{ touchAction: isMaskTarget ? 'auto' : 'none' }}
        draggable={!isMobile}
        onMouseLeave={hideImageHint}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragEnd={resetImageDrag}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onContextMenu={(e) => {
          e.preventDefault()
          const el = textareaRef.current
          const cursor = el ? getContentEditableCursor(el) : prompt.length
          if (el) {
            el.focus()
            setContentEditableCursor(el, cursor)
            if (document.execCommand('insertHTML', false, getMentionTagHtml(getImageMentionLabel(idx)))) {
              syncPromptFromContentEditable()
              return
            }
          }
          const next = insertImageMentionAtVisibleRange(prompt, cursor, cursor, idx)
          isUserInputRef.current = false
          setPrompt(next.prompt)
          window.setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.focus()
              setContentEditableCursor(textareaRef.current, next.cursor)
            }
          }, 0)
        }}
      >
        <ButtonTooltip
          visible={imageHintId === img.id && Boolean(imageHintText) && (!isMobile || isMaskTarget)}
          text={imageHintText}
        />
        {showDropBefore && (
          <div className="absolute -left-[5px] top-0 bottom-0 w-[2px] bg-blue-500 rounded-full z-40 shadow-sm pointer-events-none" />
        )}
        {showDropAfter && (
          <div className="absolute -right-[5px] top-0 bottom-0 w-[2px] bg-blue-500 rounded-full z-40 shadow-sm pointer-events-none" />
        )}
        <div
          className={`relative w-[52px] h-[52px] rounded-xl overflow-hidden shadow-sm cursor-grab active:cursor-grabbing select-none ${
            isMaskTarget ? 'border-2 border-blue-500' : 'border border-gray-200 dark:border-white/[0.08]'
          }`}
          onClick={() => {
            if (suppressImageClickRef.current) return
            if (isMaskTarget) {
              setMaskEditorImageId(img.id)
              return
            }
            if (maskTargetImage && !maskConflictNoticeShownRef.current) {
              maskConflictNoticeShownRef.current = true
              showToast('只能有一张遮罩图', 'info')
            }
            setLightboxImageId(
              img.id,
              inputImages.map((i) => i.id),
            )
          }}
        >
          {displaySrc && (
            <div className="h-full w-full overflow-hidden rounded-xl">
              <img
                src={displaySrc}
                className="w-full h-full object-cover hover:opacity-90 transition-opacity pointer-events-none"
                alt=""
              />
            </div>
          )}
          {isMaskTarget && (
            <span className="absolute left-1 top-1 rounded bg-blue-500/90 px-1.5 py-0.5 text-[8px] leading-none text-white font-bold tracking-wider backdrop-blur-sm z-10 pointer-events-none">
              MASK
            </span>
          )}
          <span className="absolute bottom-1 left-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/55 text-[9px] font-semibold text-white backdrop-blur-sm z-10 pointer-events-none">
            {idx + 1}
          </span>
          {canEdit && (
            <button
              className="absolute inset-0 w-full h-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer z-20 focus:outline-none border-none"
              onClick={(e) => {
                e.stopPropagation()
                handleEditReferenceImage(img, idx, isMaskTarget)
              }}
              title={isMaskTarget ? '编辑遮罩' : '编辑'}
            >
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                />
              </svg>
            </button>
          )}
        </div>
        {!isMaskTarget && (
          <span
            className="absolute right-0 top-0 flex h-5 w-5 translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-md transition-opacity hover:bg-red-600 group-hover:opacity-100 z-30"
            onClick={(e) => {
              e.stopPropagation()
              removeInputImage(idx)
            }}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </span>
        )}
      </div>
    )
  }

  const renderClearAllButton = () => (
    <button
      type="button"
      onClick={() =>
        setConfirmDialog({
          title: maskTargetImage ? '清空全部输入图' : '清空参考图',
          message: maskTargetImage
            ? `确定要清空遮罩主图、${referenceImages.length} 张参考图和当前遮罩吗？`
            : `确定要清空全部 ${inputImages.length} 张参考图吗？`,
          action: () => clearInputImages(),
        })
      }
      className="w-[52px] h-[52px] rounded-xl border border-dashed border-gray-300 dark:border-white/[0.08] flex flex-col items-center justify-center gap-0.5 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:border-red-300 hover:bg-red-50/50 dark:hover:bg-red-950/30 transition-all cursor-pointer flex-shrink-0"
      title={maskTargetImage ? '清空遮罩主图、参考图和遮罩' : '清空全部参考图'}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
        />
      </svg>
      <span className="text-[8px] leading-none">{maskTargetImage ? '清空全部' : '清空'}</span>
    </button>
  )

  const renderUploadReferenceButton = () => (
    <button
      type="button"
      onClick={() => {
        if (!atImageLimit) fileInputRef.current?.click()
      }}
      disabled={atImageLimit}
      className={`w-[52px] h-[52px] rounded-xl border border-dashed flex flex-col items-center justify-center gap-0.5 transition-all flex-shrink-0 ${
        atImageLimit
          ? 'cursor-not-allowed border-gray-200 bg-gray-50/60 text-gray-300 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-gray-600'
          : 'cursor-pointer border-blue-300 bg-blue-50/50 text-blue-500 hover:border-blue-400 hover:bg-blue-50 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/15'
      }`}
      title={uploadImageTooltipText}
      aria-label={uploadImageTooltipText}
    >
      <ImportIcon className="w-4 h-4" />
      <span className="text-[8px] leading-none">{atImageLimit ? '已满' : '上传'}</span>
    </button>
  )

  const renderImageThumbs = () => {
    return (
      <div ref={imagesRef} className="lg:max-h-44 lg:overflow-y-auto lg:overscroll-contain lg:pr-1 custom-scrollbar">
        <div className="grid grid-cols-[repeat(auto-fill,52px)] justify-between gap-x-2 gap-y-3 mb-3">
          {inputImages.map((img, idx) => renderImageThumb(img, idx))}
          {renderUploadReferenceButton()}
          {renderClearAllButton()}
        </div>
        {touchDragPreview?.src &&
          createPortal(
            <div
              className="fixed z-[140] h-[52px] w-[52px] overflow-hidden rounded-xl shadow-xl pointer-events-none opacity-90"
              style={{ left: touchDragPreview.x, top: touchDragPreview.y, transform: 'translate(-50%, -50%)' }}
            >
              <img src={touchDragPreview.src} className="h-full w-full object-cover" alt="" />
            </div>,
            document.body,
          )}
      </div>
    )
  }

  const renderParams = (cols: string) => (
    <InputParameterPanel
      cols={cols}
      params={params}
      codexCli={settings.codexCli}
      isFalProvider={isFalProvider}
      isFalTextToImage={isFalTextToImage}
      displaySize={displaySize}
      qualityOptions={qualityOptions}
      outputCompressionInput={outputCompressionInput}
      compressionDisabled={compressionDisabled}
      moderationDisabled={moderationDisabled}
      nInput={nInput}
      outputImageLimit={outputImageLimit}
      nLimitHintText={nLimitHintText}
      sizeHint={sizeHint}
      qualityHint={qualityHint}
      compressionHint={compressionHint}
      moderationHint={moderationHint}
      nLimitHint={nLimitHint}
      onOpenSizePicker={() => {
        dismissAllTooltips()
        setShowSizePicker(true)
      }}
      onParamsChange={setParams}
      onCompressionInputChange={setOutputCompressionInput}
      onCommitCompression={commitOutputCompression}
      onNInputChange={handleNInputChange}
      onNInputFocusChange={setNInputFocused}
      onCommitN={commitN}
      onNLimitIncreaseAttempt={handleNLimitIncreaseAttempt}
    />
  )

  return (
    <>
      {/* 全屏拖拽遮罩 */}
      {isDragging && (
        <div className="fixed inset-0 z-[100] bg-white/60 dark:bg-gray-900/60 backdrop-blur-md flex flex-col items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-4 p-8 rounded-3xl">
            <div
              className={`w-20 h-20 rounded-full border-2 border-dashed flex items-center justify-center ${
                atImageLimit
                  ? 'bg-red-50 dark:bg-red-500/10 border-red-300'
                  : 'bg-blue-50 dark:bg-blue-500/10 border-blue-400'
              }`}
            >
              {atImageLimit ? (
                <svg className="w-10 h-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                  />
                </svg>
              ) : (
                <svg className="w-10 h-10 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              )}
            </div>
            <div className="text-center">
              {atImageLimit ? (
                <>
                  <p className="text-lg font-semibold text-red-500">已达上限 {inputImageLimit} 张</p>
                  <p className="text-sm text-gray-400 mt-1">请先移除部分参考图后再添加</p>
                </>
              ) : (
                <>
                  <p className="text-lg font-semibold text-gray-700 dark:text-gray-200">释放以上传图片</p>
                  <p className="text-sm text-gray-400 mt-1">支持 JPG、PNG、WebP 等格式</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showSizePicker && (
        <SizePickerModal
          currentSize={isFalTextToImage && params.size === 'auto' ? DEFAULT_FAL_IMAGE_SIZE : params.size}
          onSelect={(size) => setParams({ size })}
          onClose={() => setShowSizePicker(false)}
          allowAuto={!isFalTextToImage}
        />
      )}

      <div
        data-input-bar
        className="home-input-dock pointer-events-none fixed bottom-4 left-1/2 z-30 w-full max-w-4xl -translate-x-1/2 px-3 transition-all duration-300 sm:bottom-6 sm:px-4 lg:bottom-6 lg:left-auto lg:top-20 lg:flex lg:max-w-none lg:translate-x-0 lg:flex-col lg:px-0"
      >
        {selectedTaskIds.length > 0 && (
          <SelectionToolbar
            selectedTaskIds={selectedTaskIds}
            filteredTaskCount={filteredTasks.length}
            tasks={tasks}
            onClear={clearSelection}
            onToggleAll={handleSelectAllToggle}
            onToggleFavorite={handleToggleFavorite}
            onDownload={handleDownloadSelected}
            onDelete={handleDeleteSelected}
          />
        )}
        <div
          ref={cardRef}
          className="pointer-events-auto bg-white/70 dark:bg-gray-900/70 backdrop-blur-2xl border border-white/50 dark:border-white/[0.08] shadow-[0_8px_30px_rgb(0,0,0,0.08)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)] rounded-2xl sm:rounded-3xl p-3 sm:p-4 ring-1 ring-black/5 dark:ring-white/10 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden"
        >
          {/* 移动端拖动条 */}
          <div
            ref={handleRef}
            className="sm:hidden flex justify-center pt-0.5 pb-2 -mt-1 cursor-pointer touch-none"
            onClick={() => {
              if (Date.now() < suppressHandleClickUntilRef.current) {
                suppressHandleClickUntilRef.current = 0
                return
              }
              setMobileCollapsed((v) => !v)
            }}
          >
            <div
              className={`w-10 h-1 rounded-full bg-gray-300 dark:bg-white/[0.06] transition-transform duration-200 ${mobileCollapsed ? 'scale-x-75' : ''}`}
            />
          </div>

          {/* 输入图片行（移动端可折叠） */}
          {inputImages.length > 0 &&
            (isMobile ? (
              <>
                <div className={`collapse-section${mobileCollapsed ? ' collapsed' : ''}`}>
                  <div className="collapse-inner">{renderImageThumbs()}</div>
                </div>
                {mobileCollapsed && (
                  <div className="text-xs text-gray-400 dark:text-gray-500 mb-2 ml-1">
                    {maskDraft ? `1 张遮罩主图 · ${referenceImages.length} 张参考图` : `${inputImages.length} 张参考图`}
                  </div>
                )}
              </>
            ) : (
              renderImageThumbs()
            ))}

          {/* 输入框 */}
          <div className="relative grid lg:min-h-0 lg:flex-1">
            {showAtImageMenu &&
              createPortal(
                <div
                  data-input-bar
                  style={atImageMenuStyle}
                  className="fixed z-[160] flex w-64 flex-col overflow-hidden rounded-2xl border border-gray-200/70 bg-white/95 p-1.5 shadow-xl ring-1 ring-black/5 backdrop-blur-xl dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10"
                >
                  <div className="shrink-0 px-2 pb-1 pt-0.5 text-[11px] text-gray-400 dark:text-gray-500">
                    选择图片引用
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
                    {atImageOptions.map((option, optionIndex) => (
                      <button
                        key={option.key}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          selectAtImageOption(option)
                        }}
                        onMouseEnter={() => setAtImageMenuIndex(optionIndex)}
                        className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-xs transition-colors ${
                          optionIndex === atImageMenuIndex
                            ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300'
                            : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.06]'
                        }`}
                      >
                        <AtImageOptionThumb option={option} />
                        <span className="min-w-0 flex-1 truncate font-medium">{option.label}</span>
                      </button>
                    ))}
                  </div>
                </div>,
                document.body,
              )}
            <div
              ref={textareaRef}
              contentEditable
              suppressContentEditableWarning
              onInput={(e) => {
                isUserInputRef.current = true
                const el = e.currentTarget
                const range = getContentEditableSelection(el)
                setCursorPos(range.start)
                syncMentionTagSelection(el)
                const text = getContentEditablePlainText(el)
                setPrompt(text)
                setAtImageMenuIndex(0)
                setAtImageMenuDismissed(false)
              }}
              onSelect={(e) => {
                const el = e.currentTarget
                const range = getContentEditableSelection(el)
                setCursorPos(range.start)
                syncMentionTagSelection(el)
                setAtImageMenuIndex(0)
                setAtImageMenuDismissed(false)
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePromptPaste}
              onCopy={handlePromptCopy}
              onClick={(e) => {
                const el = textareaRef.current
                if (!el) return
                const target = e.target as HTMLElement
                if (target.classList.contains('mention-tag')) {
                  const sel = window.getSelection()
                  if (sel) {
                    const range = document.createRange()
                    range.selectNode(target)
                    sel.removeAllRanges()
                    sel.addRange(range)
                    syncMentionTagSelection(el)
                  }
                  return
                }

                syncMentionTagSelection(el)
              }}
              aria-label={promptPlaceholder}
              className="col-start-1 row-start-1 min-h-[42px] w-full overflow-hidden ios-rounded-scroll-fix whitespace-pre-wrap break-words rounded-2xl border border-gray-200/60 bg-white/50 pl-4 pr-10 py-3 text-sm leading-relaxed shadow-sm outline-none transition-[border-color,box-shadow] duration-200 focus:ring-1 focus:ring-blue-300/40 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100 dark:focus:ring-blue-500/30 lg:h-full"
            />
            {prompt.length === 0 && (
              <div className="prompt-placeholder col-start-1 row-start-1 pointer-events-none pl-4 pr-10 py-3 text-sm leading-relaxed text-gray-400 dark:text-gray-500">
                {promptPlaceholder}
              </div>
            )}
            {prompt.length > 0 && (
              <button
                type="button"
                onClick={handleClearPrompt}
                className={`absolute right-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.08] rounded-full p-1 transition-all duration-200 focus:outline-none z-10 flex items-center justify-center ${
                  isSingleLine ? 'top-1/2 -translate-y-1/2' : 'top-3'
                }`}
                title="清空文本"
              >
                <CloseIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* 参数 + 按钮 */}
          <div ref={paramsPanelRef} className="mt-3 lg:mt-auto">
            <InputSubmitControls
              mobileCollapsed={mobileCollapsed}
              atImageLimit={atImageLimit}
              uploadImageTooltipText={uploadImageTooltipText}
              hasSubmitApiConfig={hasSubmitApiConfig}
              missingRequiredImage={missingRequiredImage}
              canSubmit={canSubmit}
              submitTooltipText={submitTooltipText}
              submitButtonAriaLabel={submitButtonAriaLabel}
              submitLabel={maskDraft ? '遮罩编辑' : '生成图像'}
              renderParams={renderParams}
              onChooseFiles={() => fileInputRef.current?.click()}
              onTakePhoto={() => cameraInputRef.current?.click()}
              onSubmit={submitCurrentMode}
              onOpenSettings={() => setShowSettings(true)}
            />{' '}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileUpload}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileUpload}
          />
          <input
            ref={replaceFileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleReplaceFileUpload}
          />
        </div>
      </div>
    </>
  )
}
