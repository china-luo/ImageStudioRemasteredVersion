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
import { CloseIcon, DownloadIcon, TagIcon, TrashIcon } from './icons'

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
        className="flex h-5 w-5 items-center justify-center rounded-full bg-[hsl(var(--ios-blue-tint))] text-[hsl(var(--primary))]"
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
  return <span className="h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600" aria-label="待处理" />
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
        className="flex h-14 w-24 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--muted)/0.86)] text-[10px] font-semibold text-gray-400 dark:text-gray-500"
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
        className="h-14 w-24 shrink-0 rounded-lg bg-[hsl(var(--muted)/0.86)] object-contain"
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
      className="h-14 w-24 shrink-0 rounded-lg bg-[hsl(var(--muted)/0.86)] object-cover"
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
    <div data-no-drag-select className="pb-8 pt-4 lg:pt-5">
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

      <section className="ios-material mb-4 overflow-hidden p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-semibold tracking-[-0.025em] text-gray-950 dark:text-gray-50">
                AI 人物打标
              </h2>
              <span className="rounded-full bg-[hsl(var(--ios-blue-tint))] px-2.5 py-1 text-[11px] font-semibold text-[hsl(var(--primary))]">
                本地处理
              </span>
            </div>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-gray-500 dark:text-gray-400">
              把需要披露的图片或视频拖进来，一键写入 Amazon 要求的 XMP 标记。不会识别人物，也不会上传媒体。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-white/[0.04] dark:text-gray-400">
            <TagIcon className="h-4 w-4 text-[hsl(var(--primary))]" />
            <code className="font-mono text-[11px] text-gray-700 dark:text-gray-200">
              {SYNTHETIC_PERFORMER_KEYWORD}
            </code>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="ios-material overflow-hidden p-4 sm:p-5">
          <button
            type="button"
            className={`group flex min-h-52 w-full flex-col items-center justify-center rounded-2xl border border-dashed px-6 text-center transition ${isDragging ? 'border-blue-500 bg-blue-50/80 dark:bg-blue-400/10' : 'border-gray-300 bg-gray-50/70 hover:border-blue-400 hover:bg-blue-50/60 dark:border-white/15 dark:bg-white/[0.025] dark:hover:bg-blue-400/[0.06]'}`}
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
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[hsl(var(--ios-blue-tint))] text-[hsl(var(--primary))] transition group-hover:scale-105">
              <TagIcon className="h-7 w-7" />
            </span>
            <span className="mt-4 text-base font-semibold text-gray-900 dark:text-gray-100">拖入图片或视频</span>
            <span className="mt-1.5 text-xs leading-5 text-gray-500 dark:text-gray-400">
              或点击选择多个文件 · JPG、PNG、WebP、MP4、MOV
            </span>
            <span className="mt-4 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm ring-1 ring-black/[0.06] dark:bg-white/[0.08] dark:text-gray-200 dark:ring-white/[0.08]">
              选择文件
            </span>
          </button>

          <div className="mt-5 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-wide text-gray-700 dark:text-gray-200">本次媒体</p>
              <p className="mt-0.5 text-[11px] text-gray-400">
                {items.length > 0 ? `${items.length} 个文件 · ${formatBytes(totalBytes)}` : '尚未添加文件'}
              </p>
            </div>
            <button
              type="button"
              disabled={isRunning || items.length === 0}
              onClick={clearQueue}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-35 dark:text-gray-400 dark:hover:bg-white/[0.08] dark:hover:text-gray-100"
            >
              <TrashIcon className="h-3.5 w-3.5" />
              清空列表
            </button>
          </div>

          {items.length === 0 ? (
            <div className="mt-3 flex min-h-28 items-center justify-center rounded-xl bg-gray-50/70 px-4 text-center text-xs text-gray-400 dark:bg-white/[0.025] dark:text-gray-500">
              文件会在这里排队，原文件不会被覆盖。
            </div>
          ) : (
            <div className="mt-3 divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100 bg-white/70 dark:divide-white/[0.06] dark:border-white/[0.08] dark:bg-white/[0.025]">
              {items.map((item) => {
                const format = getSyntheticPerformerMediaFormat(item.file.name)
                return (
                  <div
                    key={item.id}
                    className={`flex min-w-0 items-center gap-3 px-3 py-3 sm:px-4 ${item.status === 'skipped' ? 'bg-blue-50/55 dark:bg-blue-400/[0.06]' : ''}`}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--ios-blue-tint))] text-[10px] font-bold text-[hsl(var(--primary))]">
                      {format ? FORMAT_LABELS[format] : '?'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className="truncate text-sm font-medium text-gray-800 dark:text-gray-100"
                        title={item.file.name}
                      >
                        {item.file.name}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-gray-400">
                        {formatBytes(item.file.size)} ·{' '}
                        <span className={item.status === 'skipped' ? 'font-semibold text-[hsl(var(--primary))]' : ''}>
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
                        className="rounded-lg p-1.5 text-gray-400 transition hover:bg-[hsl(var(--ios-blue-tint))] hover:text-[hsl(var(--primary))]"
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
                      className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-white/[0.08] dark:hover:text-gray-200"
                    >
                      <CloseIcon className="h-4 w-4" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <aside className="ios-material flex flex-col p-4 sm:p-5">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-gray-400">QUICK TAG</p>
          <h3 className="mt-2 text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">准备写入标记</h3>
          <dl className="mt-5 divide-y divide-gray-100 text-xs dark:divide-white/[0.07]">
            <div className="flex items-center justify-between py-2.5">
              <dt className="text-gray-500 dark:text-gray-400">待处理</dt>
              <dd className="font-semibold text-gray-800 dark:text-gray-100">{pendingCount}</dd>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <dt className="text-gray-500 dark:text-gray-400">新增标记</dt>
              <dd className="font-semibold text-emerald-600 dark:text-emerald-300">{successCount}</dd>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <dt className="text-gray-500 dark:text-gray-400">已跳过</dt>
              <dd className="font-semibold text-[hsl(var(--primary))]">{skippedCount}</dd>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <dt className="text-gray-500 dark:text-gray-400">本批大小</dt>
              <dd className="font-semibold text-gray-800 dark:text-gray-100">{formatBytes(totalBytes)}</dd>
            </div>
          </dl>

          <div className="mt-4 rounded-xl bg-amber-50/80 p-3 text-[11px] leading-5 text-amber-800 dark:bg-amber-400/10 dark:text-amber-100/80">
            <p className="font-semibold">请确认媒体适用</p>
            <p className="mt-1">
              本工具不会判断图片里是否有 AI 人物。点击后会直接写入标记，请只选择已确认需要披露的媒体。
            </p>
          </div>

          <button
            type="button"
            disabled={isRunning || pendingCount === 0}
            onClick={() => {
              void startTagging()
            }}
            className="ios-button ios-button-filled mt-5 h-11 px-4 text-sm disabled:cursor-not-allowed"
          >
            <TagIcon className="h-4 w-4" />
            {isRunning ? '正在逐个打标…' : '一键写入 XMP 标记'}
          </button>
          {isRunning && <p className="mt-2 text-center text-[11px] text-gray-400">正在本地处理，原文件不会被覆盖</p>}
          {!isRunning && errorCount > 0 && (
            <p className="mt-2 text-center text-[11px] text-red-500">{errorCount} 个文件失败，可修正后重试</p>
          )}
          {!isRunning && items.length > 0 && (
            <button
              type="button"
              onClick={resetQueue}
              className="mt-2 inline-flex h-9 items-center justify-center rounded-xl px-3 text-xs font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.08] dark:hover:text-gray-100"
            >
              重新选择
            </button>
          )}

          <div className="mt-auto pt-5 text-[10px] leading-4 text-gray-400 dark:text-gray-500">
            <p>单文件上限 500 MB · 单批上限 1 GB</p>
            <p className="mt-1">处理完全在当前浏览器中进行，不会调用生图 API。</p>
          </div>
        </aside>
      </div>
    </div>
  )
}
