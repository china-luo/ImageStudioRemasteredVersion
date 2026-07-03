import type { ApiProfile } from '../types'
import { DEFAULT_CHAT_MODEL, DEFAULT_RESPONSES_MODEL } from './apiProfiles'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from './devProxy'
import { getApiErrorMessage } from './imageApiShared'
import { isEventStreamResponse, looksLikeServerSentEvents, readJsonServerSentEvents, readJsonServerSentEventText } from './serverSentEvents'

export interface VocReview {
  rating: number
  title: string
  body: string
  date?: string
  verified?: boolean
  variant?: string
  author?: string
  helpful?: number
  reviewId?: string
}

export interface VocReviewEnvelope {
  reviews: VocReview[]
  meta: {
    source: 'asin' | 'shulex' | 'csv' | 'paste'
    asin?: string
    market?: string
    totalAvailable?: number
    fetched?: number
    rowsInFile?: number
    rowsUsed?: number
    rowsDropped?: number
    columnsDetected?: Record<string, string | null>
    pagesFetched?: number
    status?: string
    diagnostics?: VocFetchDiagnostics
  }
}

export interface VocFetchDiagnostics {
  taskId?: string
  submitCode?: string | number
  submitMessage?: string
  queryCode?: string | number
  queryMessage?: string
  dataKeys?: string[]
  reviewArrayPath?: string
  candidateArrayPaths?: string[]
  requestedLimit?: number
  requestedMaxPage?: number
  requestedPageSize?: number
  totalAvailable?: number
  rawReviewCount?: number
  normalizedReviewCount?: number
  pages?: Array<{
    pageNo: number
    pageSize: number
    status?: string
    total?: number
    rawReviewCount: number
    normalizedReviewCount: number
    dataKeys?: string[]
    reviewArrayPath?: string
    candidateArrayPaths?: string[]
  }>
}

interface ShulexTaskResponse {
  code?: string | number
  message?: string
  msg?: string
  data?: {
    taskId?: string
    task_id?: string
  }
}

interface ShulexQueryResponse {
  code?: string | number
  message?: string
  msg?: string
  data?: {
    status?: string
    errorMsg?: string
    message?: string
    asin?: string
    market?: string
    total?: number
    totalCount?: number
    count?: number
    pageNo?: number
    pageSize?: number
    pageNum?: number
    pages?: number
    reviews?: Array<Record<string, unknown>>
  }
}

export interface VocLocalSummary {
  sentiment: {
    positive: number
    neutral: number
    negative: number
  }
  painPoints: VocInsightItem[]
  sellingPoints: VocInsightItem[]
  tips: string[]
  summary: string
}

export interface VocInsightItem {
  label: string
  count: number
  quote: string
}

const MARKET_ALIASES: Record<string, string> = {
  'amazon.com': 'US',
  us: 'US',
  'amazon.ca': 'CA',
  ca: 'CA',
  'amazon.com.mx': 'MX',
  mx: 'MX',
  'amazon.co.uk': 'GB',
  uk: 'GB',
  gb: 'GB',
  'amazon.de': 'DE',
  de: 'DE',
  'amazon.fr': 'FR',
  fr: 'FR',
  'amazon.it': 'IT',
  it: 'IT',
  'amazon.es': 'ES',
  es: 'ES',
  'amazon.co.jp': 'JP',
  jp: 'JP',
  'amazon.com.au': 'AU',
  au: 'AU',
}

const PAIN_KEYWORDS = [
  { label: '质量或耐用性问题', terms: ['broke', 'broken', 'defect', 'poor quality', 'cheap', 'durable', 'stopped working', 'fall apart', '裂', '坏', '质量', '耐用'] },
  { label: '尺寸或适配不符', terms: ['small', 'large', 'size', 'fit', 'fits', 'too big', 'too small', '尺寸', '太小', '太大', '不合适'] },
  { label: '使用体验复杂', terms: ['difficult', 'hard to', 'confusing', 'instruction', 'setup', 'install', '难用', '复杂', '安装'] },
  { label: '包装或运输损坏', terms: ['package', 'shipping', 'damaged', 'arrived', 'box', '包装', '运输', '破损'] },
  { label: '效果不符合预期', terms: ['does not work', "doesn't work", 'not work', 'weak', 'disappointed', 'waste', '没效果', '失望'] },
]

const SELLING_KEYWORDS = [
  { label: '易用性好', terms: ['easy', 'simple', 'convenient', 'quick', '方便', '简单', '易用'] },
  { label: '质量或做工好', terms: ['quality', 'sturdy', 'durable', 'well made', 'solid', '做工', '质量好', '结实'] },
  { label: '性价比高', terms: ['value', 'price', 'worth', 'affordable', '性价比', '划算', '价格'] },
  { label: '外观和设计好', terms: ['design', 'beautiful', 'looks', 'cute', 'style', '外观', '好看', '设计'] },
  { label: '功能达到预期', terms: ['works great', 'perfect', 'love', 'excellent', 'effective', '效果好', '满意'] },
]

export function normalizeVocMarket(value: string): string {
  const trimmed = value.trim()
  const alias = MARKET_ALIASES[trimmed.toLowerCase()]
  const normalized = alias ?? trimmed.toUpperCase()
  if (!['US', 'CA', 'MX', 'GB', 'DE', 'FR', 'IT', 'ES', 'JP', 'AU'].includes(normalized)) {
    throw new Error('不支持的站点。支持：US CA MX GB DE FR IT ES JP AU')
  }
  return normalized
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value) || 0
}

function normalizeShulexReview(review: Record<string, unknown>): VocReview {
  return {
    rating: readNumber(review.rating),
    title: readString(review.title),
    body: readString(review.body) || readString(review.content),
    date: readString(review.reviewDate) || readString(review.date),
    verified: Boolean(review.verified || review.verifiedPurchase),
    variant: readString(review.variant),
    author: readString(review.author) || readString(review.reviewerName),
    helpful: readNumber(review.helpfulVotes ?? review.helpful),
    reviewId: readString(review.reviewId),
  }
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readObjectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : []
}

function readFirstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const numberValue = readNumber(value)
    if (numberValue > 0) return numberValue
  }
  return undefined
}

function collectArrayPaths(value: unknown, path = 'data', depth = 0): string[] {
  if (depth > 3 || !value || typeof value !== 'object') return []
  if (Array.isArray(value)) return [path]
  const paths: string[] = []
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(child)) {
      paths.push(`${path}.${key}`)
    } else if (child && typeof child === 'object') {
      paths.push(...collectArrayPaths(child, `${path}.${key}`, depth + 1))
    }
  }
  return paths
}

function getValueByPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => readObject(current)[key], value)
}

function extractShulexReviewRecords(data: ShulexQueryResponse['data']): {
  reviews: Array<Record<string, unknown>>
  path?: string
  candidateArrayPaths: string[]
} {
  const record = readObject(data)
  const candidatePaths = [
    'data.reviews',
    'data.reviewList',
    'data.list',
    'data.records',
    'data.items',
    'data.rows',
    'data.data.reviews',
    'data.data.list',
    'data.result.reviews',
    'data.result.list',
  ]
  for (const path of candidatePaths) {
    const reviews = readObjectArray(getValueByPath({ data: record }, path))
    if (reviews.length) return { reviews, path, candidateArrayPaths: collectArrayPaths(record) }
  }
  return {
    reviews: [],
    path: undefined,
    candidateArrayPaths: collectArrayPaths(record),
  }
}

async function readShulexJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`Shulex 返回了非 JSON 内容：${text.slice(0, 500)}`)
  }
}

function isShulexSuccessCode(code: unknown) {
  return code === 0 || code === '0'
}

function isShulexTaskSuccess(status: string) {
  return ['SUCCESS', 'FINISHED', 'FINISH', 'COMPLETED', 'DONE'].includes(status.toUpperCase())
}

function isShulexTaskFailure(status: string) {
  return ['FAILED', 'FAIL', 'ERROR', 'CANCELED', 'CANCELLED'].includes(status.toUpperCase())
}

export async function fetchShulexReviews(options: {
  asin: string
  market: string
  limit: number
  apiKey: string
  signal?: AbortSignal
}): Promise<VocReviewEnvelope> {
  const asin = options.asin.trim().toUpperCase()
  if (!/^[A-Z0-9]{10}$/.test(asin)) throw new Error('ASIN 应为 10 位字母数字')
  const market = normalizeVocMarket(options.market)
  const limit = Math.min(1000, Math.max(1, Math.trunc(Number(options.limit) || 100)))
  const apiKey = options.apiKey.trim()
  if (!apiKey) throw new Error('请先在系统设置里填写 Shulex API Key')
  const maxPage = Math.min(100, Math.max(1, Math.ceil(limit / 10)))
  const queryPageSize = 10
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'X-API-Key': apiKey,
  }

  const submitResponse = await fetch('https://openapi.shulex.com/v1/api/RtTask01', {
    method: 'POST',
    signal: options.signal,
    headers,
    cache: 'no-store',
    body: JSON.stringify({ asin, market, maxPage, platform: 'AMAZON' }),
  })
  const submitPayload = await readShulexJson<ShulexTaskResponse>(submitResponse)
  const taskId = submitPayload.data?.taskId || submitPayload.data?.task_id || ''
  if (!isShulexSuccessCode(submitPayload.code) || !taskId) {
    throw new Error(`Shulex 提交失败：${submitPayload.message || submitPayload.msg || `code=${String(submitPayload.code)}`}`)
  }

  const queryPage = async (pageNo: number) => {
    const url = new URL('https://openapi.shulex.com/v1/api/RtQry01')
    url.searchParams.set('taskId', taskId)
    url.searchParams.set('pageNo', String(pageNo))
    url.searchParams.set('pageSize', String(queryPageSize))
    const queryResponse = await fetch(url.toString(), {
      method: 'GET',
      signal: options.signal,
      headers: { 'X-API-Key': apiKey },
      cache: 'no-store',
    })
    const payload = await readShulexJson<ShulexQueryResponse>(queryResponse)
    const extracted = extractShulexReviewRecords(payload.data)
    const normalized = extracted.reviews.map(normalizeShulexReview).filter((review) => review.body || review.title)
    const dataRecord = readObject(payload.data)
    const total = readFirstNumber(
      payload.data?.total,
      payload.data?.totalCount,
      payload.data?.count,
      readObject(dataRecord.data).total,
      readObject(dataRecord.data).totalCount,
      readObject(dataRecord.result).total,
      readObject(dataRecord.result).totalCount,
    )
    return {
      payload,
      extracted,
      normalized,
      total,
      diagnostics: {
        pageNo,
        pageSize: queryPageSize,
        status: payload.data?.status,
        total,
        rawReviewCount: extracted.reviews.length,
        normalizedReviewCount: normalized.length,
        dataKeys: Object.keys(readObject(payload.data)),
        reviewArrayPath: extracted.path,
        candidateArrayPaths: extracted.candidateArrayPaths,
      },
    }
  }

  let lastPayload: ShulexQueryResponse | null = null
  let firstPage:
    | Awaited<ReturnType<typeof queryPage>>
    | null = null

  for (let waited = 0; waited <= 120; waited += 5) {
    if (waited > 0) await new Promise((resolve) => setTimeout(resolve, 5000))
    const page = await queryPage(1)
    const queryPayload = page.payload
    lastPayload = queryPayload
    const status = queryPayload.data?.status || ''
    if (isShulexTaskSuccess(status)) {
      firstPage = page
      break
    }
    if (isShulexTaskFailure(status)) {
      throw new Error(`Shulex 任务失败：${queryPayload.data?.errorMsg || queryPayload.data?.message || queryPayload.message || queryPayload.msg || 'unknown error'}`)
    }
  }
  if (!firstPage) throw new Error(`Shulex 任务超时：${lastPayload?.data?.message || lastPayload?.message || '120 秒内未完成'}`)

  const pages = [firstPage.diagnostics]
  const reviewMap = new Map<string, VocReview>()
  const addReviews = (reviews: VocReview[]) => {
    for (const review of reviews) {
      const key = review.reviewId || `${review.rating}|${review.date || ''}|${review.title}|${review.body}`
      if (!reviewMap.has(key)) reviewMap.set(key, review)
    }
  }
  addReviews(firstPage.normalized)

  const totalAvailable = firstPage.total
  const targetCount = Math.min(limit, totalAvailable || limit)
  const pagesToFetch = Math.min(maxPage, Math.max(1, Math.ceil(targetCount / queryPageSize)))

  for (let pageNo = 2; pageNo <= pagesToFetch && reviewMap.size < targetCount; pageNo += 1) {
    const page = await queryPage(pageNo)
    pages.push(page.diagnostics)
    if (isShulexTaskFailure(page.payload.data?.status || '')) {
      throw new Error(`Shulex 任务失败：${page.payload.data?.errorMsg || page.payload.data?.message || page.payload.message || page.payload.msg || 'unknown error'}`)
    }
    addReviews(page.normalized)
    if (page.extracted.reviews.length === 0) break
  }

  const reviews = Array.from(reviewMap.values()).slice(0, limit)
  const lastPage = pages[pages.length - 1]
  return {
    reviews,
    meta: {
      source: 'shulex',
      asin: firstPage.payload.data?.asin || asin,
      market: firstPage.payload.data?.market || market,
      totalAvailable,
      fetched: reviews.length,
      pagesFetched: pages.length,
      status: firstPage.payload.data?.status || '',
      diagnostics: {
        taskId,
        submitCode: submitPayload.code,
        submitMessage: submitPayload.message || submitPayload.msg,
        queryCode: firstPage.payload.code,
        queryMessage: firstPage.payload.message || firstPage.payload.msg,
        dataKeys: lastPage?.dataKeys || firstPage.diagnostics.dataKeys,
        reviewArrayPath: firstPage.extracted.path || lastPage?.reviewArrayPath,
        candidateArrayPaths: firstPage.extracted.candidateArrayPaths,
        requestedLimit: limit,
        requestedMaxPage: maxPage,
        requestedPageSize: queryPageSize,
        totalAvailable,
        rawReviewCount: pages.reduce((sum, page) => sum + page.rawReviewCount, 0),
        normalizedReviewCount: reviews.length,
        pages,
      },
    },
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') quoted = true
    else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (char !== '\r') {
      cell += char
    }
  }
  row.push(cell)
  rows.push(row)
  return rows.filter((item) => item.some((cellValue) => cellValue.trim()))
}

function findColumn(headers: string[], keys: string[]): number {
  return headers.findIndex((header) => {
    const lower = header.trim().toLowerCase()
    return keys.some((key) => lower.includes(key.toLowerCase()))
  })
}

export function parseReviewsCsv(text: string, source: 'csv' | 'paste' = 'csv'): VocReviewEnvelope {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ''))
  if (rows.length < 2) throw new Error('CSV 至少需要表头和 1 行评论')
  const headers = rows[0]
  const bodyIndex = findColumn(headers, ['内容', '评价', '正文', 'review', 'body', 'text', 'content', 'comment'])
  if (bodyIndex < 0) throw new Error(`未识别评论内容列。支持列名包含：内容、评价、review、body、content。当前列：${headers.join(', ')}`)
  const ratingIndex = findColumn(headers, ['星级', '打分', '评分', 'rating', 'star', 'score'])
  const dateIndex = findColumn(headers, ['时间', '日期', 'date', 'time'])
  const titleIndex = findColumn(headers, ['标题', 'title', 'subject'])

  let dropped = 0
  const reviews: VocReview[] = []
  rows.slice(1).forEach((row, index) => {
    const body = String(row[bodyIndex] ?? '').trim()
    if (body.length < 3) {
      dropped += 1
      return
    }
    reviews.push({
      rating: ratingIndex >= 0 ? Number(row[ratingIndex]) || 0 : 0,
      title: titleIndex >= 0 ? String(row[titleIndex] ?? '').trim() : '',
      body,
      date: dateIndex >= 0 ? String(row[dateIndex] ?? '').trim() : '',
      reviewId: `csv-${index + 1}`,
    })
  })

  return {
    reviews,
    meta: {
      source,
      rowsInFile: rows.length - 1,
      rowsUsed: reviews.length,
      rowsDropped: dropped,
      columnsDetected: {
        body: headers[bodyIndex] ?? null,
        rating: ratingIndex >= 0 ? headers[ratingIndex] : null,
        date: dateIndex >= 0 ? headers[dateIndex] : null,
      },
    },
  }
}

function containsAny(text: string, terms: string[]) {
  const lower = text.toLowerCase()
  return terms.some((term) => lower.includes(term.toLowerCase()))
}

function buildInsightItems(reviews: VocReview[], definitions: typeof PAIN_KEYWORDS): VocInsightItem[] {
  return definitions
    .map((definition) => {
      const matched = reviews.filter((review) => containsAny(`${review.title} ${review.body}`, definition.terms))
      return {
        label: definition.label,
        count: matched.length,
        quote: matched[0]?.body.slice(0, 180) ?? '',
      }
    })
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
}

export function createLocalVocSummary(envelope: VocReviewEnvelope): VocLocalSummary {
  const total = Math.max(1, envelope.reviews.length)
  const positive = envelope.reviews.filter((review) => review.rating >= 4).length
  const negative = envelope.reviews.filter((review) => review.rating > 0 && review.rating <= 2).length
  const neutral = Math.max(0, total - positive - negative)
  const positivePct = Math.round((positive / total) * 100)
  const negativePct = Math.round((negative / total) * 100)
  const neutralPct = Math.max(0, 100 - positivePct - negativePct)
  const painPoints = buildInsightItems(envelope.reviews, PAIN_KEYWORDS)
  const sellingPoints = buildInsightItems(envelope.reviews, SELLING_KEYWORDS)
  return {
    sentiment: { positive: positivePct, neutral: neutralPct, negative: negativePct },
    painPoints,
    sellingPoints,
    tips: [
      painPoints[0] ? `优先在主图或五点中回应「${painPoints[0].label}」。` : '补充更多低星评论后再判断核心风险。',
      sellingPoints[0] ? `把「${sellingPoints[0].label}」转成买家可感知的标题/卖点表达。` : '补充更多高星评论后再提炼主卖点。',
      '区分真实产品能力和评论期望，避免用文案承诺无法交付的效果。',
    ],
    summary: `共分析 ${envelope.reviews.length} 条评论，正向 ${positivePct}%，中性 ${neutralPct}%，负向 ${negativePct}%。`,
  }
}

export function buildVocAnalysisPrompt(envelope: VocReviewEnvelope, productName: string, localSummary: VocLocalSummary): string {
  const sampledReviews = envelope.reviews.slice(0, 160).map((review) => ({
    rating: review.rating,
    title: review.title,
    body: review.body.slice(0, 700),
    date: review.date,
    verified: review.verified,
    variant: review.variant,
    helpful: review.helpful,
  }))
  return `你是专业跨境电商 VOC（Voice of Customer）评论分析师。请基于真实评论做分析，不要泛泛套模板。

来源：${envelope.meta.source === 'asin' || envelope.meta.source === 'shulex' ? `Amazon ASIN ${envelope.meta.asin} / ${envelope.meta.market}` : '用户上传 CSV/粘贴评论'}
产品：${productName || envelope.meta.asin || '未命名产品'}
评论数：${envelope.reviews.length}
本地初筛：${localSummary.summary}

评论数据：
\`\`\`json
${JSON.stringify(sampledReviews, null, 2)}
\`\`\`

请输出中文 Markdown 报告，并严格包含这些章节：
## 1. 情感分布
给出正面/中性/负面比例，并解释主要原因。
## 2. Top 5 痛点
每个痛点包含：中文标题、英文短标签、提及次数估计、代表性原话、对转化/退货的影响。
## 3. Top 5 卖点
每个卖点包含：中文标题、英文短标签、提及次数估计、代表性原话、可用于 Listing 的表达方向。
## 4. 买家语言库
提炼 12 个高频买家词、短语或表达，按痛点/卖点分组。
## 5. Listing 优化建议
输出标题方向、五点描述方向、A+ 或图片文案方向，必须说明对应的评论证据。
## 6. 产品与图片策略建议
指出哪些卖点适合主图、卖点图、对比图、证据图表达。
## 7. 风险与不可夸大点
列出不能通过文案掩盖的真实缺陷或合规风险。
## 8. 结构化 JSON
最后输出一个 \`\`\`json 代码块，字段包含 sentiment、pain_points、selling_points、buyer_language、listing_tips、image_strategy、risks。
`
}

function readResponsesText(payload: unknown): string {
  const record = readRecord(payload)
  if (typeof record.output_text === 'string') return record.output_text
  const output = readArray(record.output)
  const parts: string[] = []
  for (const item of output) {
    const content = readArray(readRecord(item).content)
    for (const part of content) {
      const text = readRecord(part).text
      if (typeof text === 'string') parts.push(text)
    }
  }
  return parts.join('\n').trim()
}

function readChatText(payload: unknown): string {
  const choices = readArray(readRecord(payload).choices)
  for (const choice of choices) {
    const message = readRecord(readRecord(choice).message)
    const content = message.content
    if (typeof content === 'string' && content.trim()) return content.trim()
    if (Array.isArray(content)) {
      const text = content.map((part) => readRecord(part).text).filter((part): part is string => typeof part === 'string').join('\n').trim()
      if (text) return text
    }
  }
  return ''
}

function extractAiText(payload: unknown, useChat: boolean) {
  return useChat ? readChatText(payload) : readResponsesText(payload)
}

function appendStreamEvent(event: Record<string, unknown>, useChat: boolean, state: { text: string; done: string }) {
  const type = typeof event.type === 'string' ? event.type : ''
  if (type === 'response.output_text.delta' && typeof event.delta === 'string') state.text += event.delta
  const choices = readArray(event.choices)
  for (const choice of choices) {
    const content = readRecord(readRecord(choice).delta).content
    if (typeof content === 'string') state.text += content
  }
  const direct = extractAiText(event, useChat)
  if (direct && (type.includes('done') || type.includes('completed'))) state.done = direct
}

async function readVocAiResponseText(response: Response, useChat: boolean): Promise<string> {
  if (isEventStreamResponse(response)) {
    const state = { text: '', done: '' }
    await readJsonServerSentEvents(response, (event) => appendStreamEvent(event, useChat, state))
    return state.done.trim() || state.text.trim()
  }
  const rawText = await response.text()
  if (looksLikeServerSentEvents(rawText)) {
    const state = { text: '', done: '' }
    await readJsonServerSentEventText(rawText, (event) => appendStreamEvent(event, useChat, state))
    return state.done.trim() || state.text.trim()
  }
  if (!/^[{\[]/.test(rawText.trimStart())) return rawText.trim()
  const payload = JSON.parse(rawText)
  return extractAiText(payload, useChat)
}

export async function callVocAnalysisApi(profile: ApiProfile, prompt: string, signal?: AbortSignal): Promise<string> {
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(profile.apiProxy, proxyConfig)
  const useChat = profile.apiMode === 'chat'
  const model = profile.model.trim() || (useChat ? DEFAULT_CHAT_MODEL : DEFAULT_RESPONSES_MODEL)
  const response = await fetch(
    useChat
      ? buildApiUrl(profile.baseUrl, 'chat/completions', proxyConfig, useApiProxy, { prefixV1: false })
      : buildApiUrl(profile.baseUrl, 'responses', proxyConfig, useApiProxy),
    {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${profile.apiKey}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify(useChat
        ? {
            model,
            messages: [
              { role: 'system', content: '你是资深跨境电商 VOC 评论分析师，输出必须基于评论证据，避免编造。' },
              { role: 'user', content: prompt },
            ],
            stream: false,
          }
        : {
            model,
            instructions: '你是资深跨境电商 VOC 评论分析师，输出必须基于评论证据，避免编造。',
            input: prompt,
            stream: false,
          }),
    },
  )
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await getApiErrorMessage(response)}`)
  const text = await readVocAiResponseText(response, useChat)
  if (!text.trim()) throw new Error('VOC AI 没有返回可解析文本')
  return text.trim()
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char))
}

function renderItems(items: VocInsightItem[]) {
  return items.length
    ? items.map((item) => `<li><strong>${escapeHtml(item.label)}</strong><span>${item.count} mentions</span><p>${escapeHtml(item.quote)}</p></li>`).join('')
    : '<li><strong>No clear signal</strong><span>0 mentions</span><p>Add more reviews for stronger signal.</p></li>'
}

export function renderVocDashboardHtml(title: string, localSummary: VocLocalSummary, aiReport: string) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title || 'VOC Review Dashboard')}</title>
<style>
body{margin:0;background:#111;color:#f5eddc;font-family:Arial,"Microsoft YaHei",sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:40px 24px}
.hero{border:1px solid #5f5136;background:linear-gradient(135deg,#1b1812,#101010);border-radius:18px;padding:28px}
h1{margin:0 0 8px;font-size:30px}.muted{color:#b9aa8a}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:18px 0}
.metric{border:1px solid #4b402c;border-radius:14px;padding:18px;background:#17140f}.metric b{font-size:28px;color:#f6c76b}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px}
.panel{border:1px solid #4b402c;border-radius:14px;padding:18px;background:#151515}
li{margin:0 0 14px;padding:0 0 14px;border-bottom:1px solid #30291c}li span{float:right;color:#d7b46a}li p{color:#cbbf9f}
pre{white-space:pre-wrap;line-height:1.65;background:#0c0c0c;border:1px solid #3c3527;border-radius:14px;padding:18px;color:#eee}
@media(max-width:800px){.grid,.cols{grid-template-columns:1fr}}
</style>
</head>
<body><main class="wrap">
<section class="hero"><h1>${escapeHtml(title || 'VOC 评论分析 Dashboard')}</h1><div class="muted">Generated by VOC Amazon Reviews workflow · github.com/mguozhen/voc-amazon-reviews</div></section>
<section class="grid">
<div class="metric"><div>Positive</div><b>${localSummary.sentiment.positive}%</b></div>
<div class="metric"><div>Neutral</div><b>${localSummary.sentiment.neutral}%</b></div>
<div class="metric"><div>Negative</div><b>${localSummary.sentiment.negative}%</b></div>
</section>
<section class="cols">
<div class="panel"><h2>Top Pain Points</h2><ul>${renderItems(localSummary.painPoints)}</ul></div>
<div class="panel"><h2>Top Selling Points</h2><ul>${renderItems(localSummary.sellingPoints)}</ul></div>
</section>
<section class="panel" style="margin-top:18px"><h2>AI Report</h2><pre>${escapeHtml(aiReport || localSummary.summary)}</pre></section>
</main></body></html>`
}
