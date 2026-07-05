import { useMemo, useRef, useState } from 'react'
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
  type VocReviewEnvelope,
} from '../lib/vocAmazonReviewsApi'
import { copyTextToClipboard, getClipboardFailureMessage } from '../lib/clipboard'
import Select from './Select'
import { CloseIcon, CodeIcon, CopyIcon, DownloadIcon, EditIcon, ImportIcon, RefreshIcon, SettingsIcon } from './icons'

type SourceMode = 'asin' | 'csv'

const FIELD_CLASS = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20 dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-100 dark:placeholder:text-gray-500'
const LABEL_CLASS = 'mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400'

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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const [sourceMode, setSourceMode] = useState<SourceMode>('asin')
  const [asin, setAsin] = useState('')
  const [market, setMarket] = useState('US')
  const [limit, setLimit] = useState(100)
  const [productName, setProductName] = useState('')
  const [csvText, setCsvText] = useState('')
  const [reviewsEnvelope, setReviewsEnvelope] = useState<VocReviewEnvelope | null>(null)
  const [aiReport, setAiReport] = useState('')
  const [statusText, setStatusText] = useState('')
  const [error, setError] = useState('')
  const [isFetching, setIsFetching] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [showVocConfig, setShowVocConfig] = useState(false)
  const [draftVocApiKey, setDraftVocApiKey] = useState(settings.vocApiKey)
  const [draftVocProfileId, setDraftVocProfileId] = useState(settings.vocProfileId)

  const vocProfile = getVocAnalysisProfile(settings)
  const profileValidation = (vocProfile ? validateApiProfile(vocProfile) : '未选择 VOC AI 配置') ?? ''
  const hasShulexKey = Boolean(settings.vocApiKey.trim())
  const vocAiProfileOptions = settings.profiles
    .filter(isAmazonPlannerProfile)
    .map((profile) => ({
      label: `${profile.name} · ${profile.model || profile.apiMode}`,
      value: profile.id,
    }))
  const normalizedDraftVocProfileId = vocAiProfileOptions.some((option) => option.value === draftVocProfileId)
    ? draftVocProfileId
    : (vocAiProfileOptions[0]?.value || '')
  const localSummary = useMemo(() => reviewsEnvelope ? createLocalVocSummary(reviewsEnvelope) : null, [reviewsEnvelope])
  const reportTitle = productName.trim() || reviewsEnvelope?.meta.asin || 'VOC 评论分析'
  const dashboardHtml = useMemo(
    () => localSummary ? renderVocDashboardHtml(reportTitle, localSummary, aiReport) : '',
    [aiReport, localSummary, reportTitle],
  )

  const stopCurrentTask = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsFetching(false)
    setIsAnalyzing(false)
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
    const controller = new AbortController()
    abortControllerRef.current = controller
    setError('')
    setAiReport('')
    setIsFetching(true)
    try {
      setStatusText('正在通过 Shulex OpenAPI 实时任务拉取 Amazon 评论')
      const envelope = await fetchShulexReviews({
        asin,
        market: normalizeVocMarket(market),
        limit,
        apiKey: settings.vocApiKey,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      setReviewsEnvelope(envelope)
      setStatusText([
        `已抓取 ${envelope.reviews.length} 条评论`,
        envelope.meta.totalAvailable ? `Shulex total：${envelope.meta.totalAvailable}` : '',
        envelope.meta.pagesFetched ? `页数：${envelope.meta.pagesFetched}` : '',
        '来源：实时任务',
        envelope.meta.status ? `状态：${envelope.meta.status}` : '',
      ].filter(Boolean).join('，'))
      showToast('VOC 评论数据已获取', 'success')
    } catch (err) {
      if (controller.signal.aborted) return
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      showToast(`VOC 拉取失败：${message}`, 'error')
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null
      setIsFetching(false)
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
    const controller = new AbortController()
    abortControllerRef.current = controller
    setError('')
    setIsAnalyzing(true)
    setStatusText('VOC AI 分析中')
    try {
      const prompt = buildVocAnalysisPrompt(reviewsEnvelope, productName, localSummary)
      const result = await callVocAnalysisApi(vocProfile, prompt, controller.signal)
      setAiReport(result)
      setStatusText('VOC AI 分析完成')
      showToast('VOC AI 分析已完成', 'success')
    } catch (err) {
      if (controller.signal.aborted) return
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      showToast(`VOC AI 分析失败：${message}`, 'error')
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null
      setIsAnalyzing(false)
    }
  }

  const copyReport = async () => {
    const text = aiReport || (localSummary ? JSON.stringify({ summary: localSummary, meta: reviewsEnvelope?.meta }, null, 2) : '')
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

  return (
    <>
    <section data-no-drag-select className="mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-gray-900">
      <div className="border-b border-gray-200 bg-gray-50/80 p-4 dark:border-white/[0.08] dark:bg-gray-950/70 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="inline-flex rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
              独立 VOC 评论分析板块
            </div>
            <h2 className="mt-3 text-xl font-black tracking-tight text-gray-950 dark:text-gray-50 sm:text-2xl">
              Amazon VOC 评论分析
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-500 dark:text-gray-400">
              ASIN 模式通过 Shulex OpenAPI 实时任务拉取 Amazon 评论；CSV 可直接解析，再由独立 VOC AI 配置生成痛点、卖点、Listing 建议和 HTML dashboard。
            </p>
          </div>
          <div className="grid min-w-[260px] gap-2 rounded-xl border border-gray-200 bg-white p-3 dark:border-white/[0.08] dark:bg-gray-900">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-gray-700 dark:text-gray-200">VOC AI</span>
              <span className={profileValidation ? 'text-amber-600 dark:text-amber-300' : 'text-emerald-600 dark:text-emerald-300'}>
                {profileValidation ? '待配置' : '已连接'}
              </span>
            </div>
            <div className="min-w-0 text-[12px] text-gray-500 dark:text-gray-400">
              {vocProfile ? `${vocProfile.name} · ${vocProfile.model}` : '未选择模型'}
            </div>
            <div className="text-[12px] text-gray-500 dark:text-gray-400">
              Shulex Key：{hasShulexKey ? '已配置' : '未配置'}
            </div>
            <button
              type="button"
              onClick={openVocConfig}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 text-xs font-medium text-gray-700 transition hover:bg-white dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/[0.06]"
            >
              <SettingsIcon className="h-3.5 w-3.5" />
              配置 VOC
            </button>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <div className="mb-4 inline-flex rounded-xl border border-gray-200 bg-gray-100 p-1 dark:border-white/[0.08] dark:bg-white/[0.04]">
          {([
            ['asin', 'ASIN 拉取'],
            ['csv', '文件导入'],
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setSourceMode(mode)}
              className={`h-8 rounded-lg px-3 text-sm font-medium transition ${sourceMode === mode ? 'bg-white text-gray-900 shadow-sm dark:bg-white/10 dark:text-white' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {sourceMode === 'asin' ? (
          <div className="grid gap-4 lg:grid-cols-[1fr_180px_170px]">
            <label>
              <span className={LABEL_CLASS}>Amazon ASIN</span>
              <input value={asin} onChange={(event) => setAsin(event.target.value.toUpperCase())} className={FIELD_CLASS} placeholder="例如 B08N5WRWNW" />
            </label>
            <label>
              <span className={LABEL_CLASS}>站点</span>
              <Select value={market} onChange={(value) => setMarket(String(value))} options={marketOptions} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none transition hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-white/[0.06]" />
            </label>
            <label>
              <span className={LABEL_CLASS}>评论数量</span>
              <input value={limit} onChange={(event) => updateLimit(Number(event.target.value))} type="number" min={1} max={SHULEX_REALTIME_MAX_REVIEWS} className={FIELD_CLASS} />
            </label>
            <div className="lg:col-span-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
              Shulex OpenAPI 实时任务受接口限制，最大 10 页，每页 10 条，因此最多抓取 {SHULEX_REALTIME_MAX_REVIEWS} 条评论。当前版本不再使用 Amazon 买家账号 Cookie。
            </div>
            {!hasShulexKey && (
              <div className="lg:col-span-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
                请先在系统设置里填写 Shulex OpenAPI Key。
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
            <div className="flex flex-col gap-3 rounded-xl border border-dashed border-gray-300 bg-gray-50/80 p-3 dark:border-white/[0.12] dark:bg-gray-950/40 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">CSV / XLSX 评论文件</div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">XLSX 默认读取第一个工作表；自动识别 review/body/content/评价/内容、rating/star/评分、date/日期列。</div>
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-white/[0.06]"
              >
                <ImportIcon className="h-4 w-4" />
                上传 CSV / XLSX
              </button>
            </div>
            <label>
              <span className={LABEL_CLASS}>或粘贴 CSV 内容</span>
              <textarea value={csvText} onChange={(event) => setCsvText(event.target.value)} className={`${FIELD_CLASS} min-h-[140px] resize-y`} placeholder="title,rating,body,date&#10;Great,5,Works great,2026-01-01" />
            </label>
          </div>
        )}

        <label className="mt-4 block">
          <span className={LABEL_CLASS}>产品名称（可选）</span>
          <input value={productName} onChange={(event) => setProductName(event.target.value)} className={FIELD_CLASS} placeholder="用于报告标题和 Listing 建议上下文" />
        </label>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {sourceMode === 'asin' ? (
            <button
              type="button"
              onClick={() => void fetchByAsin()}
              disabled={running || !hasShulexKey}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-amber-600 px-4 text-sm font-semibold text-white transition hover:bg-amber-500 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ImportIcon className="h-4 w-4" />
              抓取评论
            </button>
          ) : (
            <button
              type="button"
              onClick={() => parseCsvInput(csvText, 'paste')}
              disabled={running || !csvText.trim()}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-amber-600 px-4 text-sm font-semibold text-white transition hover:bg-amber-500 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CodeIcon className="h-4 w-4" />
              解析 CSV
            </button>
          )}
          <button
            type="button"
            onClick={() => void analyzeWithAi()}
            disabled={running || !reviewsEnvelope}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/[0.06]"
          >
            <EditIcon className="h-4 w-4" />
            VOC AI 分析
          </button>
          {running && (
            <button type="button" onClick={stopCurrentTask} className="inline-flex h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-200">
              <CloseIcon className="h-4 w-4" />
              停止
            </button>
          )}
          <button type="button" onClick={() => void copyReport()} disabled={!aiReport && !localSummary} className="inline-flex h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/[0.06]">
            <CopyIcon className="h-4 w-4" />
            复制报告
          </button>
          <button type="button" onClick={() => reviewsEnvelope && downloadText('voc-reviews.json', JSON.stringify(reviewsEnvelope, null, 2), 'application/json;charset=utf-8')} disabled={!reviewsEnvelope} className="inline-flex h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/[0.06]">
            <DownloadIcon className="h-4 w-4" />
            JSON
          </button>
          <button type="button" onClick={() => dashboardHtml && downloadText('voc-dashboard.html', dashboardHtml, 'text/html;charset=utf-8')} disabled={!dashboardHtml} className="inline-flex h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/[0.06]">
            <DownloadIcon className="h-4 w-4" />
            HTML
          </button>
          <button type="button" onClick={reset} className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 active:translate-y-px dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-200">
            <RefreshIcon className="h-4 w-4" />
            重置
          </button>
        </div>

        {statusText && <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">{statusText}</div>}
        {error && <div data-selectable-text className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-600 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-200">{error}</div>}

        {localSummary && (
          <div className="mt-5 grid gap-4 lg:grid-cols-[320px_1fr]">
            <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-4 dark:border-white/[0.08] dark:bg-gray-950/40">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">本地快速摘要</div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-white p-2 dark:bg-white/[0.04]"><div className="text-lg font-bold text-emerald-600">{formatPct(localSummary.sentiment.positive)}</div><div className="text-[11px] text-gray-500">正面</div></div>
                <div className="rounded-lg bg-white p-2 dark:bg-white/[0.04]"><div className="text-lg font-bold text-gray-600 dark:text-gray-200">{formatPct(localSummary.sentiment.neutral)}</div><div className="text-[11px] text-gray-500">中性</div></div>
                <div className="rounded-lg bg-white p-2 dark:bg-white/[0.04]"><div className="text-lg font-bold text-red-600">{formatPct(localSummary.sentiment.negative)}</div><div className="text-[11px] text-gray-500">负面</div></div>
              </div>
              <div className="mt-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{localSummary.summary}</div>
              <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">评论数：{reviewsEnvelope?.reviews.length ?? 0}</div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-gray-200 p-4 dark:border-white/[0.08]">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Top 痛点</div>
                <div className="mt-3 space-y-2">
                  {localSummary.painPoints.length ? localSummary.painPoints.map((item) => (
                    <div key={item.label} className="rounded-lg bg-red-50/70 p-2 text-xs text-red-800 dark:bg-red-400/10 dark:text-red-200">
                      <div className="font-semibold">{item.label} · {item.count}</div>
                      <div className="mt-1 line-clamp-2 opacity-80">{item.quote}</div>
                    </div>
                  )) : <div className="text-xs text-gray-500">暂无明显痛点信号</div>}
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 p-4 dark:border-white/[0.08]">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Top 卖点</div>
                <div className="mt-3 space-y-2">
                  {localSummary.sellingPoints.length ? localSummary.sellingPoints.map((item) => (
                    <div key={item.label} className="rounded-lg bg-emerald-50/70 p-2 text-xs text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-200">
                      <div className="font-semibold">{item.label} · {item.count}</div>
                      <div className="mt-1 line-clamp-2 opacity-80">{item.quote}</div>
                    </div>
                  )) : <div className="text-xs text-gray-500">暂无明显卖点信号</div>}
                </div>
              </div>
            </div>
          </div>
        )}

        {aiReport && (
          <div className="mt-5 rounded-xl border border-gray-200 bg-white p-4 dark:border-white/[0.08] dark:bg-gray-950/40">
            <div className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">VOC AI 报告</div>
            <pre data-selectable-text className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words font-sans text-[13px] leading-7 text-gray-800 dark:text-gray-100 custom-scrollbar">{aiReport}</pre>
          </div>
        )}
      </div>
    </section>
    {showVocConfig && (
      <div data-no-drag-select className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
        <div className="w-full max-w-lg rounded-2xl border border-white/60 bg-white p-5 shadow-2xl dark:border-white/[0.08] dark:bg-gray-900">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-bold text-gray-950 dark:text-gray-100">VOC 配置</div>
              <div className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                只配置 VOC 评论分析板块，不影响图片生成和拆图反推配置。
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowVocConfig(false)}
              className="rounded-lg p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
              aria-label="关闭"
            >
              <CloseIcon className="h-5 w-5" />
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
                options={vocAiProfileOptions.length ? vocAiProfileOptions : [{ label: '暂无 Chat/Responses 配置', value: '' }]}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none transition hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-white/[0.06]"
              />
            </label>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowVocConfig(false)}
              className="h-9 rounded-xl border border-gray-200 px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.06]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={saveVocConfig}
              className="h-9 rounded-xl bg-amber-600 px-4 text-sm font-semibold text-white transition hover:bg-amber-500"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
