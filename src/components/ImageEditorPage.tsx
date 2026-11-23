import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  canApiProfileGenerateImages,
  getHomeApiProfile,
  getSeedreamEditorProfile,
  isVolcengineSeedreamProModel,
  validateApiProfile,
} from '../lib/apiProfiles'
import { downloadImageIds } from '../lib/downloadImages'
import {
  appendSeedreamQuickAction,
  buildSeedreamEditPrompt,
  createImageEditorParams,
  createSeedreamVisualGuideDataUrl,
  findLatestImageEditorTask,
  findSeedreamAnnotationAtPoint,
  getSeedreamAnnotationFingerprint,
  SEEDREAM_EDITOR_COLORS,
  SEEDREAM_EDITOR_REFERENCE_LIMIT,
  translateSeedreamAnnotation,
} from '../lib/seedreamEditor'
import {
  createInputImageFromDataUrl,
  createInputImageFromFile,
  deleteImageIfUnreferenced,
  ensureImageCached,
  ensureImageThumbnailCached,
  submitTaskWithInput,
  useStore,
} from '../store'
import type { InputImage, SeedreamAnnotation, SeedreamAnnotationKind, TaskRecord } from '../types'
import {
  ArrowIcon,
  BrushIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DownloadIcon,
  EllipseIcon,
  EraserIcon,
  ExternalLinkIcon,
  HandIcon,
  HistoryIcon,
  MoveIcon,
  PlusIcon,
  RectangleIcon,
  RedoIcon,
  RefreshIcon,
  SettingsIcon,
  TrashIcon,
  UndoIcon,
  UploadCloudIcon,
  WandIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from './icons'

const OFFICIAL_ARTICLE_URL =
  'https://seed.bytedance.com/zh/blog/beyond-generation-it-understands-design-introducing-seedream-5-0-pro?view_from=content_recommend'
const OFFICIAL_PROMPT_GUIDE_URL = 'https://docs.volcengine.com/docs/82379/1829186?lang=zh'
const QUICK_ACTIONS = ['添加', '删除', '替换', '改色', '换材质', '草图渲染']
const LINE_WIDTHS = [
  { label: '细', value: 0.0035 },
  { label: '中', value: 0.0065 },
  { label: '粗', value: 0.012 },
]
const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]

type EditorTool = SeedreamAnnotationKind | 'eraser' | 'pan' | 'select'
type PickerMode = 'source' | 'reference'

interface AnnotationMoveState {
  original: SeedreamAnnotation
  preview: SeedreamAnnotation
  start: { x: number; y: number }
  moved: boolean
}

function makeAnnotationId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isTextEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'))
  )
}

function useImageDataUrls(ids: string[]) {
  const [dataUrls, setDataUrls] = useState<Record<string, string>>({})
  const key = ids.join('\n')

  useEffect(() => {
    let cancelled = false
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)))
    void Promise.all(uniqueIds.map(async (id) => [id, await ensureImageCached(id)] as const)).then((entries) => {
      if (cancelled) return
      setDataUrls(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))))
    })
    return () => {
      cancelled = true
    }
  }, [key])

  return dataUrls
}

function HistoryThumbnail({ imageId }: { imageId: string }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void ensureImageThumbnailCached(imageId).then(async (thumbnail) => {
      const next = thumbnail?.dataUrl ?? (await ensureImageCached(imageId))
      if (!cancelled) setSrc(next ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [imageId])

  return src ? (
    <img src={src} alt="历史输出" className="h-full w-full object-cover" />
  ) : (
    <div className="h-full w-full animate-pulse bg-gray-100 dark:bg-gray-800" />
  )
}

function HistoryImagePicker({
  mode,
  tasks,
  onSelect,
  onClose,
}: {
  mode: PickerMode
  tasks: TaskRecord[]
  onSelect: (imageId: string) => void
  onClose: () => void
}) {
  const choices = useMemo(() => {
    const seen = new Set<string>()
    return tasks
      .flatMap((task) => task.outputImages.map((imageId) => ({ imageId, task })))
      .filter(({ imageId }) => {
        if (seen.has(imageId)) return false
        seen.add(imageId)
        return true
      })
      .slice(0, 40)
  }, [tasks])

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="从历史记录选择图片"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="ui-backdrop animate-overlay-in absolute inset-0" onMouseDown={onClose} />
      <div className="ui-modal animate-modal-in relative z-10 flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4 sm:px-6">
          <div>
            <h3 className="text-base font-bold tracking-tight text-[var(--text-1)]">从历史记录选择</h3>
            <p className="mt-0.5 text-xs text-[var(--text-3)]">选为{mode === 'source' ? '待编辑主图' : '参考图'}</p>
          </div>
          <button type="button" onClick={onClose} className="ui-icon-btn" aria-label="关闭">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="custom-scrollbar min-h-0 overflow-y-auto p-4 sm:p-5">
          {choices.length === 0 ? (
            <div className="ui-empty min-h-56">暂无可用的历史输出</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {choices.map(({ imageId, task }) => (
                <button
                  key={imageId}
                  type="button"
                  onClick={() => onSelect(imageId)}
                  className="group overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-solid)] text-left transition hover:border-[var(--accent)] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                >
                  <div className="aspect-square overflow-hidden bg-[var(--surface-inset)]">
                    <HistoryThumbnail imageId={imageId} />
                  </div>
                  <div className="truncate px-2.5 py-2 text-xs text-[var(--text-2)]">
                    {task.imageEditContext?.userInstruction || task.prompt}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ToolButton({
  active,
  label,
  shortcut,
  children,
  disabled,
  onClick,
}: {
  active?: boolean
  label: string
  shortcut?: string
  children: ReactNode
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all disabled:cursor-not-allowed disabled:opacity-35 ${
        active
          ? 'bg-[var(--cta-bg)] text-[var(--cta-fg)] shadow-sm'
          : 'text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)]'
      }`}
    >
      {children}
    </button>
  )
}

function AnnotationMark({
  annotation,
  width,
  height,
}: {
  annotation: SeedreamAnnotation
  width: number
  height: number
}) {
  if (annotation.points.length < 2) return null
  const points = annotation.points.map((point) => ({ x: point.x * width, y: point.y * height }))
  const start = points[0]
  const end = points[points.length - 1]
  const strokeWidth = Math.max(1, annotation.width * Math.min(width, height))
  const common = {
    fill: 'none',
    stroke: annotation.color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }

  if (annotation.kind === 'brush') {
    return (
      <path
        {...common}
        d={points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')}
      />
    )
  }
  if (annotation.kind === 'rectangle') {
    return (
      <rect
        {...common}
        x={Math.min(start.x, end.x)}
        y={Math.min(start.y, end.y)}
        width={Math.abs(end.x - start.x)}
        height={Math.abs(end.y - start.y)}
      />
    )
  }
  if (annotation.kind === 'ellipse') {
    return (
      <ellipse
        {...common}
        cx={(start.x + end.x) / 2}
        cy={(start.y + end.y) / 2}
        rx={Math.abs(end.x - start.x) / 2}
        ry={Math.abs(end.y - start.y) / 2}
      />
    )
  }

  const angle = Math.atan2(end.y - start.y, end.x - start.x)
  const head = Math.max(strokeWidth * 5, Math.min(width, height) * 0.018)
  const left = { x: end.x - head * Math.cos(angle - Math.PI / 6), y: end.y - head * Math.sin(angle - Math.PI / 6) }
  const right = { x: end.x - head * Math.cos(angle + Math.PI / 6), y: end.y - head * Math.sin(angle + Math.PI / 6) }
  return (
    <g {...common}>
      <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
      <path d={`M ${left.x} ${left.y} L ${end.x} ${end.y} L ${right.x} ${right.y}`} />
    </g>
  )
}

function AnnotationSelectionOutline({
  annotation,
  width,
  height,
}: {
  annotation: SeedreamAnnotation
  width: number
  height: number
}) {
  if (annotation.points.length === 0) return null
  const xs = annotation.points.map((point) => point.x * width)
  const ys = annotation.points.map((point) => point.y * height)
  const padding = Math.max(6, Math.min(width, height) * 0.012)
  const left = Math.max(0, Math.min(...xs) - padding)
  const top = Math.max(0, Math.min(...ys) - padding)
  const right = Math.min(width, Math.max(...xs) + padding)
  const bottom = Math.min(height, Math.max(...ys) + padding)
  return (
    <rect
      x={left}
      y={top}
      width={Math.max(1, right - left)}
      height={Math.max(1, bottom - top)}
      rx={Math.max(2, padding / 2)}
      fill="none"
      stroke="#2563eb"
      strokeWidth={Math.max(1.5, Math.min(width, height) * 0.0025)}
      strokeDasharray={`${padding} ${Math.max(4, padding * 0.65)}`}
      pointerEvents="none"
    />
  )
}

export default function ImageEditorPage() {
  const settings = useStore((state) => state.settings)
  const draft = useStore((state) => state.seedreamEditorDraft)
  const setDraft = useStore((state) => state.setSeedreamEditorDraft)
  const tasks = useStore((state) => state.tasks)
  const setShowSettings = useStore((state) => state.setShowSettings)
  const setLightboxImageId = useStore((state) => state.setLightboxImageId)
  const showToast = useStore((state) => state.showToast)

  const sourceInputRef = useRef<HTMLInputElement>(null)
  const referenceInputRef = useRef<HTMLInputElement>(null)
  const canvasViewportRef = useRef<HTMLDivElement>(null)
  const panStateRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null)
  const annotationMoveRef = useRef<AnnotationMoveState | null>(null)
  const [tool, setTool] = useState<EditorTool>('brush')
  const [color, setColor] = useState<string>(SEEDREAM_EDITOR_COLORS[0])
  const [lineWidth, setLineWidth] = useState(LINE_WIDTHS[1].value)
  const [zoom, setZoom] = useState(1)
  const [dimensions, setDimensions] = useState({ width: 1, height: 1 })
  const [canPan, setCanPan] = useState(false)
  const [outputDimensions, setOutputDimensions] = useState<{ width: number; height: number } | null>(null)
  const [currentAnnotation, setCurrentAnnotation] = useState<SeedreamAnnotation | null>(null)
  const [movingAnnotation, setMovingAnnotation] = useState<SeedreamAnnotation | null>(null)
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
  const [undoStack, setUndoStack] = useState<SeedreamAnnotation[][]>([])
  const [redoStack, setRedoStack] = useState<SeedreamAnnotation[][]>([])
  const [pickerMode, setPickerMode] = useState<PickerMode | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [isCanvasDragging, setIsCanvasDragging] = useState(false)
  const [comparingOriginal, setComparingOriginal] = useState(false)

  const latestTask = useMemo(
    () => findLatestImageEditorTask(tasks, draft.engine, draft.latestTaskId),
    [draft.engine, draft.latestTaskId, tasks],
  )
  const outputImageId = latestTask?.outputImages[0] ?? null
  const requestedImageIds = [
    ...(draft.sourceImageId ? [draft.sourceImageId] : []),
    ...draft.referenceImageIds,
    ...(outputImageId ? [outputImageId] : []),
  ]
  const imageDataUrls = useImageDataUrls(requestedImageIds)
  const sourceDataUrl = draft.sourceImageId ? imageDataUrls[draft.sourceImageId] : null
  const outputDataUrl = outputImageId ? imageDataUrls[outputImageId] : null
  const homeProfile = useMemo(() => getHomeApiProfile(settings), [settings])
  const seedreamProfile = useMemo(() => getSeedreamEditorProfile(settings), [settings])
  const profile = draft.engine === 'seedream' ? seedreamProfile : homeProfile
  const profileValidationError = profile ? validateApiProfile(profile) : null
  const profileError = !profile
    ? '尚未配置 Seedream Pro 图片编辑 API'
    : !canApiProfileGenerateImages(profile)
      ? `配置「${profile.name}」不支持图片生成或编辑`
      : draft.engine === 'seedream' &&
          (profile.provider !== 'volcengine' || !isVolcengineSeedreamProModel(profile.model))
        ? 'Seedream 编辑配置必须使用 Seedream 5.0 Pro 模型'
        : profileValidationError
          ? `${draft.engine === 'seedream' ? 'Seedream 编辑' : '首页生图'}配置不完整：${profileValidationError}`
          : null
  const isRunning = latestTask?.status === 'running'

  useEffect(() => {
    setCurrentAnnotation(null)
    annotationMoveRef.current = null
    setMovingAnnotation(null)
    setSelectedAnnotationId(null)
    setUndoStack([])
    setRedoStack([])
    setZoom(1)
  }, [draft.sourceImageId])

  useEffect(() => {
    setOutputDimensions(null)
    setComparingOriginal(false)
  }, [outputImageId])

  useEffect(() => {
    const viewport = canvasViewportRef.current
    if (!viewport || !sourceDataUrl) {
      setCanPan(false)
      return
    }

    const updateCanPan = () => {
      setCanPan(viewport.scrollWidth > viewport.clientWidth + 1 || viewport.scrollHeight > viewport.clientHeight + 1)
    }
    const frame = window.requestAnimationFrame(updateCanPan)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateCanPan)
    observer?.observe(viewport)
    if (viewport.firstElementChild instanceof HTMLElement) observer?.observe(viewport.firstElementChild)
    window.addEventListener('resize', updateCanPan)

    return () => {
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', updateCanPan)
    }
  }, [dimensions.height, dimensions.width, sourceDataUrl, zoom])

  useEffect(() => {
    if (tool === 'pan' && !canPan) setTool('brush')
  }, [canPan, tool])

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.items ?? [])
        .find((item) => item.type.startsWith('image/'))
        ?.getAsFile()
      if (!file) return
      event.preventDefault()
      void createInputImageFromFile(file).then((image) => {
        if (image) applySourceImage(image.id)
      })
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  })

  const applySourceImage = (imageId: string) => {
    const previousSourceId = draft.sourceImageId
    setDraft({
      sourceImageId: imageId,
      referenceImageIds: draft.referenceImageIds.filter((id) => id !== imageId),
      annotations: [],
      instruction: '',
      latestTaskId: null,
    })
    if (previousSourceId && previousSourceId !== imageId) void deleteImageIfUnreferenced(previousSourceId)
  }

  const uploadSource = async (file: File | undefined) => {
    if (!file) return
    const image = await createInputImageFromFile(file)
    if (!image) {
      showToast('请选择有效的图片文件', 'error')
      return
    }
    applySourceImage(image.id)
  }

  const addReferenceIds = (ids: string[]) => {
    const next = [...draft.referenceImageIds]
    for (const id of ids) {
      if (id === draft.sourceImageId || next.includes(id)) continue
      if (next.length >= SEEDREAM_EDITOR_REFERENCE_LIMIT) break
      next.push(id)
    }
    if (next.length === draft.referenceImageIds.length) {
      showToast(next.length >= SEEDREAM_EDITOR_REFERENCE_LIMIT ? '参考图最多添加 4 张' : '这张图片已经添加', 'info')
      return
    }
    setDraft({ referenceImageIds: next })
    if (ids.length > next.length - draft.referenceImageIds.length) showToast('参考图最多添加 4 张', 'info')
  }

  const uploadReferences = async (files: File[]) => {
    const remaining = SEEDREAM_EDITOR_REFERENCE_LIMIT - draft.referenceImageIds.length
    if (remaining <= 0) {
      showToast('参考图最多添加 4 张', 'info')
      return
    }
    const images = await Promise.all(files.slice(0, remaining).map(createInputImageFromFile))
    addReferenceIds(images.filter((image): image is InputImage => image != null).map((image) => image.id))
    if (files.length > remaining) showToast(`仅添加前 ${remaining} 张参考图`, 'info')
  }

  const removeReference = (imageId: string) => {
    setDraft({ referenceImageIds: draft.referenceImageIds.filter((id) => id !== imageId) })
    void deleteImageIfUnreferenced(imageId)
  }

  const moveReference = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= draft.referenceImageIds.length) return
    const next = [...draft.referenceImageIds]
    ;[next[index], next[target]] = [next[target], next[index]]
    setDraft({ referenceImageIds: next })
  }

  const commitAnnotations = useCallback(
    (next: SeedreamAnnotation[]) => {
      setUndoStack((stack) => [...stack.slice(-49), draft.annotations])
      setRedoStack([])
      setDraft({ annotations: next })
    },
    [draft.annotations, setDraft],
  )

  const undo = useCallback(() => {
    const previous = undoStack[undoStack.length - 1]
    if (!previous) return
    annotationMoveRef.current = null
    setMovingAnnotation(null)
    setSelectedAnnotationId(null)
    setUndoStack((stack) => stack.slice(0, -1))
    setRedoStack((stack) => [...stack, draft.annotations])
    setDraft({ annotations: previous })
  }, [draft.annotations, setDraft, undoStack])

  const redo = useCallback(() => {
    const next = redoStack[redoStack.length - 1]
    if (!next) return
    annotationMoveRef.current = null
    setMovingAnnotation(null)
    setSelectedAnnotationId(null)
    setRedoStack((stack) => stack.slice(0, -1))
    setUndoStack((stack) => [...stack, draft.annotations])
    setDraft({ annotations: next })
  }, [draft.annotations, redoStack, setDraft])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || isTextEditingTarget(event.target)) return
      const key = event.key.toLowerCase()
      if (event.ctrlKey || event.metaKey) {
        if (key === 'z' && !event.shiftKey) {
          event.preventDefault()
          undo()
          return
        }
        if ((key === 'y' && !event.shiftKey) || (key === 'z' && event.shiftKey)) {
          event.preventDefault()
          redo()
        }
        return
      }
      if (event.shiftKey || pickerMode) return
      if (key === 'v') setTool('select')
      else if (key === 'b') setTool('brush')
      else if (key === 'r') setTool('rectangle')
      else if (key === 'o') setTool('ellipse')
      else if (key === 'a') setTool('arrow')
      else if (key === 'e') setTool('eraser')
      else if (key === 'h' && canPan) setTool('pan')
      else if (key === '0') setZoom(1)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canPan, pickerMode, redo, undo])

  const pointFromEvent = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    }
  }

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || !draft.sourceImageId) return
    event.currentTarget.setPointerCapture(event.pointerId)
    if (tool === 'pan') {
      const viewport = canvasViewportRef.current
      if (!viewport) return
      panStateRef.current = {
        x: event.clientX,
        y: event.clientY,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
      }
      return
    }
    const point = pointFromEvent(event)
    if (tool === 'select') {
      const hitId = findSeedreamAnnotationAtPoint(draft.annotations, point, dimensions.width, dimensions.height)
      const annotation = hitId ? (draft.annotations.find((item) => item.id === hitId) ?? null) : null
      setSelectedAnnotationId(hitId)
      annotationMoveRef.current = annotation
        ? { original: annotation, preview: annotation, start: point, moved: false }
        : null
      setMovingAnnotation(annotation)
      return
    }
    if (tool === 'eraser') {
      const hitId = findSeedreamAnnotationAtPoint(draft.annotations, point, dimensions.width, dimensions.height)
      if (hitId) commitAnnotations(draft.annotations.filter((annotation) => annotation.id !== hitId))
      return
    }
    setCurrentAnnotation({ id: makeAnnotationId(), kind: tool, color, width: lineWidth, points: [point, point] })
  }

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (panStateRef.current) {
      const viewport = canvasViewportRef.current
      if (!viewport) return
      viewport.scrollLeft = panStateRef.current.scrollLeft - (event.clientX - panStateRef.current.x)
      viewport.scrollTop = panStateRef.current.scrollTop - (event.clientY - panStateRef.current.y)
      return
    }
    const annotationMove = annotationMoveRef.current
    if (annotationMove) {
      const point = pointFromEvent(event)
      const delta = {
        x: point.x - annotationMove.start.x,
        y: point.y - annotationMove.start.y,
      }
      const preview = translateSeedreamAnnotation(annotationMove.original, delta)
      annotationMove.preview = preview
      annotationMove.moved = annotationMove.moved || Math.hypot(delta.x, delta.y) >= 0.001
      setMovingAnnotation(preview)
      return
    }
    if (!currentAnnotation) return
    const point = pointFromEvent(event)
    setCurrentAnnotation((annotation) => {
      if (!annotation) return null
      if (annotation.kind === 'brush') {
        const previous = annotation.points[annotation.points.length - 1]
        if (Math.hypot(point.x - previous.x, point.y - previous.y) < 0.002) return annotation
        return { ...annotation, points: [...annotation.points, point] }
      }
      return { ...annotation, points: [annotation.points[0], point] }
    })
  }

  const finishPointerAction = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    panStateRef.current = null
    const annotationMove = annotationMoveRef.current
    annotationMoveRef.current = null
    if (annotationMove) {
      setMovingAnnotation(null)
      if (annotationMove.moved) {
        commitAnnotations(
          draft.annotations.map((annotation) =>
            annotation.id === annotationMove.original.id ? annotationMove.preview : annotation,
          ),
        )
      }
      return
    }
    if (!currentAnnotation) return
    const start = currentAnnotation.points[0]
    const end = currentAnnotation.points[currentAnnotation.points.length - 1]
    if (Math.hypot(end.x - start.x, end.y - start.y) >= 0.003) {
      commitAnnotations([...draft.annotations, currentAnnotation])
    }
    setCurrentAnnotation(null)
  }

  const adjustZoom = useCallback((direction: -1 | 1) => {
    setZoom((currentZoom) => {
      const index = ZOOM_LEVELS.reduce(
        (best, level, levelIndex) =>
          Math.abs(level - currentZoom) < Math.abs(ZOOM_LEVELS[best] - currentZoom) ? levelIndex : best,
        0,
      )
      return ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, index + direction))]
    })
  }, [])

  useEffect(() => {
    const viewport = canvasViewportRef.current
    if (!viewport || !sourceDataUrl) return
    const handleWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.deltaY === 0) return
      event.preventDefault()
      adjustZoom(event.deltaY < 0 ? 1 : -1)
    }
    viewport.addEventListener('wheel', handleWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleWheel)
  }, [adjustZoom, sourceDataUrl])

  const generate = async () => {
    if (profileError || !profile) {
      showToast(profileError ?? '请先配置图片编辑 API', 'error')
      setShowSettings(true, 'api')
      return
    }
    if (!draft.sourceImageId) {
      showToast('请先添加待编辑主图', 'error')
      return
    }
    if (!draft.instruction.trim()) {
      showToast('请输入编辑要求', 'error')
      return
    }

    setSubmitting(true)
    let visualGuide: InputImage | null = null
    try {
      const source = imageDataUrls[draft.sourceImageId] ?? (await ensureImageCached(draft.sourceImageId))
      if (!source) throw new Error('主图已不存在，请重新选择')
      const referenceImages: InputImage[] = []
      for (const id of draft.referenceImageIds) {
        const dataUrl = imageDataUrls[id] ?? (await ensureImageCached(id))
        if (!dataUrl) throw new Error('有参考图已不存在，请移除后重试')
        referenceImages.push({ id, dataUrl })
      }
      const guideDataUrl = await createSeedreamVisualGuideDataUrl(source, draft.annotations)
      if (guideDataUrl) visualGuide = await createInputImageFromDataUrl(guideDataUrl)
      const inputImages = [
        { id: draft.sourceImageId, dataUrl: source },
        ...(visualGuide ? [visualGuide] : []),
        ...referenceImages,
      ]
      const taskId = await submitTaskWithInput({
        apiProfileId: profile.id,
        prompt: buildSeedreamEditPrompt({
          instruction: draft.instruction,
          hasVisualGuide: Boolean(visualGuide),
          referenceCount: referenceImages.length,
        }),
        inputImages,
        params: createImageEditorParams(draft.resolution, profile, dimensions),
        category: { workflow: 'seedream-edit' },
        imageEditContext: {
          engine: draft.engine,
          sourceImageId: draft.sourceImageId,
          visualGuideImageId: visualGuide?.id ?? null,
          annotationFingerprint: getSeedreamAnnotationFingerprint(draft.annotations),
          referenceImageIds: draft.referenceImageIds,
          userInstruction: draft.instruction.trim(),
        },
      })
      if (taskId) setDraft({ latestTaskId: taskId })
      else if (visualGuide) void deleteImageIfUnreferenced(visualGuide.id)
    } catch (error) {
      if (visualGuide) void deleteImageIfUnreferenced(visualGuide.id)
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const continueEditing = () => {
    if (!outputImageId) return
    const previousSourceId = draft.sourceImageId
    setDraft({
      sourceImageId: outputImageId,
      annotations: [],
      instruction: '',
      latestTaskId: latestTask?.id ?? null,
    })
    if (previousSourceId && previousSourceId !== outputImageId) void deleteImageIfUnreferenced(previousSourceId)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    showToast('结果已设为新的主图', 'success')
  }

  const handleHistorySelect = (imageId: string) => {
    if (pickerMode === 'reference') addReferenceIds([imageId])
    else applySourceImage(imageId)
    setPickerMode(null)
  }

  const renderCanvas = () => {
    if (!draft.sourceImageId) {
      return (
        <div
          className={`image-editor-canvas-stage flex min-h-[420px] flex-col items-center justify-center px-6 text-center transition sm:min-h-[520px] ${
            isCanvasDragging ? 'ring-2 ring-inset ring-[var(--accent)]' : ''
          }`}
          onDragOver={(event) => {
            event.preventDefault()
            if (!isCanvasDragging) setIsCanvasDragging(true)
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsCanvasDragging(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setIsCanvasDragging(false)
            void uploadSource(event.dataTransfer.files[0])
          }}
        >
          <div className="ui-dropzone-icon h-14 w-14 rounded-2xl">
            <UploadCloudIcon className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-base font-bold tracking-tight text-[var(--text-1)]">
            {isCanvasDragging ? '松开鼠标以上传主图' : '添加待编辑主图'}
          </h3>
          <p className="mt-1.5 text-sm text-[var(--text-2)]">上传、拖放，或直接 Ctrl/Cmd + V 粘贴一张图片</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2.5">
            <button
              type="button"
              onClick={() => sourceInputRef.current?.click()}
              className="ui-btn ui-btn-primary h-10 px-5"
            >
              上传主图
            </button>
            <button type="button" onClick={() => setPickerMode('source')} className="ui-btn ui-btn-soft h-10 px-4">
              <HistoryIcon className="h-4 w-4" />
              从历史选择
            </button>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-3)]">
            <span>快捷键：V 选择</span>
            <span>B 画笔</span>
            <span>R 矩形</span>
            <span>O 椭圆</span>
            <span>A 箭头</span>
            <span>E 橡皮擦</span>
            <span>0 重置缩放</span>
          </div>
        </div>
      )
    }

    return (
      <div
        ref={canvasViewportRef}
        className={`image-editor-canvas-stage min-h-[400px] max-h-[72vh] overflow-auto p-4 transition sm:min-h-[500px] sm:p-6 ${
          isCanvasDragging ? 'ring-2 ring-inset ring-[var(--accent)]' : ''
        } ${tool === 'pan' ? 'cursor-grab active:cursor-grabbing' : tool === 'select' ? 'cursor-move' : tool === 'eraser' ? 'cursor-cell' : 'cursor-crosshair'}`}
        onDragOver={(event) => {
          event.preventDefault()
          if (!isCanvasDragging) setIsCanvasDragging(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsCanvasDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setIsCanvasDragging(false)
          void uploadSource(event.dataTransfer.files[0])
        }}
      >
        <div className={`min-h-full min-w-full ${zoom <= 1 ? 'flex items-center justify-center' : 'w-max'}`}>
          <div
            className="relative inline-block max-w-full overflow-hidden rounded-xl shadow-[var(--shadow-card)] ring-1 ring-[var(--line-strong)]"
            style={{ zoom }}
          >
            {sourceDataUrl ? (
              <img
                src={sourceDataUrl}
                alt="待编辑主图"
                className="block max-h-[66vh] max-w-full bg-white object-contain"
                onLoad={(event) =>
                  setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
                }
              />
            ) : (
              <div className="flex h-80 w-80 items-center justify-center bg-[var(--surface-solid)] text-sm text-[var(--text-3)]">
                正在读取主图…
              </div>
            )}
            {sourceDataUrl && (
              <svg
                className="absolute inset-0 h-full w-full"
                viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
                preserveAspectRatio="none"
                style={{ touchAction: 'none' }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={finishPointerAction}
                onPointerCancel={finishPointerAction}
              >
                {draft.annotations.map((annotation) => {
                  const renderedAnnotation = movingAnnotation?.id === annotation.id ? movingAnnotation : annotation
                  return (
                    <g key={annotation.id}>
                      <AnnotationMark
                        annotation={renderedAnnotation}
                        width={dimensions.width}
                        height={dimensions.height}
                      />
                      {tool === 'select' && selectedAnnotationId === annotation.id && (
                        <AnnotationSelectionOutline
                          annotation={renderedAnnotation}
                          width={dimensions.width}
                          height={dimensions.height}
                        />
                      )}
                    </g>
                  )
                })}
                {currentAnnotation && (
                  <AnnotationMark annotation={currentAnnotation} width={dimensions.width} height={dimensions.height} />
                )}
              </svg>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div data-no-drag-select className="animate-fade-up pb-8">
      <input
        ref={sourceInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          void uploadSource(event.target.files?.[0])
          event.currentTarget.value = ''
        }}
      />
      <input
        ref={referenceInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          void uploadReferences(Array.from(event.target.files ?? []))
          event.currentTarget.value = ''
        }}
      />

      <div className="ui-panel mb-4 flex flex-col gap-3 px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="ui-page-icon h-10 w-10 rounded-xl" aria-hidden="true">
            <WandIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="ui-title text-lg">图片编辑</h2>
              <span className={`ui-badge ${profileError ? 'ui-badge-warning' : 'ui-badge-success'}`}>
                <span className="ui-dot" />
                {profileError ? '配置待完善' : profile?.model || '图片编辑'}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-[var(--text-3)]">
              标注修改位置，完成局部增删、改色换材质、草图渲染与多图融合
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="编辑引擎" className="ui-segmented inline-grid grid-cols-2 p-0.5">
            <button
              type="button"
              aria-pressed={draft.engine === 'home'}
              data-active={draft.engine === 'home'}
              onClick={() => setDraft({ engine: 'home' })}
              title={`${homeProfile?.name ?? '未配置'} · ${homeProfile?.model || '未配置模型'}`}
              className="ui-segment min-h-8 px-3 text-xs font-semibold"
            >
              首页生图 API
            </button>
            <button
              type="button"
              aria-pressed={draft.engine === 'seedream'}
              data-active={draft.engine === 'seedream'}
              onClick={() => setDraft({ engine: 'seedream' })}
              title={
                seedreamProfile ? `${seedreamProfile.name} · ${seedreamProfile.model || '未配置模型'}` : '可选专用配置'
              }
              className="ui-segment min-h-8 px-3 text-xs font-semibold"
            >
              Seedream Pro
            </button>
          </div>
          <a
            href={OFFICIAL_ARTICLE_URL}
            target="_blank"
            rel="noreferrer"
            title="Seedream 介绍"
            className="ui-btn ui-btn-ghost ui-btn-sm hidden sm:inline-flex"
          >
            介绍
            <ExternalLinkIcon className="h-3.5 w-3.5" />
          </a>
          <a
            href={OFFICIAL_PROMPT_GUIDE_URL}
            target="_blank"
            rel="noreferrer"
            title="提示词指南"
            className="ui-btn ui-btn-ghost ui-btn-sm hidden sm:inline-flex"
          >
            指南
            <ExternalLinkIcon className="h-3.5 w-3.5" />
          </a>
          <button type="button" onClick={() => setShowSettings(true, 'api')} className="ui-btn ui-btn-sm h-9">
            <SettingsIcon className="h-3.5 w-3.5" />
            编辑配置
          </button>
        </div>
      </div>

      {profileError && (
        <button
          type="button"
          onClick={() => setShowSettings(true, 'api')}
          className="ui-callout ui-callout-warning mb-4 w-full items-center justify-between text-left transition hover:brightness-95"
        >
          <span className="font-medium">{profileError}</span>
          <span className="shrink-0 rounded-lg bg-amber-500/15 px-3 py-1 text-xs font-bold">前往设置 →</span>
        </button>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22.5rem]">
        <section className="ui-panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] bg-[var(--surface-panel-strong)] px-3.5 py-2">
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
              <ToolButton
                active={tool === 'select'}
                label="选择并移动标注"
                shortcut="V"
                onClick={() => setTool('select')}
              >
                <MoveIcon className="h-4 w-4" />
              </ToolButton>
              <ToolButton active={tool === 'brush'} label="自由涂鸦" shortcut="B" onClick={() => setTool('brush')}>
                <BrushIcon className="h-4 w-4" />
              </ToolButton>
              <ToolButton
                active={tool === 'rectangle'}
                label="矩形标注"
                shortcut="R"
                onClick={() => setTool('rectangle')}
              >
                <RectangleIcon className="h-4 w-4" />
              </ToolButton>
              <ToolButton active={tool === 'ellipse'} label="椭圆标注" shortcut="O" onClick={() => setTool('ellipse')}>
                <EllipseIcon className="h-4 w-4" />
              </ToolButton>
              <ToolButton active={tool === 'arrow'} label="箭头标注" shortcut="A" onClick={() => setTool('arrow')}>
                <ArrowIcon className="h-4 w-4" />
              </ToolButton>
              <ToolButton active={tool === 'eraser'} label="橡皮擦" shortcut="E" onClick={() => setTool('eraser')}>
                <EraserIcon className="h-4 w-4" />
              </ToolButton>
              <span className="mx-1.5 h-5 w-px shrink-0 bg-[var(--line-strong)]" />
              <ToolButton label="撤销（Ctrl/Cmd + Z）" disabled={undoStack.length === 0} onClick={undo}>
                <UndoIcon className="h-4 w-4" />
              </ToolButton>
              <ToolButton label="重做（Ctrl + Y / Cmd + Shift + Z）" disabled={redoStack.length === 0} onClick={redo}>
                <RedoIcon className="h-4 w-4" />
              </ToolButton>
              <ToolButton
                label="清空标注"
                disabled={draft.annotations.length === 0}
                onClick={() => {
                  setSelectedAnnotationId(null)
                  commitAnnotations([])
                }}
              >
                <TrashIcon className="h-4 w-4" />
              </ToolButton>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                title={canPan ? '拖动放大后的画布 (H)' : '放大图片后可拖动画布'}
                aria-label={canPan ? '拖动画布' : '拖动画布（放大后可用）'}
                aria-pressed={tool === 'pan'}
                disabled={!canPan}
                onClick={() => setTool('pan')}
                className={`ui-btn ui-btn-sm h-8 ${tool === 'pan' ? 'ui-btn-soft ring-1 ring-[var(--accent-ring)]' : 'ui-btn-ghost'}`}
              >
                <HandIcon className="h-4 w-4" />
                拖动画布
              </button>
              <span className="mx-1 h-5 w-px shrink-0 bg-[var(--line-strong)]" />
              <ToolButton label="缩小" disabled={zoom <= ZOOM_LEVELS[0]} onClick={() => adjustZoom(-1)}>
                <ZoomOutIcon className="h-4 w-4" />
              </ToolButton>
              <button
                type="button"
                onClick={() => setZoom(1)}
                className="ui-btn ui-btn-ghost ui-btn-sm h-8 min-w-12 px-1.5 font-mono tabular-nums"
                title="恢复 100% (0)"
              >
                {Math.round(zoom * 100)}%
              </button>
              <ToolButton
                label="放大"
                disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
                onClick={() => adjustZoom(1)}
              >
                <ZoomInIcon className="h-4 w-4" />
              </ToolButton>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-[var(--line)] bg-[var(--surface-inset)] px-4 py-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[var(--text-2)]">标注色</span>
              {SEEDREAM_EDITOR_COLORS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setColor(item)}
                  className={`h-5 w-5 rounded-full border-2 border-[var(--surface-solid)] transition-transform hover:scale-110 active:scale-95 ${
                    color === item ? 'scale-110 ring-2 ring-[var(--accent)]' : 'ring-1 ring-[var(--line-strong)]'
                  }`}
                  style={{ backgroundColor: item }}
                  aria-label={`选择标注色 ${item}`}
                />
              ))}
            </div>
            <div className="ui-segmented p-0.5">
              {LINE_WIDTHS.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  data-active={lineWidth === item.value}
                  onClick={() => setLineWidth(item.value)}
                  className="ui-segment min-h-6 px-2.5 text-xs"
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              {sourceDataUrl && dimensions.width > 1 && (
                <span className="hidden rounded-md bg-[var(--surface-solid)] px-2 py-0.5 font-mono text-[11px] tabular-nums text-[var(--text-3)] ring-1 ring-[var(--line)] sm:inline-block">
                  {dimensions.width}×{dimensions.height}
                  {draft.annotations.length > 0 ? ` · ${draft.annotations.length} 标注` : ''}
                </span>
              )}
              <button
                type="button"
                onClick={() => sourceInputRef.current?.click()}
                className="ui-btn ui-btn-ghost ui-btn-sm h-7"
              >
                更换主图
              </button>
              <button
                type="button"
                onClick={() => setPickerMode('source')}
                className="ui-btn ui-btn-ghost ui-btn-sm h-7"
              >
                历史
              </button>
            </div>
          </div>
          {renderCanvas()}
        </section>

        <aside className="space-y-4 xl:sticky xl:top-[68px] xl:self-start">
          <section className="ui-panel p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="ui-section-title">参考图</h3>
                <p className="mt-0.5 text-xs text-[var(--text-3)]">主体、融合、风格或材质参考，最多 4 张</p>
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setPickerMode('reference')}
                  className="ui-icon-btn ui-icon-btn-sm"
                  title="从历史添加"
                >
                  <HistoryIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => referenceInputRef.current?.click()}
                  disabled={draft.referenceImageIds.length >= SEEDREAM_EDITOR_REFERENCE_LIMIT}
                  className="ui-btn ui-btn-primary h-8 w-8 rounded-full p-0"
                  title="上传参考图"
                >
                  <PlusIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
            {draft.referenceImageIds.length === 0 ? (
              <button
                type="button"
                onClick={() => referenceInputRef.current?.click()}
                className="ui-dropzone mt-3.5 min-h-[100px] w-full py-5 text-xs font-medium"
              >
                <PlusIcon className="h-4 w-4 text-[var(--accent)]" />
                添加可选参考图
              </button>
            ) : (
              <div className="mt-3.5 grid grid-cols-2 gap-2.5">
                {draft.referenceImageIds.map((imageId, index) => (
                  <div
                    key={imageId}
                    className="group relative overflow-hidden rounded-xl bg-[var(--surface-solid)] shadow-[0_0_0_1px_var(--line)]"
                  >
                    <div className="aspect-square">
                      {imageDataUrls[imageId] ? (
                        <img
                          src={imageDataUrls[imageId]}
                          alt={`参考图 ${index + 1}`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="ui-skeleton h-full w-full" />
                      )}
                    </div>
                    <div className="absolute left-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                      参考 {index + 1}
                    </div>
                    <div className="absolute inset-x-1.5 bottom-1.5 flex justify-between rounded-lg bg-black/65 p-0.5 opacity-100 backdrop-blur-md sm:opacity-0 sm:transition sm:group-hover:opacity-100">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => moveReference(index, -1)}
                        className="rounded p-1 text-white transition hover:bg-white/15 disabled:opacity-30"
                        title="前移"
                      >
                        <ChevronLeftIcon className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeReference(imageId)}
                        className="rounded p-1 text-white transition hover:bg-red-500/80"
                        title="移除"
                      >
                        <CloseIcon className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={index === draft.referenceImageIds.length - 1}
                        onClick={() => moveReference(index, 1)}
                        className="rounded p-1 text-white transition hover:bg-white/15 disabled:opacity-30"
                        title="后移"
                      >
                        <ChevronRightIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="ui-panel p-5">
            <label htmlFor="seedream-instruction" className="ui-section-title block">
              编辑要求
            </label>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action}
                  type="button"
                  onClick={() => setDraft({ instruction: appendSeedreamQuickAction(draft.instruction, action) })}
                  className="ui-chip"
                >
                  + {action}
                </button>
              ))}
            </div>
            <textarea
              id="seedream-instruction"
              value={draft.instruction}
              onChange={(event) => setDraft({ instruction: event.target.value })}
              rows={6}
              placeholder="例如：删除红色箭头指向的文字，其余产品结构、光影和背景保持不变。"
              className="ui-input mt-3 resize-y"
            />

            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-[var(--text-2)]">输出分辨率</span>
              <div className="ui-segmented">
                {(['2k', '4k'] as const).map((resolution) => (
                  <button
                    key={resolution}
                    type="button"
                    aria-pressed={draft.resolution === resolution}
                    data-active={draft.resolution === resolution}
                    onClick={() => setDraft({ resolution })}
                    className="ui-segment px-4 text-xs font-bold"
                  >
                    {resolution.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-1.5 text-right text-[11px] text-[var(--text-3)]">固定单张输出 · 保持主图比例</div>

            <button
              type="button"
              onClick={() => void generate()}
              disabled={
                submitting || isRunning || !draft.sourceImageId || !draft.instruction.trim() || Boolean(profileError)
              }
              className="ui-btn ui-btn-primary ui-btn-lg ui-btn-block mt-4"
            >
              {(submitting || isRunning) && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              )}
              {submitting ? '正在准备…' : isRunning ? '正在编辑…' : '开始图片编辑'}
            </button>
          </section>
        </aside>
      </div>

      <section className="ui-panel mt-5 overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
          <div>
            <h3 className="ui-section-title">最近结果</h3>
            <p className="mt-0.5 text-xs text-[var(--text-3)]">运行状态与单张编辑结果</p>
          </div>
          <div className="flex items-center gap-2">
            {latestTask?.status === 'done' && sourceDataUrl && outputDataUrl && (
              <div className="ui-segmented p-0.5">
                <button
                  type="button"
                  data-active={!comparingOriginal}
                  aria-pressed={!comparingOriginal}
                  onClick={() => setComparingOriginal(false)}
                  className="ui-segment min-h-7 px-2.5 text-xs font-semibold"
                >
                  编辑结果
                </button>
                <button
                  type="button"
                  data-active={comparingOriginal}
                  aria-pressed={comparingOriginal}
                  onClick={() => setComparingOriginal(true)}
                  className="ui-segment min-h-7 px-2.5 text-xs font-semibold"
                >
                  对比原图
                </button>
              </div>
            )}
            {latestTask && (
              <span
                className={`ui-badge ${
                  latestTask.status === 'done'
                    ? 'ui-badge-success'
                    : latestTask.status === 'error'
                      ? 'ui-badge-danger'
                      : 'ui-badge-accent'
                }`}
              >
                <span className={`ui-dot ${latestTask.status === 'running' ? 'animate-pulse' : ''}`} />
                {latestTask.status === 'done' ? '已完成' : latestTask.status === 'error' ? '失败' : '运行中'}
              </span>
            )}
          </div>
        </div>
        {!latestTask ? (
          <div className="ui-empty min-h-48">提交编辑任务后，结果会显示在这里</div>
        ) : latestTask.status === 'running' ? (
          <div className="flex min-h-56 flex-col items-center justify-center gap-3 px-4 text-sm text-[var(--text-2)]">
            <div className="progress-ring" />
            {latestTask.apiProfileName || '图片模型'}正在处理图片
          </div>
        ) : latestTask.status === 'error' ? (
          <div className="flex min-h-48 flex-col items-center justify-center px-5 py-6 text-center">
            <div className="text-sm font-bold text-[var(--danger)]">编辑失败</div>
            <div
              data-selectable-text
              className="mt-2 max-w-2xl whitespace-pre-wrap text-xs leading-5 text-[var(--text-2)]"
            >
              {latestTask.error || '未知错误'}
            </div>
            <button type="button" onClick={() => void generate()} className="ui-btn ui-btn-soft mt-4">
              <RefreshIcon className="h-4 w-4" />
              重新提交当前编辑
            </button>
          </div>
        ) : outputImageId ? (
          <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
            <button
              type="button"
              onClick={() => setLightboxImageId(outputImageId, latestTask.outputImages)}
              className="image-editor-canvas-stage relative flex min-h-64 items-center justify-center overflow-hidden rounded-2xl shadow-[inset_0_0_0_1px_var(--line)]"
            >
              {comparingOriginal && sourceDataUrl ? (
                <>
                  <span className="absolute left-3 top-3 z-10 rounded-md bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
                    原图（修改前）
                  </span>
                  <img src={sourceDataUrl} alt="编辑前原图" className="max-h-[70vh] max-w-full object-contain" />
                </>
              ) : outputDataUrl ? (
                <>
                  {sourceDataUrl && (
                    <span className="absolute left-3 top-3 z-10 rounded-md bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
                      编辑后
                    </span>
                  )}
                  <img
                    src={outputDataUrl}
                    data-image-id={outputImageId}
                    data-output-image-ids={latestTask.outputImages.join(',')}
                    alt="图片编辑结果"
                    className="saveable-image max-h-[70vh] max-w-full object-contain"
                    onLoad={(event) => {
                      const image = event.currentTarget
                      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                        setOutputDimensions({ width: image.naturalWidth, height: image.naturalHeight })
                      }
                    }}
                  />
                </>
              ) : (
                <span className="text-sm text-[var(--text-3)]">正在读取结果…</span>
              )}
            </button>
            <div className="flex flex-col justify-between gap-4">
              <div>
                <div className="ui-eyebrow">本次编辑要求</div>
                <div data-selectable-text className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--text-1)]">
                  {latestTask.imageEditContext?.userInstruction || draft.instruction}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2.5 text-xs">
                  <div className="ui-inset px-3.5 py-2.5">
                    <div className="text-[var(--text-3)]">实际尺寸</div>
                    <div className="mt-1 font-bold text-[var(--text-1)]">
                      {outputDimensions ? `${outputDimensions.width} × ${outputDimensions.height} px` : '读取中…'}
                    </div>
                    <div className="mt-1 text-[10px] text-[var(--text-3)]">请求：{latestTask.params.size}</div>
                  </div>
                  <div className="ui-inset px-3.5 py-2.5">
                    <div className="text-[var(--text-3)]">参考图</div>
                    <div className="mt-1 font-bold text-[var(--text-1)]">
                      {latestTask.imageEditContext?.referenceImageIds.length ?? 0} 张
                    </div>
                  </div>
                </div>
              </div>
              <div className="grid gap-2.5">
                <button type="button" onClick={continueEditing} className="ui-btn ui-btn-primary h-10">
                  <EditResultIcon />
                  继续编辑
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setLightboxImageId(outputImageId, latestTask.outputImages)}
                    className="ui-btn h-9"
                  >
                    查看
                  </button>
                  <button
                    type="button"
                    onClick={() => void downloadImageIds([outputImageId], `image-edit-${latestTask.id}`)}
                    className="ui-btn h-9"
                  >
                    <DownloadIcon className="h-4 w-4" />
                    下载
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="ui-empty min-h-48">任务已完成，但没有可用输出</div>
        )}
      </section>

      {pickerMode && (
        <HistoryImagePicker
          mode={pickerMode}
          tasks={tasks}
          onSelect={handleHistorySelect}
          onClose={() => setPickerMode(null)}
        />
      )}
    </div>
  )
}

function EditResultIcon() {
  return <ArrowIcon className="h-4 w-4" />
}
