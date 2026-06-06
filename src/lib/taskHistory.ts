import type { HistoryAspectFilter, HistoryWorkflowFilter, TaskAspect, TaskRecord, TaskWorkflow } from '../types'

export const ALL_PRODUCT_FILTER = ''
export const UNCATEGORIZED_PRODUCT_FILTER = '__uncategorized_product__'

const SIZE_PATTERN = /^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/
const PRODUCT_TITLE_PATTERNS = [
  /(?:^|\n)\s*-\s*Product title:\s*(.+?)(?:\n|$)/i,
  /(?:^|\n)\s*Product title:\s*(.+?)(?:\n|$)/i,
  /(?:^|\n)\s*Product facts:\s*[\s\S]*?Product title:\s*(.+?)(?:\n|$)/i,
]

export interface TaskHistoryCategory {
  productTitle: string
  workflow: TaskWorkflow
  aspect: TaskAspect
  amazonSlot: string
  aPlusType: 'standard' | 'standard-large' | 'premium' | ''
}

export interface TaskHistoryFilters {
  searchQuery: string
  filterStatus: 'all' | 'running' | 'done' | 'error'
  filterFavorite: boolean
  filterProductTitle: string
  filterWorkflow: HistoryWorkflowFilter
  filterAspect: HistoryAspectFilter
}

export interface ProductFilterOption {
  value: string
  label: string
  count: number
  latestCreatedAt: number
}

function parseSize(size: string | undefined | null) {
  if (!size) return null
  const match = size.match(SIZE_PATTERN)
  if (!match) return null

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  return { width, height }
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

export function normalizeProductTitle(value: string) {
  return normalizeText(value).toLowerCase()
}

function cleanInferredProductTitle(value: string) {
  const cleaned = normalizeText(value)
    .replace(/^\[fill in exact product name\]$/i, '')
    .replace(/\.$/, '')
    .trim()
  return cleaned.length > 120 ? `${cleaned.slice(0, 117)}...` : cleaned
}

function inferProductTitleFromPrompt(prompt: string) {
  for (const pattern of PRODUCT_TITLE_PATTERNS) {
    const match = prompt.match(pattern)
    const title = cleanInferredProductTitle(match?.[1] ?? '')
    if (title) return title
  }
  return ''
}

function getPrimarySize(task: TaskRecord) {
  const firstOutputImageId = task.outputImages?.[0]
  return (
    (firstOutputImageId ? task.actualParamsByImage?.[firstOutputImageId]?.size : undefined) ??
    task.actualParams?.size ??
    task.params.size
  )
}

export function getTaskAspect(task: TaskRecord): TaskAspect {
  const size = parseSize(getPrimarySize(task))
  if (!size) return 'square'

  const ratio = size.width / size.height
  if (ratio > 1.18) return 'landscape'
  if (ratio < 0.85) return 'portrait'
  return 'square'
}

function inferWorkflow(task: TaskRecord): TaskWorkflow {
  if (task.category?.workflow) return task.category.workflow
  if (task.sourceMode === 'agent' || task.agentConversationId || task.agentRoundId) return 'agent'

  const prompt = task.prompt || ''
  if (/a\+\s*module requirements|seller central recommended upload size|amazon a\+/i.test(prompt)) {
    return 'amazon-aplus'
  }
  if (/amazon product listing image|amazon compliance guard|product listing image/i.test(prompt)) {
    return 'amazon-listing'
  }
  return 'gallery'
}

export function getTaskHistoryCategory(task: TaskRecord): TaskHistoryCategory {
  const hasExplicitProductTitle = Boolean(
    task.category && Object.prototype.hasOwnProperty.call(task.category, 'productTitle'),
  )
  const explicitProductTitle = cleanInferredProductTitle(task.category?.productTitle ?? '')
  return {
    productTitle: hasExplicitProductTitle ? explicitProductTitle : inferProductTitleFromPrompt(task.prompt || ''),
    workflow: inferWorkflow(task),
    aspect: getTaskAspect(task),
    amazonSlot: normalizeText(task.category?.amazonSlot ?? ''),
    aPlusType: task.category?.aPlusType ?? '',
  }
}

export function getWorkflowLabel(workflow: TaskWorkflow) {
  switch (workflow) {
    case 'amazon-listing':
      return 'Listing 图'
    case 'amazon-aplus':
      return 'A+ 图'
    case 'agent':
      return 'Agent'
    case 'gallery':
      return '普通生图'
    default:
      return '未知来源'
  }
}

export function getAspectLabel(aspect: TaskAspect) {
  switch (aspect) {
    case 'landscape':
      return '横幅图'
    case 'portrait':
      return '竖图'
    default:
      return '方图'
  }
}

export function getTaskProductFilterOptions(tasks: TaskRecord[]): ProductFilterOption[] {
  const productMap = new Map<string, ProductFilterOption>()

  for (const task of tasks) {
    const { productTitle } = getTaskHistoryCategory(task)
    if (!productTitle) continue

    const key = normalizeProductTitle(productTitle)
    const current = productMap.get(key)
    if (!current) {
      productMap.set(key, {
        value: productTitle,
        label: productTitle,
        count: 1,
        latestCreatedAt: task.createdAt,
      })
      continue
    }

    current.count += 1
    if (task.createdAt > current.latestCreatedAt) {
      current.latestCreatedAt = task.createdAt
      current.value = productTitle
      current.label = productTitle
    }
  }

  return [...productMap.values()].sort((a, b) => b.latestCreatedAt - a.latestCreatedAt)
}

export function matchesTaskHistoryFilters(task: TaskRecord, filters: TaskHistoryFilters) {
  if (filters.filterFavorite && !task.isFavorite) return false
  if (filters.filterStatus !== 'all' && task.status !== filters.filterStatus) return false

  const category = getTaskHistoryCategory(task)
  if (filters.filterProductTitle === UNCATEGORIZED_PRODUCT_FILTER) {
    if (category.productTitle) return false
  } else if (filters.filterProductTitle) {
    if (normalizeProductTitle(category.productTitle) !== normalizeProductTitle(filters.filterProductTitle)) return false
  }

  if (filters.filterWorkflow !== 'all' && category.workflow !== filters.filterWorkflow) return false
  if (filters.filterAspect !== 'all' && category.aspect !== filters.filterAspect) return false

  const query = filters.searchQuery.trim().toLowerCase()
  if (!query) return true

  const searchable = [
    task.prompt,
    JSON.stringify(task.params),
    JSON.stringify(task.actualParams ?? {}),
    category.productTitle,
    getWorkflowLabel(category.workflow),
    getAspectLabel(category.aspect),
    category.amazonSlot,
    category.aPlusType,
  ].join(' ').toLowerCase()

  return searchable.includes(query)
}
