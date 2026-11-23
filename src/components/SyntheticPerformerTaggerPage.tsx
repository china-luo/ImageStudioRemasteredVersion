import { useEffect, useMemo, useRef, useState } from 'react'
import { zipSync } from 'fflate'
import { useStore } from '../store'
import {
  getSyntheticPerformerMediaFormat,
  getSyntheticPerformerMediaValidationError,
  MAX_SYNTHETIC_PERFORMER_BATCH_BYTES,
  processSyntheticPerformerFile,
  SYNTHETIC_PERFORMER_KEYWORD,
  type TaggedSyntheticPerformerFile,
} from '../lib/syntheticPerformerMetadata'
import { CloseIcon, DownloadIcon, TagIcon, TrashIcon, UploadCloudIcon } from './icons'

type QueueStatus = 'queued' | 'processing' | 'success' | 'skipped' | 'error'

type QueueItem = {
  id: string
  key: string
  file: File
  status: QueueStatus
  output?: TaggedSyntheticPerformerFile
  error?: string
}

const FORMAT_LABELS = {
  jpeg: 'JPEG',
  png: 'PNG',
  webp: 'WebP',
  mp4: 'MP4',
  mov: 'MOV',
} as const

let nextQueueId = 0

function createQueueId() {
  nextQueueId += 1
  return `synthetic-performer-${Date.now().toString(36)}-${nextQueueId}`
}

function fileKey(file: File) {
  return [file.name, file.size, file.lastModified].join('\u0000')
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatTimeStamp(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noreferrer'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function bytesToBlob(bytes: Uint8Array, type: string) {
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  return new Blob([copy.buffer], { type })
}

function uniqueArchiveName(fileName: string, usedNames: Set<string>) {
  if (!usedNames.has(fileName)) {
    usedNames.add(fileName)
    return fileName
  }

  const extensionIndex = fileName.lastIndexOf('.')
  const stem = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName
  const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : ''
  let index = 2
  let candidate = `${stem}__${index}${extension}`
  while (usedNames.has(candidate)) {
    index += 1
    candidate = `${stem}__${index}${extension}`
  }
  usedNames.add(candidate)
  return candidate
}

function nextPaint() {
  return new Promise<void>((resolve) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve())
    } else {
      globalThis.setTimeout(resolve, 0)
    }
  })
}

function StatusMark({ status }: { status: QueueStatus }) {
  if (status === 'processing')
    return (
      <span
        className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-500/30 border-t-blue-500"
        aria-label="处理中"
      />
    )
  if (status === 'success')
    return (
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300"
        aria-label="已完成"
      >
        ✓
      </span>
    )
  if (status === 'skipped')
    return (
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]"
        aria-label="已包含标记"
      >
        ✓
      </span>
    )
  if (status === 'error')
    return (
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-400/15 dark:text-red-300"
        aria-label="失败"
      >
        !
      </span>
    )
  return <span className="h-2 w-2 rounded-full bg-[var(--line-strong)]" aria-label="待处理" />
}

function statusLabel(status: QueueStatus) {
  switch (status) {
    case 'processing':
      return '正在写入并验证'
    case 'success':
      return '已验证 XMP'
    case 'skipped':
      return '已包含标记，不输出'
    case 'error':
      return '处理失败'
    default:
      return '等待处理'
  }
}

function FilePreview({ file, format }: { file: File; format: keyof typeof FORMAT_LABELS | null }) {
  const [source, setSource] = useState<string | null>(null)
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    setHasError(false)
    if (!format) {
      setSource(null)
      return
    }

    const objectUrl = URL.createObjectURL(file)
    setSource(objectUrl)
    return () => {
      URL.revokeObjectURL(objectUrl)
    }
  }, [file, format])

  if (!source || hasError) {
    return (
      <div
        className="flex h-12 w-20 shrink-0 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--surface-inset)] text-[10px] font-semibold text-[var(--text-3)]"
        aria-label={`${format ? FORMAT_LABELS[format] : '媒体'}预览不可用`}
      >
        {format ? FORMAT_LABELS[format] : '媒体'}
      </div>
    )
  }

  if (format === 'jpeg' || format === 'png' || format === 'webp') {
    return (
      <img
        src={source}
        alt={`${file.name} 预览`}
        className="h-12 w-20 shrink-0 rounded-lg border border-[var(--line)] bg-[var(--surface-inset)] object-contain"
        onError={() => setHasError(true)}
      />
    )
  }

  return (
    <video
      src={source}
      muted
      playsInline
      preload="metadata"
      aria-label={`${file.name} 预览`}
      className="h-12 w-20 shrink-0 rounded-lg border border-[var(--line)] bg-[var(--surface-inset)] object-cover"
      onError={() => setHasError(true)}
    />
  )
}

export default function SyntheticPerformerTaggerPage() {
  const showToast = useStore((state) => state.showToast)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<QueueItem[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isRunning, setIsRunning] = useState(false)

  const totalBytes = useMemo(() => items.reduce((total, item) => total + item.file.size, 0), [items])
  const pendingCount = items.filter((item) => item.status === 'queued' || item.status === 'error').length
  const successCount = items.filter((item) => item.status === 'success').length
  const skippedCount = items.filter((item) => item.status === 'skipped').length
  const errorCount = items.filter((item) => item.status === 'error').length
  const completedCount = successCount + skippedCount + errorCount
  const progressPct = items.length > 0 ? Math.round((completedCount / items.length) * 100) : 0

  const addFiles = (fileList: FileList | File[]) => {
    if (isRunning) return
    const existingKeys = new Set(items.map((item) => item.key))
    let nextTotal = totalBytes
    const accepted: QueueItem[] = []
    const rejected: string[] = []

    for (const file of Array.from(fileList)) {
      const validationError = getSyntheticPerformerMediaValidationError(file)
      if (validationError) {
        rejected.push(validationError)
        continue
      }
      const key = fileKey(file)
      if (existingKeys.has(key)) continue
      if (nextTotal + file.size > MAX_SYNTHETIC_PERFORMER_BATCH_BYTES) {
        rejected.push(`添加「${file.name}」后会超过单批 1 GB 限制`)
        continue
      }
      existingKeys.add(key)
      nextTotal += file.size
      accepted.push({ id: createQueueId(), key, file, status: 'queued' })
    }

    if (accepted.length > 0) setItems((current) => [...current, ...accepted])
    if (rejected.length > 0) {
      const detail = rejected.length === 1 ? rejected[0] : `已忽略 ${rejected.length} 个文件：${rejected[0]}`
      showToast(detail, 'error')
    } else if (accepted.length === 0 && fileList.length > 0) {
      showToast('这些文件已经在当前列表中', 'info')
    }
  }

  const removeItem = (id: string) => {
    if (isRunning) return
    setItems((current) => current.filter((item) => item.id !== id))
  }

  const clearQueue = () => {
    if (isRunning) return
    setItems([])
  }

  const resetQueue = () => {
    if (isRunning) return
    setItems([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const deliverOutputs = (outputs: QueueItem[]) => {
    if (outputs.length === 0) return
    if (outputs.length === 1) {
      const output = outputs[0].output
      if (!output) return
      downloadBlob(output.blob, outputs[0].file.name)
      showToast('已下载带 XMP 标记的文件', 'success')
      return
    }

    try {
      const usedNames = new Set<string>()
      const zipFiles: Record<string, Uint8Array> = {}
      for (const item of outputs) {
        if (!item.output) continue
        zipFiles[uniqueArchiveName(item.file.name, usedNames)] = item.output.bytes
      }
      const zipped = zipSync(zipFiles, { level: 0 })
      downloadBlob(bytesToBlob(zipped, 'application/zip'), `amazon-ai-person-tagged_${formatTimeStamp()}.zip`)
      showToast(`已下载 ${outputs.length} 个带标记文件的 ZIP`, 'success')
    } catch (error) {
      showToast(`ZIP 打包失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  const startTagging = async () => {
    if (isRunning || pendingCount === 0) return
    const pending = items.filter((item) => item.status === 'queued' || item.status === 'error')
    setIsRunning(true)
    const successful: QueueItem[] = []
    const skipped: QueueItem[] = []

    for (const item of pending) {
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id ? { ...candidate, status: 'processing', error: undefined } : candidate,
        ),
      )
      await nextPaint()
      try {
        const result = await processSyntheticPerformerFile(item.file)
        if (result.kind === 'already-tagged') {
          const completed = { ...item, status: 'skipped' as const, output: undefined, error: undefined }
          skipped.push(completed)
          setItems((current) => current.map((candidate) => (candidate.id === item.id ? completed : candidate)))
          continue
        }
        const output = result.output
        const completed = { ...item, status: 'success' as const, output, error: undefined }
        successful.push(completed)
        setItems((current) => current.map((candidate) => (candidate.id === item.id ? completed : candidate)))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setItems((current) =>
          current.map((candidate) =>
            candidate.id === item.id ? { ...candidate, status: 'error', error: message } : candidate,
          ),
        )
      }
    }

    setIsRunning(false)
    if (successful.length > 0) deliverOutputs(successful)
    if (successful.length === 0 && skipped.length > 0)
      showToast(`已跳过 ${skipped.length} 个已包含标记的文件，没有生成下载`, 'info')
    if (successful.length === 0 && skipped.length === 0) showToast('没有文件完成打标，请检查失败原因后重试', 'error')
  }

  return (
    <div data-no-drag-select className="animate-fade-up pb-8">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
        className="hidden"
        onChange={(event) => {
          addFiles(Array.from(event.target.files ?? []))
          event.currentTarget.value = ''
        }}
      />

      <section className="ui-panel mb-4 flex flex-col gap-3 px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="ui-page-icon h-10 w-10 rounded-xl" aria-hidden="true">
            <TagIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="ui-title text-lg">AI 人物打标</h2>
              <span className="ui-badge ui-badge-accent">
                <span className="ui-dot" />
                本地处理
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-[var(--text-3)]">
              拖入图片或视频，一键写入 Amazon 要求的 XMP 披露标记，全程本地不上传媒体
            </p>
          </div>
        </div>
        <div className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-inset)] px-3 py-1.5 text-xs">
          <TagIcon className="h-3.5 w-3.5 text-[var(--accent)]" />
          <code className="font-mono text-[11px] font-medium text-[var(--text-1)]">{SYNTHETIC_PERFORMER_KEYWORD}</code>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <section className="ui-panel overflow-hidden p-5">
          <button
            type="button"
            data-dragging={isDragging ? 'true' : undefined}
            className="ui-dropzone group min-h-52 w-full px-6"
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault()
              setIsDragging(true)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={(event) => {
              event.preventDefault()
              setIsDragging(false)
            }}
            onDrop={(event) => {
              event.preventDefault()
              setIsDragging(false)
              addFiles(Array.from(event.dataTransfer.files))
            }}
          >
            <span className="ui-dropzone-icon h-12 w-12 rounded-2xl transition group-hover:scale-105">
              <UploadCloudIcon className="h-6 w-6" />
            </span>
            <span className="mt-2.5 text-base font-bold text-[var(--text-1)]">
              {isDragging ? '松开鼠标以加入处理队列' : '拖入图片或视频'}
            </span>
            <span className="text-xs leading-5 text-[var(--text-2)]">
              或点击选择多个文件 · JPG、PNG、WebP、MP4、MOV
            </span>
            <span className="ui-btn ui-btn-sm mt-3">选择文件</span>
          </button>

          <div className="mt-5 flex items-center justify-between gap-3">
            <div>
              <p className="ui-section-title text-sm">本次媒体</p>
              <p className="mt-0.5 text-xs text-[var(--text-3)]">
                {items.length > 0 ? `${items.length} 个文件 · ${formatBytes(totalBytes)}` : '尚未添加文件'}
              </p>
            </div>
            <button
              type="button"
              disabled={isRunning || items.length === 0}
              onClick={clearQueue}
              className="ui-btn ui-btn-ghost ui-btn-sm"
            >
              <TrashIcon className="h-3.5 w-3.5" />
              清空列表
            </button>
          </div>

          {items.length > 0 && (isRunning || completedCount > 0) && (
            <div className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--surface-inset)] p-3">
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="font-semibold text-[var(--text-1)]">
                  {isRunning ? '正在写入并验证 XMP 元数据…' : '本批处理进度'}
                </span>
                <span className="font-mono font-semibold tabular-nums text-[var(--text-2)]">
                  {completedCount}/{items.length} ({progressPct}%)
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--line)]">
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {items.length === 0 ? (
            <div className="ui-inset mt-3 flex min-h-28 items-center justify-center px-4 text-center text-xs text-[var(--text-3)]">
              文件会在这里排队，原文件不会被覆盖。
            </div>
          ) : (
            <div className="mt-3 divide-y divide-[var(--line)] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-solid)]">
              {items.map((item) => {
                const format = getSyntheticPerformerMediaFormat(item.file.name)
                return (
                  <div
                    key={item.id}
                    className={`flex min-w-0 items-center gap-3 px-3.5 py-3 transition hover:bg-[var(--surface-hover)] sm:px-4 ${
                      item.status === 'skipped' ? 'bg-[var(--accent-soft)]' : ''
                    }`}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[10px] font-bold text-[var(--accent)]">
                      {format ? FORMAT_LABELS[format] : '?'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[var(--text-1)]" title={item.file.name}>
                        {item.file.name}
                      </p>
                      <p className="mt-0.5 truncate text-[11.5px] text-[var(--text-3)]">
                        {formatBytes(item.file.size)} ·{' '}
                        <span className={item.status === 'skipped' ? 'font-semibold text-[var(--accent)]' : ''}>
                          {statusLabel(item.status)}
                        </span>
                        {item.error ? ` · ${item.error}` : ''}
                      </p>
                    </div>
                    <FilePreview file={item.file} format={format} />
                    <StatusMark status={item.status} />
                    {item.status === 'success' && item.output && (
                      <button
                        type="button"
                        aria-label={`下载 ${item.file.name}`}
                        title="单独下载"
                        onClick={() => downloadBlob(item.output!.blob, item.file.name)}
                        className="ui-icon-btn ui-icon-btn-sm text-[var(--accent)]"
                      >
                        <DownloadIcon className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={isRunning}
                      aria-label={`移除 ${item.file.name}`}
                      title="移除"
                      onClick={() => removeItem(item.id)}
                      className="ui-icon-btn ui-icon-btn-sm"
                    >
                      <CloseIcon className="h-4 w-4" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <aside className="ui-panel flex flex-col p-5 lg:sticky lg:top-[68px] lg:self-start">
          <p className="ui-eyebrow">Quick Tag</p>
          <h3 className="mt-1.5 text-lg font-bold tracking-tight text-[var(--text-1)]">准备写入标记</h3>
          <dl className="mt-4 divide-y divide-[var(--line)] text-xs">
            <div className="flex items-center justify-between py-2.5">
              <dt className="text-[var(--text-2)]">待处理</dt>
              <dd className="font-bold tabular-nums text-[var(--text-1)]">{pendingCount}</dd>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <dt className="text-[var(--text-2)]">新增标记</dt>
              <dd className="font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{successCount}</dd>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <dt className="text-[var(--text-2)]">已跳过</dt>
              <dd className="font-bold tabular-nums text-[var(--accent)]">{skippedCount}</dd>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <dt className="text-[var(--text-2)]">本批大小</dt>
              <dd className="font-bold tabular-nums text-[var(--text-1)]">{formatBytes(totalBytes)}</dd>
            </div>
          </dl>

          <div className="ui-callout ui-callout-warning mt-4 flex-col gap-1 text-[11.5px]">
            <p className="font-bold">请确认媒体适用</p>
            <p>本工具不会判断图片里是否有 AI 人物。点击后会直接写入标记，请只选择已确认需要披露的媒体。</p>
          </div>

          <button
            type="button"
            disabled={isRunning || pendingCount === 0}
            onClick={() => {
              void startTagging()
            }}
            className="ui-btn ui-btn-primary ui-btn-lg ui-btn-block mt-5"
          >
            <TagIcon className="h-4 w-4" />
            {isRunning ? '正在逐个打标…' : '一键写入 XMP 标记'}
          </button>
          {isRunning && <p className="mt-2 text-center text-[11px] text-[var(--text-3)]">正在本地处理，原文件不会被覆盖</p>}
          {!isRunning && errorCount > 0 && (
            <p className="mt-2 text-center text-[11px] font-medium text-[var(--danger)]">
              {errorCount} 个文件失败，可修正后重试
            </p>
          )}
          {!isRunning && items.length > 0 && (
            <button type="button" onClick={resetQueue} className="ui-btn ui-btn-ghost mt-2 w-full">
              重新选择
            </button>
          )}

          <div className="mt-auto border-t border-[var(--line)] pt-4 text-[11px] leading-5 text-[var(--text-3)]">
            <p>单文件上限 500 MB · 单批上限 1 GB</p>
            <p>处理完全在当前浏览器中进行，不会调用生图 API。</p>
          </div>
        </aside>
      </div>
    </div>
  )
}
