import { type DragEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import {
  createLocalVocSummary,
  parseReviewsCsv,
  parseReviewsXlsx,
  renderVocDashboardHtml,
  VOC_TOPIC_NOTE,
  type VocInsightItem,
  type VocReviewEnvelope,
} from '../lib/vocAmazonReviewsApi'
import { copyTextToClipboard, getClipboardFailureMessage } from '../lib/clipboard'
import { ChartBarIcon, CodeIcon, CopyIcon, DownloadIcon, ImportIcon, RefreshIcon, UploadCloudIcon } from './icons'

function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function Topics({ title, items }: { title: string; items: VocInsightItem[] }) {
  return (
    <section className="ui-panel min-w-0 p-5">
      <h3 className="text-sm font-bold text-[var(--text-1)]">{title}</h3>
      {items.length ? (
        <ul className="mt-3.5 space-y-2.5">
          {items.map(({ label, count, quote }) => (
            <li key={label} className="rounded-xl border border-[var(--line)] bg-[var(--surface-inset)] p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-[var(--text-1)]">{label}</span>
                <span className="tabular-nums text-[var(--text-3)]">{count} 条评论</span>
              </div>
              <blockquote data-selectable-text className="mt-1.5 break-words text-[var(--text-2)]">
                {quote}
              </blockquote>
            </li>
          ))}
        </ul>
      ) : (
        <div className="ui-empty mt-3 min-h-[100px] text-xs">未匹配到预设主题</div>
      )}
    </section>
  )
}

export default function VocAmazonReviewsWorkspace() {
  const showToast = useStore((s) => s.showToast)
  const { productName, csvText, reviewsEnvelope, archivedReport, error } = useStore((s) => s.vocDraft)
  const setVocDraft = useStore((s) => s.setVocDraft)
  const resetVocDraft = useStore((s) => s.resetVocDraft)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importRequest = useRef(0)
  const [isFileDragging, setIsFileDragging] = useState(false)

  useEffect(
    () => () => {
      importRequest.current += 1
    },
    [],
  )

  const localSummary = useMemo(
    () => (reviewsEnvelope?.reviews.length ? createLocalVocSummary(reviewsEnvelope) : null),
    [reviewsEnvelope],
  )
  const reportTitle = productName.trim() || reviewsEnvelope?.meta?.asin || 'VOC 评论分析'

  const applyImport = (envelope: VocReviewEnvelope, text: string) => {
    setVocDraft({ reviewsEnvelope: envelope, csvText: text, archivedReport: '', error: '' })
    showToast(`已在本地分析 ${envelope.reviews.length} 条评论`, 'success')
  }

  const reportImportError = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    setVocDraft({ error: message })
    showToast(`评论导入失败：${message}`, 'error')
  }

  const importFile = async (file?: File) => {
    if (!file) return
    const request = ++importRequest.current
    try {
      if (
        /\.xlsx$/i.test(file.name) ||
        file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ) {
        const buffer = await file.arrayBuffer()
        if (request === importRequest.current) applyImport(parseReviewsXlsx(buffer), '')
      } else {
        const text = await file.text()
        if (request === importRequest.current) applyImport(parseReviewsCsv(text), text)
      }
    } catch (err) {
      if (request === importRequest.current) reportImportError(err)
    }
  }

  const analyzePastedText = () => {
    importRequest.current += 1
    try {
      applyImport(parseReviewsCsv(csvText, 'paste'), csvText)
    } catch (err) {
      reportImportError(err)
    }
  }

  const copyReport = async () => {
    if (!localSummary) return
    try {
      const topics = (items: VocInsightItem[]) =>
        items.length
          ? items.map(({ label, count, quote }) => `- ${label}：${count} 条评论\n  ${quote}`).join('\n')
          : '未匹配到预设主题'
      await copyTextToClipboard(
        [
          `# ${reportTitle}`,
          localSummary.summary,
          VOC_TOPIC_NOTE,
          `## 低星评论常见主题\n${topics(localSummary.lowRatingTopics)}`,
          `## 高星评论常见主题\n${topics(localSummary.highRatingTopics)}`,
          ...(localSummary.otherTopics.length
            ? [`## 中间星级或未评分评论常见主题\n${topics(localSummary.otherTopics)}`]
            : []),
        ].join('\n\n'),
      )
      showToast('VOC 内容已复制', 'success')
    } catch (err) {
      showToast(getClipboardFailureMessage('复制失败', err), 'error')
    }
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setIsFileDragging(false)
    void importFile(event.dataTransfer.files[0])
  }

  const reset = () => {
    importRequest.current += 1
    resetVocDraft()
  }

  return (
    <div data-no-drag-select className="animate-fade-up space-y-4 pb-8">
      <header className="ui-panel flex items-center gap-3 px-4 py-3.5 sm:px-5">
        <div className="ui-page-icon h-10 w-10 shrink-0 rounded-xl" aria-hidden="true">
          <ChartBarIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="ui-title text-lg">Amazon VOC 评论分析</h2>
            <span className="ui-badge ui-badge-success">本地分析</span>
          </div>
          <p className="mt-0.5 text-xs text-[var(--text-3)]">
            导入已有评论，查看星级分布和常见主题。无需 API Key，不会上传评论。
          </p>
        </div>
      </header>

      <section className="ui-panel space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[var(--text-1)]">导入评论</h3>
          {reviewsEnvelope && (
            <span className="ui-badge ui-badge-accent">已加载 {reviewsEnvelope.reviews.length} 条评论</span>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          aria-label="评论文件"
          onChange={(event) => {
            void importFile(event.currentTarget.files?.[0])
            event.currentTarget.value = ''
          }}
        />
        <div
          onDragOver={(event) => {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
            setIsFileDragging(true)
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsFileDragging(false)
          }}
          onDrop={handleDrop}
          data-dragging={isFileDragging ? 'true' : undefined}
          className="ui-dropzone min-h-[112px] w-full flex-col gap-2 px-5 py-4 sm:flex-row sm:justify-between sm:text-left"
        >
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <span className="ui-dropzone-icon h-10 w-10 shrink-0 rounded-xl" aria-hidden="true">
              <UploadCloudIcon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-bold text-[var(--text-1)]">
                {isFileDragging ? '松开鼠标以导入评论' : '拖入或上传 CSV / XLSX 评论文件'}
              </p>
              <p className="mt-0.5 text-xs text-[var(--text-3)]">
                首行为列名，至少需要正文（body / review / 内容）；评分、标题和日期可选。XLSX 读取第一个工作表。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="ui-btn ui-btn-soft h-9 shrink-0"
          >
            <ImportIcon className="h-4 w-4" /> 上传 CSV / XLSX
          </button>
        </div>
        <label className="block">
          <span className="ui-label">或粘贴 CSV / Excel 表格</span>
          <textarea
            value={csvText}
            onChange={(event) => {
              importRequest.current += 1
              setVocDraft({ csvText: event.target.value })
            }}
            className="ui-input min-h-[140px] resize-y font-mono text-xs"
            placeholder={'title,rating,body,date\nGreat,5,Works great,2026-01-01'}
          />
        </label>
        <label className="block">
          <span className="ui-label">产品名称（可选）</span>
          <input
            value={productName}
            onChange={(event) => setVocDraft({ productName: event.target.value })}
            className="ui-input"
            placeholder="用于报告标题"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-4">
          <button
            type="button"
            onClick={analyzePastedText}
            disabled={!csvText.trim()}
            className="ui-btn ui-btn-primary h-10 px-5 text-sm"
          >
            <CodeIcon className="h-4 w-4" /> 分析粘贴内容
          </button>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <button type="button" onClick={() => void copyReport()} disabled={!localSummary} className="ui-btn h-9">
              <CopyIcon className="h-4 w-4" /> 复制报告
            </button>
            <button
              type="button"
              onClick={() =>
                downloadText(
                  'voc-reviews.json',
                  JSON.stringify(reviewsEnvelope, null, 2),
                  'application/json;charset=utf-8',
                )
              }
              disabled={!reviewsEnvelope}
              className="ui-btn h-9"
            >
              <DownloadIcon className="h-4 w-4" /> JSON
            </button>
            <button
              type="button"
              onClick={() =>
                localSummary &&
                downloadText(
                  'voc-dashboard.html',
                  renderVocDashboardHtml(reportTitle, localSummary),
                  'text/html;charset=utf-8',
                )
              }
              disabled={!localSummary}
              className="ui-btn h-9"
            >
              <DownloadIcon className="h-4 w-4" /> HTML
            </button>
            <button type="button" onClick={reset} className="ui-btn ui-btn-ghost h-9">
              <RefreshIcon className="h-4 w-4" /> 重置
            </button>
          </div>
        </div>
        {error && (
          <div role="alert" data-selectable-text className="ui-callout ui-callout-danger text-xs">
            {error}
            {reviewsEnvelope && '；仍显示上一次成功导入的结果。'}
          </div>
        )}
      </section>

      {localSummary && (
        <div className="space-y-4">
          <section className="ui-panel p-5">
            <h3 className="text-sm font-bold text-[var(--text-1)]">星级分布</h3>
            <p className="mt-2 text-sm text-[var(--text-2)]">{localSummary.summary}</p>
            <p className="mt-1 text-xs text-[var(--text-3)]">{VOC_TOPIC_NOTE}</p>
          </section>
          <div className="grid gap-4 md:grid-cols-2">
            <Topics title="低星评论常见主题" items={localSummary.lowRatingTopics} />
            <Topics title="高星评论常见主题" items={localSummary.highRatingTopics} />
            {localSummary.otherTopics.length > 0 && (
              <Topics title="中间星级或未评分评论常见主题" items={localSummary.otherTopics} />
            )}
          </div>
        </div>
      )}
      {archivedReport && (
        <details className="ui-panel p-5">
          <summary className="cursor-pointer text-sm font-bold text-[var(--text-1)]">历史报告（只读）</summary>
          <pre
            data-selectable-text
            className="custom-scrollbar mt-3 max-h-[560px] overflow-auto whitespace-pre-wrap break-words text-sm text-[var(--text-2)]"
          >
            {archivedReport}
          </pre>
        </details>
      )}
    </div>
  )
}
