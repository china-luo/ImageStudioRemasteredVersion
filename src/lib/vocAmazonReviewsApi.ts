import * as XLSX from 'xlsx'

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

type ReviewImportSource = 'csv' | 'xlsx' | 'paste'

export interface VocReviewEnvelope {
  reviews: VocReview[]
  meta: {
    // 保留旧草稿中的来源标记；它们不再对应在线入口。
    source: ReviewImportSource | 'asin' | 'shulex'
    asin?: string
    market?: string
    rowsInFile?: number
    rowsUsed?: number
    rowsDropped?: number
    columnsDetected?: Record<string, string | null>
  }
}

export interface VocInsightItem {
  label: string
  count: number
  quote: string
}

export interface VocLocalSummary {
  ratings: { high: number; medium: number; low: number; unrated: number }
  lowRatingTopics: VocInsightItem[]
  highRatingTopics: VocInsightItem[]
  otherTopics: VocInsightItem[]
  summary: string
}

const TOPICS = [
  {
    label: '质量或耐用性',
    terms: [
      'quality',
      'sturdy',
      'durable',
      'broke',
      'broken',
      'defect',
      'stopped working',
      '质量',
      '做工',
      '耐用',
      '结实',
      '裂',
      '坏',
    ],
  },
  { label: '尺寸或适配', terms: ['size', 'fit', 'fits', 'small', 'large', '尺寸', '太小', '太大', '合适'] },
  {
    label: '使用或安装',
    terms: [
      'easy',
      'simple',
      'difficult',
      'hard to',
      'instruction',
      'setup',
      'install',
      '方便',
      '易用',
      '难用',
      '安装',
    ],
  },
  { label: '包装或运输', terms: ['package', 'packaging', 'shipping', 'arrived', 'box', '包装', '运输', '破损'] },
  {
    label: '功能与效果',
    terms: ['works great', 'effective', 'does not work', "doesn't work", 'not work', 'weak', '功能', '效果'],
  },
  { label: '价格或性价比', terms: ['value', 'price', 'worth', 'affordable', '性价比', '划算', '价格'] },
  { label: '外观与设计', terms: ['design', 'beautiful', 'looks', 'cute', 'style', '外观', '好看', '设计'] },
]

export const VOC_NO_VALID_REVIEWS_ERROR = '没有可用的有效评论。请确认文件至少包含 1 条正文不少于 3 个字符的评论。'

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const delimiter = text.split(/\r?\n/, 1)[0].includes('\t') ? '\t' : ','
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
    } else if (char === '"' && !cell) {
      quoted = true
    } else if (char === delimiter) {
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
  if (quoted) throw new Error('表格中有未闭合的引号，请检查评论正文。')
  row.push(cell)
  rows.push(row)
  return rows
}

function findColumn(headers: string[], keys: string[], fallback?: RegExp): number {
  const normalized = headers.map((header) => header.trim().toLowerCase().replace(/[_-]+/g, ' '))
  for (const key of keys) {
    const index = normalized.indexOf(key)
    if (index >= 0) return index
  }
  return fallback ? normalized.findIndex((header) => fallback.test(header)) : -1
}

function normalizeImportedCell(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value ?? '').trim()
}

function readRating(text: string): number {
  const match = text.match(/^([1-5](?:[.,]\d+)?)(?:\s*(?:out of\s*5(?:\s*stars?)?|stars?|星|\/\s*5))?$/i)
  const rating = match ? Number(match[1].replace(',', '.')) : 0
  return rating >= 1 && rating <= 5 ? rating : 0
}

function parseReviewRows(inputRows: unknown[][], source: ReviewImportSource, label: string): VocReviewEnvelope {
  const rows = inputRows.map((row) => row.map(normalizeImportedCell)).filter((row) => row.some(Boolean))
  if (rows.length < 2) throw new Error(`${label} 至少需要表头和 1 行评论`)
  const headers = rows[0]
  const bodyIndex = findColumn(
    headers,
    [
      'body',
      'review body',
      'review text',
      'review content',
      'review',
      'text',
      'content',
      'comment',
      '正文',
      '内容',
      '评价',
    ],
    /正文|评论内容|评价内容|评价正文/,
  )
  if (bodyIndex < 0)
    throw new Error(`未识别评论内容列。支持 body、review、content、内容、评价等列名。当前列：${headers.join(', ')}`)
  const ratingIndex = findColumn(
    headers,
    ['rating', 'star', 'stars', 'score', 'star rating', 'review rating', '评分', '星级', '打分'],
    /星级|评分/,
  )
  const dateIndex = findColumn(headers, ['date', 'time', 'review date', '时间', '日期'], /时间|日期/)
  const titleIndex = findColumn(headers, ['title', 'review title', 'subject', '标题'], /标题/)
  const reviews: VocReview[] = []
  rows.slice(1).forEach((row, index) => {
    const body = row[bodyIndex] ?? ''
    if (body.length < 3) return
    reviews.push({
      rating: readRating(row[ratingIndex] ?? ''),
      title: row[titleIndex] ?? '',
      body,
      date: row[dateIndex] ?? '',
      reviewId: `${source}-${index + 1}`,
    })
  })
  if (!reviews.length) throw new Error(VOC_NO_VALID_REVIEWS_ERROR)
  return {
    reviews,
    meta: {
      source,
      rowsInFile: rows.length - 1,
      rowsUsed: reviews.length,
      rowsDropped: rows.length - 1 - reviews.length,
      columnsDetected: {
        body: headers[bodyIndex],
        rating: headers[ratingIndex] ?? null,
        date: headers[dateIndex] ?? null,
      },
    },
  }
}

export function parseReviewsCsv(text: string, source: 'csv' | 'paste' = 'csv'): VocReviewEnvelope {
  const contents = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  return parseReviewRows(parseCsvRows(contents), source, source === 'paste' ? '粘贴的表格' : 'CSV')
}

export function parseReviewsXlsx(buffer: ArrayBuffer): VocReviewEnvelope {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) throw new Error('XLSX 文件没有可读取的工作表')
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheetName], {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  })
  return parseReviewRows(rows, 'xlsx', 'XLSX')
}

const topicPatterns = TOPICS.map(({ label, terms }) => ({
  label,
  patterns: terms.map((term) => (/^[a-z ]+$/i.test(term) ? new RegExp(`\\b${term}\\b`, 'i') : term)),
}))

function buildInsightItems(reviews: VocReview[]): VocInsightItem[] {
  return topicPatterns
    .map(({ label, patterns }) => {
      const matched = reviews.filter(({ title, body }) => {
        const text = `${title || ''} ${body || ''}`
        return patterns.some((pattern) => (typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text)))
      })
      return {
        label,
        count: matched.length,
        quote: (matched[0]?.body || matched[0]?.title || '').slice(0, 180),
      }
    })
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
}

export const VOC_TOPIC_NOTE = '主题按关键词统计，不判断句子褒贬。同一条评论可提到多个主题，请结合原文判断。'

export function createLocalVocSummary(envelope: VocReviewEnvelope): VocLocalSummary {
  const high: VocReview[] = []
  const low: VocReview[] = []
  const other: VocReview[] = []
  let medium = 0
  let unrated = 0
  for (const review of envelope.reviews) {
    if (!review) {
      unrated += 1
    } else if (!Number.isFinite(review.rating) || review.rating < 1 || review.rating > 5) {
      unrated += 1
      other.push(review)
    } else if (review.rating >= 4) {
      high.push(review)
    } else if (review.rating <= 2) {
      low.push(review)
    } else {
      medium += 1
      other.push(review)
    }
  }
  return {
    ratings: { high: high.length, medium, low: low.length, unrated },
    lowRatingTopics: buildInsightItems(low),
    highRatingTopics: buildInsightItems(high),
    otherTopics: buildInsightItems(other),
    summary: `共分析 ${envelope.reviews.length} 条评论，4–5 星 ${high.length} 条，2–4 星之间 ${medium} 条，1–2 星 ${low.length} 条，未评分或无有效评分 ${unrated} 条。`,
  }
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  )
}

function renderItems(items: VocInsightItem[]) {
  return items.length
    ? items
        .map(
          ({ label, count, quote }) =>
            `<li><strong>${escapeHtml(label)}</strong> · ${count} 条评论<p>${escapeHtml(quote)}</p></li>`,
        )
        .join('')
    : '<li>未匹配到预设主题</li>'
}

export function renderVocDashboardHtml(title: string, localSummary: VocLocalSummary) {
  const safeTitle = escapeHtml(title || 'VOC 评论分析')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle}</title>
<style>
:root{color-scheme:light dark}body{padding:24px;margin:0;font:16px/1.6 system-ui,sans-serif;background:Canvas;color:CanvasText}
main{max-width:880px;margin:auto}section{border:1px solid GrayText;border-radius:12px;padding:16px;margin:16px 0;overflow-wrap:anywhere}
h1,h2,p{margin:0 0 8px}li p{margin-left:8px}
</style>
</head>
<body><main>
<h1>${safeTitle}</h1>
<section><h2>星级分布</h2><p>${escapeHtml(localSummary.summary)}</p><p>${VOC_TOPIC_NOTE}</p></section>
<section><h2>低星评论常见主题</h2><ul>${renderItems(localSummary.lowRatingTopics)}</ul></section>
<section><h2>高星评论常见主题</h2><ul>${renderItems(localSummary.highRatingTopics)}</ul></section>
${localSummary.otherTopics.length ? `<section><h2>中间星级或未评分评论常见主题</h2><ul>${renderItems(localSummary.otherTopics)}</ul></section>` : ''}
</main></body></html>`
}
