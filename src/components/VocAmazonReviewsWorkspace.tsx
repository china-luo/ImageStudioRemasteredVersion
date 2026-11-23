import { type DragEvent, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { getVocAnalysisProfile, isAmazonPlannerProfile, validateApiProfile } from '../lib/apiProfiles'
import {
  buildVocAnalysisPrompt,
  callVocAnalysisApi,
  createLocalVocSummary,
  fetchShulexReviews,
  normalizeVocMarket,
  parseReviewsCsv,
  parseReviewsXlsx,
  renderVocDashboardHtml,
  SHULEX_REALTIME_MAX_REVIEWS,
} from '../lib/vocAmazonReviewsApi'
import { assertVocHasValidReviews } from '../lib/workspaceDrafts'
import {
  finishWorkspaceAnalysis,
  isWorkspaceAnalysisCurrent,
  startWorkspaceAnalysis,
  stopWorkspaceAnalysis,
} from '../lib/workspaceAnalysis'
import { copyTextToClipboard, getClipboardFailureMessage } from '../lib/clipboard'
import Select from './Select'
import MarkdownRenderer from './MarkdownRenderer'
import {
  ChartBarIcon,
  CloseIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  EditIcon,
  ImportIcon,
  RefreshIcon,
  SettingsIcon,
  UploadCloudIcon,
} from './icons'

const FIELD_CLASS = 'ui-input'
const LABEL_CLASS = 'ui-label'

const marketOptions = [
  { label: 'US · amazon.com', value: 'US' },
  { label: 'CA · amazon.ca', value: 'CA' },
  { label: 'MX · amazon.com.mx', value: 'MX' },
  { label: 'GB · amazon.co.uk', value: 'GB' },
  { label: 'DE · amazon.de', value: 'DE' },
  { label: 'FR · amazon.fr', value: 'FR' },
  { label: 'IT · amazon.it', value: 'IT' },
  { label: 'ES · amazon.es', value: 'ES' },
  { label: 'JP · amazon.co.jp', value: 'JP' },
  { label: 'AU · amazon.com.au', value: 'AU' },
]

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

async function readFileText(file: File) {
  return file.text()
}

function isXlsxFile(file: File) {
  return /\.xlsx$/i.test(file.name) || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

function formatPct(value: number) {
  return `${Math.round(value)}%`
}

export default function VocAmazonReviewsWorkspace() {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const showToast = useStore((s) => s.showToast)
  const vocDraft = useStore((s) => s.vocDraft)
  const setVocDraft = useStore((s) => s.setVocDraft)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const sourceMode = vocDraft.sourceMode
  const asin = vocDraft.asin
  const market = vocDraft.market
  const limit = vocDraft.limit
  const productName = vocDraft.productName
  const csvText = vocDraft.csvText
  const reviewsEnvelope = vocDraft.reviewsEnvelope
  const aiReport = vocDraft.aiReport
  const statusText = vocDraft.statusText
  const error = vocDraft.error
  const setSourceMode = (nextSourceMode: typeof sourceMode) => setVocDraft({ sourceMode: nextSourceMode })
  const setAsin = (nextAsin: string) => setVocDraft({ asin: nextAsin })
  const setMarket = (nextMarket: string) => setVocDraft({ market: nextMarket })
  const setLimit = (nextLimit: number) => setVocDraft({ limit: nextLimit })
  const setProductName = (nextProductName: string) => setVocDraft({ productName: nextProductName })
  const setCsvText = (nextCsvText: string) => setVocDraft({ csvText: nextCsvText })
  const setReviewsEnvelope = (nextEnvelope: typeof reviewsEnvelope) => setVocDraft({ reviewsEnvelope: nextEnvelope })
  const setAiReport = (nextReport: string) => setVocDraft({ aiReport: nextReport })
  const setStatusText = (nextStatus: string) => setVocDraft({ statusText: nextStatus })
  const setError = (nextError: string) => setVocDraft({ error: nextError })
  const analysisStatus = useStore((s) => s.vocDraft.analysisStatus)
  const analysisOperation = useStore((s) => s.vocDraft.analysisOperation)
  const isFetching = analysisStatus === 'running' && analysisOperation === 'fetch'
  const isAnalyzing = analysisStatus === 'running' && analysisOperation === 'analyze'
  const [showVocConfig, setShowVocConfig] = useState(false)
  const [isCsvDragging, setIsCsvDragging] = useState(false)
  const [draftVocApiKey, setDraftVocApiKey] = useState(settings.vocApiKey)
  const [draftVocProfileId, setDraftVocProfileId] = useState(settings.vocProfileId)

  const vocProfile = getVocAnalysisProfile(settings)
  const profileValidation = (vocProfile ? validateApiProfile(vocProfile) : '未选择 VOC AI 配置') ?? ''
  const hasShulexKey = Boolean(settings.vocApiKey.trim())
  const vocAiProfileOptions = settings.profiles.filter(isAmazonPlannerProfile).map((profile) => ({
    label: `${profile.name} · ${profile.model || profile.apiMode}`,
    value: profile.id,
  }))
  const normalizedDraftVocProfileId = vocAiProfileOptions.some((option) => option.value === draftVocProfileId)
    ? draftVocProfileId
    : vocAiProfileOptions[0]?.value || ''
  const localSummary = useMemo(
    () => (reviewsEnvelope ? createLocalVocSummary(reviewsEnvelope) : null),
    [reviewsEnvelope],
  )
  const reportTitle = productName.trim() || reviewsEnvelope?.meta.asin || 'VOC 评论分析'
  const dashboardHtml = useMemo(
    () => (localSummary ? renderVocDashboardHtml(reportTitle, localSummary, aiReport) : ''),
    [aiReport, localSummary, reportTitle],
  )

  const stopCurrentTask = () => {
    stopWorkspaceAnalysis('voc')
    setVocDraft({ analysisStatus: 'stopped', analysisRequestId: null, analysisOperation: null })
    setStatusText('已停止')
  }

  const openVocConfig = () => {
    setDraftVocApiKey(settings.vocApiKey)
    setDraftVocProfileId(settings.vocProfileId)
    setShowVocConfig(true)
  }

  const saveVocConfig = () => {
    setSettings({
      vocApiKey: draftVocApiKey.trim(),
      vocProfileId: normalizedDraftVocProfileId || settings.vocProfileId,
    })
    setShowVocConfig(false)
    showToast('VOC 配置已保存', 'success')
  }

  const updateLimit = (value: number) => {
    setLimit(Math.max(1, Math.min(SHULEX_REALTIME_MAX_REVIEWS, Number(value) || 1)))
  }

  const fetchByAsin = async () => {
    const analysis = startWorkspaceAnalysis('voc')
    const controller = analysis.controller
    setVocDraft({
      analysisStatus: 'running',
      analysisRequestId: analysis.requestId,
      analysisStartedAt: Date.now(),
      analysisOperation: 'fetch',
    })
    setError('')
    setAiReport('')
    try {
      setStatusText('正在通过 Shulex OpenAPI 实时任务拉取 Amazon 评论')
      const envelope = await fetchShulexReviews({
        asin,
        market: normalizeVocMarket(market),
        limit,
        apiKey: settings.vocApiKey,
        signal: controller.signal,
      })
      if (controller.signal.aborted || !isWorkspaceAnalysisCurrent('voc', analysis.requestId)) return
      assertVocHasValidReviews(envelope)
      setReviewsEnvelope(envelope)
      setVocDraft({ analysisStatus: 'done', analysisRequestId: null, analysisOperation: null })
      setStatusText(
        [
          `已抓取 ${envelope.reviews.length} 条评论`,
          envelope.meta.totalAvailable ? `Shulex total：${envelope.meta.totalAvailable}` : '',
          envelope.meta.pagesFetched ? `页数：${envelope.meta.pagesFetched}` : '',
          '来源：实时任务',
          envelope.meta.status ? `状态：${envelope.meta.status}` : '',
        ]
          .filter(Boolean)
          .join('，'),
      )
      showToast('VOC 评论数据已获取', 'success')
    } catch (err) {
      if (controller.signal.aborted) return
      const message = err instanceof Error ? err.message : String(err)
      if (isWorkspaceAnalysisCurrent('voc', analysis.requestId)) {
        setVocDraft({ error: message, analysisStatus: 'error', analysisRequestId: null, analysisOperation: null })
      }
      showToast(`VOC 拉取失败：${message}`, 'error')
    } finally {
      finishWorkspaceAnalysis('voc', analysis.requestId)
    }
  }

  const parseCsvInput = (text: string, source: 'csv' | 'paste' = 'paste') => {
    setError('')
    setAiReport('')
    try {
      const envelope = parseReviewsCsv(text, source)
      setReviewsEnvelope(envelope)
      setStatusText(`已解析 ${envelope.reviews.length} 条评论`)
      showToast('CSV 评论已解析', 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      showToast(`CSV 解析失败：${message}`, 'error')
    }
  }

  const handleCsvFile = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    if (isXlsxFile(file)) {
      setError('')
      setAiReport('')
      try {
        const envelope = await parseReviewsXlsx(await file.arrayBuffer())
        setCsvText('')
        setReviewsEnvelope(envelope)
        setStatusText(`已解析 ${envelope.reviews.length} 条评论`)
        showToast('XLSX 评论已解析', 'success')
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        showToast(`XLSX 解析失败：${message}`, 'error')
      }
      return
    }
    const text = await readFileText(file)
    setCsvText(text)
    parseCsvInput(text, 'csv')
  }

  const analyzeWithAi = async () => {
    if (!reviewsEnvelope || !localSummary) {
      showToast('请先获取或解析评论数据', 'error')
      return
    }
    if (!vocProfile || profileValidation) {
      showToast(`请先配置 VOC AI：${profileValidation}`, 'error')
      return
    }
    const analysis = startWorkspaceAnalysis('voc')
    const controller = analysis.controller
    setVocDraft({
      analysisStatus: 'running',
      analysisRequestId: analysis.requestId,
      analysisStartedAt: Date.now(),
      analysisOperation: 'analyze',
    })
    setError('')
    setStatusText('VOC AI 分析中')
    try {
      const prompt = buildVocAnalysisPrompt(reviewsEnvelope, productName, localSummary)
      const result = await callVocAnalysisApi(vocProfile, prompt, controller.signal)
      if (!isWorkspaceAnalysisCurrent('voc', analysis.requestId)) return
      setAiReport(result)
      setVocDraft({ analysisStatus: 'done', analysisRequestId: null, analysisOperation: null })
      setStatusText('VOC AI 分析完成')
      showToast('VOC AI 分析已完成', 'success')
    } catch (err) {
      if (controller.signal.aborted) return
      const message = err instanceof Error ? err.message : String(err)
      if (isWorkspaceAnalysisCurrent('voc', analysis.requestId)) {
        setVocDraft({ error: message, analysisStatus: 'error', analysisRequestId: null, analysisOperation: null })
      }
      showToast(`VOC AI 分析失败：${message}`, 'error')
    } finally {
      finishWorkspaceAnalysis('voc', analysis.requestId)
    }
  }

  const copyReport = async () => {
    const text =
      aiReport || (localSummary ? JSON.stringify({ summary: localSummary, meta: reviewsEnvelope?.meta }, null, 2) : '')
    if (!text.trim()) {
      showToast('暂无可复制内容', 'error')
      return
    }
    try {
      await copyTextToClipboard(text)
      showToast('VOC 内容已复制', 'success')
    } catch (err) {
      showToast(getClipboardFailureMessage('复制失败', err), 'error')
    }
  }

  const reset = () => {
    stopCurrentTask()
    setAsin('')
    setProductName('')
    setCsvText('')
    setReviewsEnvelope(null)
    setAiReport('')
    setStatusText('')
    setError('')
  }

  const running = isFetching || isAnalyzing
  const maxPainCount = Math.max(1, ...(localSummary?.painPoints.map((item) => item.count) ?? [1]))
  const maxSellingCount = Math.max(1, ...(localSummary?.sellingPoints.map((item) => item.count) ?? [1]))

  const handleCsvDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    if (!isCsvDragging) setIsCsvDragging(true)
  }

  const handleCsvDragLeave = (event: DragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setIsCsvDragging(false)
  }

  const handleCsvDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setIsCsvDragging(false)
    if (event.dataTransfer.files?.length) {
      void handleCsvFile(event.dataTransfer.files)
    }
  }

  return (
    <>
      <div data-no-drag-select className="animate-fade-up space-y-4 pb-8">
        <div className="ui-panel flex flex-col gap-3 px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="ui-page-icon h-10 w-10 rounded-xl" aria-hidden="true">
              <ChartBarIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="ui-title text-lg">Amazon VOC 评论分析</h2>
                <span className={`ui-badge ${profileValidation ? 'ui-badge-warning' : 'ui-badge-success'}`}>
                  <span className="ui-dot" />
                  {profileValidation ? 'VOC AI 待配置' : vocProfile?.model || 'VOC AI 已连接'}
                </span>
                <span className={`ui-badge ${hasShulexKey ? 'ui-badge-success' : 'ui-badge-neutral'}`}>
                  Shulex {hasShulexKey ? '已配置' : '未配置'}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-[var(--text-3)]">
                支持 ASIN 实时拉取或 CSV/XLSX 导入，生成情绪分布、高频痛点卖点与可导出 HTML 看板
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={openVocConfig} className="ui-btn ui-btn-sm h-9">
              <SettingsIcon className="h-3.5 w-3.5" />
              配置 VOC
            </button>
          </div>
        </div>

        <section className="ui-panel overflow-hidden p-5 sm:p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="ui-segmented">
              {(
                [
                  ['asin', 'ASIN 拉取'],
                  ['csv', '文件导入'],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={sourceMode === mode}
                  data-active={sourceMode === mode}
                  onClick={() => setSourceMode(mode)}
                  className="ui-segment px-4"
                >
                  {label}
                </button>
              ))}
            </div>
            {reviewsEnvelope && (
              <span className="ui-badge ui-badge-accent">已加载 {reviewsEnvelope.reviews.length} 条评论</span>
            )}
          </div>

          {sourceMode === 'asin' ? (
            <div className="grid gap-4 lg:grid-cols-[1fr_196px_170px]">
              <label>
                <span className={LABEL_CLASS}>Amazon ASIN</span>
                <input
                  value={asin}
                  onChange={(event) => setAsin(event.target.value.toUpperCase())}
                  className={`${FIELD_CLASS} font-mono`}
                  placeholder="例如 B08N5WRWNW"
                />
              </label>
              <label>
                <span className={LABEL_CLASS}>站点</span>
                <Select
                  value={market}
                  onChange={(value) => setMarket(String(value))}
                  options={marketOptions}
                  className="ui-input h-10"
                />
              </label>
              <label>
                <span className={LABEL_CLASS}>评论数量</span>
                <input
                  value={limit}
                  onChange={(event) => updateLimit(Number(event.target.value))}
                  type="number"
                  min={1}
                  max={SHULEX_REALTIME_MAX_REVIEWS}
                  className={FIELD_CLASS}
                />
              </label>
              <div className="ui-callout ui-callout-warning lg:col-span-3 text-xs">
                Shulex OpenAPI 实时任务受接口限制，最大 10 页，每页 10 条，因此最多抓取 {SHULEX_REALTIME_MAX_REVIEWS}{' '}
                条评论。当前版本不再使用 Amazon 买家账号 Cookie。
              </div>
              {!hasShulexKey && (
                <div className="ui-callout ui-callout-warning lg:col-span-3 items-center justify-between text-xs">
                  <span>请先在系统设置里填写 Shulex OpenAPI Key。</span>
                  <button
                    type="button"
                    onClick={openVocConfig}
                    className="shrink-0 font-bold underline underline-offset-2"
                  >
                    立即配置 →
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(event) => void handleCsvFile(event.target.files)}
              />
              <div
                onDragOver={handleCsvDragOver}
                onDragLeave={handleCsvDragLeave}
                onDrop={handleCsvDrop}
                data-dragging={isCsvDragging ? 'true' : undefined}
                className="ui-dropzone min-h-[112px] w-full flex-col gap-2 px-5 py-4 sm:flex-row sm:justify-between sm:text-left"
              >
                <div className="flex flex-col items-center gap-3 sm:flex-row">
                  <span className="ui-dropzone-icon h-10 w-10 shrink-0 rounded-xl" aria-hidden="true">
                    <UploadCloudIcon className="h-5 w-5" />
                  </span>
                  <div>
                    <div className="text-sm font-bold text-[var(--text-1)]">
                      {isCsvDragging ? '松开鼠标以解析评论文件' : '拖入或上传 CSV / XLSX 评论文件'}
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--text-3)]">
                      XLSX 默认读取第一个工作表；自动识别 review/body/content/评价/内容、rating/star/评分、date/日期列。
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="ui-btn ui-btn-soft h-9 shrink-0"
                >
                  <ImportIcon className="h-4 w-4" />
                  上传 CSV / XLSX
                </button>
              </div>
              <label>
                <span className={LABEL_CLASS}>或粘贴 CSV 内容</span>
                <textarea
                  value={csvText}
                  onChange={(event) => setCsvText(event.target.value)}
                  className={`${FIELD_CLASS} min-h-[140px] resize-y font-mono text-xs`}
                  placeholder="title,rating,body,date&#10;Great,5,Works great,2026-01-01"
                />
              </label>
            </div>
          )}

          <label className="mt-4 block">
            <span className={LABEL_CLASS}>产品名称（可选）</span>
            <input
              value={productName}
              onChange={(event) => setProductName(event.target.value)}
              className={FIELD_CLASS}
              placeholder="用于报告标题和 Listing 建议上下文"
            />
          </label>

          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-5">
            {sourceMode === 'asin' ? (
              <button
                type="button"
                onClick={() => void fetchByAsin()}
                disabled={running || !hasShulexKey}
                className="ui-btn ui-btn-primary h-10 px-5 text-sm"
              >
                <ImportIcon className="h-4 w-4" />
                抓取评论
              </button>
            ) : (
              <button
                type="button"
                onClick={() => parseCsvInput(csvText, 'paste')}
                disabled={running || !csvText.trim()}
                className="ui-btn ui-btn-primary h-10 px-5 text-sm"
              >
                <CodeIcon className="h-4 w-4" />
                解析 CSV
              </button>
            )}
            <button
              type="button"
              onClick={() => void analyzeWithAi()}
              disabled={running || !reviewsEnvelope}
              className="ui-btn ui-btn-accent h-10 px-4 text-sm"
            >
              <EditIcon className="h-4 w-4" />
              VOC AI 分析
            </button>
            {running && (
              <button type="button" onClick={stopCurrentTask} className="ui-btn ui-btn-danger-soft h-10">
                <CloseIcon className="h-4 w-4" />
                停止
              </button>
            )}
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <button
                type="button"
                onClick={() => void copyReport()}
                disabled={!aiReport && !localSummary}
                className="ui-btn h-9"
              >
                <CopyIcon className="h-4 w-4" />
                复制报告
              </button>
              <button
                type="button"
                onClick={() =>
                  reviewsEnvelope &&
                  downloadText(
                    'voc-reviews.json',
                    JSON.stringify(reviewsEnvelope, null, 2),
                    'application/json;charset=utf-8',
                  )
                }
                disabled={!reviewsEnvelope}
                className="ui-btn h-9"
              >
                <DownloadIcon className="h-4 w-4" />
                JSON
              </button>
              <button
                type="button"
                onClick={() =>
                  dashboardHtml && downloadText('voc-dashboard.html', dashboardHtml, 'text/html;charset=utf-8')
                }
                disabled={!dashboardHtml}
                className="ui-btn h-9"
              >
                <DownloadIcon className="h-4 w-4" />
                HTML
              </button>
              <button type="button" onClick={reset} className="ui-btn ui-btn-ghost h-9">
                <RefreshIcon className="h-4 w-4" />
                重置
              </button>
            </div>
          </div>

          {statusText && (
            <div className="ui-callout ui-callout-accent mt-4 py-2.5 text-xs font-medium">{statusText}</div>
          )}
          {error && (
            <div data-selectable-text className="ui-callout ui-callout-danger mt-4 text-xs">
              {error}
            </div>
          )}
        </section>

        {localSummary && (
          <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <section className="ui-panel p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-[var(--text-1)]">情绪概览</h3>
                <span className="ui-badge">{reviewsEnvelope?.reviews.length ?? 0} 条评论</span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-inset)] p-2.5">
                  <div className="text-lg font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {formatPct(localSummary.sentiment.positive)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--text-3)]">正面</div>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-inset)] p-2.5">
                  <div className="text-lg font-extrabold tabular-nums text-[var(--text-2)]">
                    {formatPct(localSummary.sentiment.neutral)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--text-3)]">中性</div>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-inset)] p-2.5">
                  <div className="text-lg font-extrabold tabular-nums text-red-600 dark:text-red-400">
                    {formatPct(localSummary.sentiment.negative)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--text-3)]">负面</div>
                </div>
              </div>
              <div className="mt-3.5 flex h-2 overflow-hidden rounded-full bg-[var(--line)]">
                <div
                  className="bg-emerald-500 transition-all"
                  style={{ width: `${localSummary.sentiment.positive}%` }}
                />
                <div className="bg-zinc-400 transition-all" style={{ width: `${localSummary.sentiment.neutral}%` }} />
                <div className="bg-red-500 transition-all" style={{ width: `${localSummary.sentiment.negative}%` }} />
              </div>
              <div className="mt-3.5 text-xs leading-relaxed text-[var(--text-2)]">{localSummary.summary}</div>
            </section>

            <div className="grid gap-4 md:grid-cols-2">
              <section className="ui-panel p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[var(--text-1)]">Top 痛点</h3>
                  <span className="ui-badge ui-badge-danger">{localSummary.painPoints.length}</span>
                </div>
                <div className="mt-3.5 space-y-2.5">
                  {localSummary.painPoints.length ? (
                    localSummary.painPoints.map((item) => (
                      <div
                        key={item.label}
                        className="rounded-xl border border-[var(--line)] bg-[var(--surface-inset)] p-3 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-[var(--text-1)]">{item.label}</span>
                          <span className="font-mono text-[11px] font-bold tabular-nums text-red-600 dark:text-red-400">
                            {item.count} 次
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--line)]">
                          <div
                            className="h-full rounded-full bg-red-500/80 transition-all"
                            style={{ width: `${Math.max(10, Math.round((item.count / maxPainCount) * 100))}%` }}
                          />
                        </div>
                        <div className="mt-1.5 line-clamp-2 text-[var(--text-2)]">{item.quote}</div>
                      </div>
                    ))
                  ) : (
                    <div className="ui-empty min-h-[100px] text-xs">暂无明显痛点信号</div>
                  )}
                </div>
              </section>

              <section className="ui-panel p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[var(--text-1)]">Top 卖点</h3>
                  <span className="ui-badge ui-badge-success">{localSummary.sellingPoints.length}</span>
                </div>
                <div className="mt-3.5 space-y-2.5">
                  {localSummary.sellingPoints.length ? (
                    localSummary.sellingPoints.map((item) => (
                      <div
                        key={item.label}
                        className="rounded-xl border border-[var(--line)] bg-[var(--surface-inset)] p-3 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-[var(--text-1)]">{item.label}</span>
                          <span className="font-mono text-[11px] font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                            {item.count} 次
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--line)]">
                          <div
                            className="h-full rounded-full bg-emerald-500/85 transition-all"
                            style={{ width: `${Math.max(10, Math.round((item.count / maxSellingCount) * 100))}%` }}
                          />
                        </div>
                        <div className="mt-1.5 line-clamp-2 text-[var(--text-2)]">{item.quote}</div>
                      </div>
                    ))
                  ) : (
                    <div className="ui-empty min-h-[100px] text-xs">暂无明显卖点信号</div>
                  )}
                </div>
              </section>
            </div>
          </div>
        )}

        {aiReport && (
          <section className="ui-panel overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-5 py-3.5">
              <h3 className="text-sm font-bold text-[var(--text-1)]">VOC AI 分析报告</h3>
              <button type="button" onClick={() => void copyReport()} className="ui-btn ui-btn-soft ui-btn-sm">
                <CopyIcon className="h-3.5 w-3.5" />
                复制报告
              </button>
            </div>
            <div
              data-selectable-text
              className="custom-scrollbar max-h-[560px] overflow-auto p-5 text-sm leading-7 text-[var(--text-1)]"
            >
              <MarkdownRenderer content={aiReport} />
            </div>
          </section>
        )}
      </div>
      {showVocConfig && (
        <div data-no-drag-select className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="ui-backdrop animate-overlay-in absolute inset-0" onClick={() => setShowVocConfig(false)} />
          <div className="ui-modal animate-modal-in relative z-10 w-full max-w-lg p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-base font-bold text-[var(--text-1)]">VOC 配置</div>
                <div className="mt-1 text-xs leading-relaxed text-[var(--text-3)]">
                  只配置 VOC 评论分析板块，不影响图片生成和拆图反推配置。
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowVocConfig(false)}
                className="ui-icon-btn ui-icon-btn-sm"
                aria-label="关闭"
              >
                <CloseIcon className="h-[18px] w-[18px]" />
              </button>
            </div>

            <div className="mt-5 grid gap-4">
              <label>
                <span className={LABEL_CLASS}>Shulex OpenAPI Key（实时任务）</span>
                <input
                  value={draftVocApiKey}
                  onChange={(event) => setDraftVocApiKey(event.target.value)}
                  type="password"
                  className={FIELD_CLASS}
                  placeholder="用于 openapi.shulex.com 实时抓取，最多 100 条"
                />
              </label>
              <label>
                <span className={LABEL_CLASS}>VOC AI 模型</span>
                <Select
                  value={normalizedDraftVocProfileId}
                  onChange={(value) => setDraftVocProfileId(String(value))}
                  disabled={vocAiProfileOptions.length === 0}
                  options={
                    vocAiProfileOptions.length
                      ? vocAiProfileOptions
                      : [{ label: '暂无 Chat/Responses 配置', value: '' }]
                  }
                  className="ui-input h-10"
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2.5">
              <button type="button" onClick={() => setShowVocConfig(false)} className="ui-btn h-9">
                取消
              </button>
              <button type="button" onClick={saveVocConfig} className="ui-btn ui-btn-primary h-9 px-5">
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
