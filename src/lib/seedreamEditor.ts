import type {
  ApiProfile,
  ImageEditorEngine,
  SeedreamAnnotation,
  SeedreamEditorResolution,
  TaskParams,
  TaskRecord,
} from '../types'
import { DEFAULT_PARAMS } from '../types'
import { isVolcengineSeedreamProModel } from './apiProfiles'
import { loadImage } from './canvasImage'
import { calculateImageSize } from './size'

export const SEEDREAM_EDITOR_REFERENCE_LIMIT = 4
export const SEEDREAM_EDITOR_COLORS = ['#ef4444', '#2563eb', '#16a34a', '#eab308'] as const

export interface SeedreamEditPromptOptions {
  instruction: string
  hasVisualGuide: boolean
  referenceCount: number
}

function getImageEditorTaskEngine(task: TaskRecord): ImageEditorEngine {
  return task.imageEditContext?.engine ?? (task.apiProvider === 'volcengine' ? 'seedream' : 'home')
}

/**
 * 恢复当前编辑引擎最近使用的图片编辑任务。
 * 优先保留草稿显式指向的任务；切换引擎或旧草稿缺少引用时，再回退到已持久化的编辑历史。
 */
export function findLatestImageEditorTask(
  tasks: TaskRecord[],
  engine: ImageEditorEngine,
  preferredTaskId?: string | null,
) {
  const candidates = tasks.filter(
    (task) =>
      (task.category?.workflow === 'seedream-edit' || Boolean(task.imageEditContext)) &&
      getImageEditorTaskEngine(task) === engine,
  )
  const preferred = preferredTaskId ? candidates.find((task) => task.id === preferredTaskId) : undefined
  if (preferred) return preferred

  return candidates.reduce<TaskRecord | null>(
    (latest, task) => (!latest || task.createdAt > latest.createdAt ? task : latest),
    null,
  )
}

export function buildSeedreamEditPrompt({ instruction, hasVisualGuide, referenceCount }: SeedreamEditPromptOptions) {
  const visualGuideIndex = hasVisualGuide ? 2 : null
  const referenceStartIndex = hasVisualGuide ? 3 : 2
  const roles = ['图1是必须编辑的原图，也是构图、画幅和未修改内容的唯一基准。']
  if (visualGuideIndex) {
    roles.push(`图${visualGuideIndex}是“视觉定位图”，彩色线条仅用于指出编辑位置和范围，不是原图内容，也不是原生遮罩。`)
  }
  for (let index = 0; index < Math.max(0, referenceCount); index++) {
    roles.push(
      `图${referenceStartIndex + index}是参考图${index + 1}，仅在编辑要求涉及主体替换、多图融合或风格/材质参考时使用。`,
    )
  }

  return [
    '请执行一次精确的图片编辑任务。',
    ...roles,
    '',
    `用户原始编辑要求：${instruction.trim()}`,
    '',
    hasVisualGuide
      ? '请根据视觉定位图理解位置，但最终结果中不得出现任何红、蓝、绿、黄标注线、箭头、边框或涂鸦。'
      : null,
    '只修改用户明确指定的区域和内容；未指定区域、主体身份、透视、光照、文字与版式应尽量保持不变。',
    '保持图1的原始宽高比，只输出一张完成后的干净图片，不要输出对比图、拼图、说明文字或额外版本。',
  ]
    .filter((line): line is string => line != null)
    .join('\n')
}

export function createSeedreamEditorParams(resolution: SeedreamEditorResolution): TaskParams {
  return {
    ...DEFAULT_PARAMS,
    size: resolution === '4k' ? '4K' : '2K',
    n: 1,
    output_format: 'jpeg',
    output_compression: null,
  }
}

export function createImageEditorParams(
  resolution: SeedreamEditorResolution,
  profile: Pick<ApiProfile, 'provider' | 'model'>,
  sourceDimensions: { width: number; height: number },
): TaskParams {
  if (profile.provider === 'volcengine' && isVolcengineSeedreamProModel(profile.model)) {
    return createSeedreamEditorParams(resolution)
  }

  const tier = resolution === '4k' ? '4K' : '2K'
  const ratio =
    sourceDimensions.width > 0 && sourceDimensions.height > 0
      ? `${sourceDimensions.width}:${sourceDimensions.height}`
      : '1:1'
  return {
    ...DEFAULT_PARAMS,
    size: calculateImageSize(tier, ratio) ?? (resolution === '4k' ? '2880x2880' : '2048x2048'),
    n: 1,
    output_format: 'jpeg',
  }
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  lineWidth: number,
  shortEdge: number,
) {
  ctx.beginPath()
  ctx.moveTo(startX, startY)
  ctx.lineTo(endX, endY)
  ctx.stroke()

  const angle = Math.atan2(endY - startY, endX - startX)
  const headLength = Math.max(lineWidth * 5, shortEdge * 0.018)
  ctx.beginPath()
  ctx.moveTo(endX, endY)
  ctx.lineTo(endX - headLength * Math.cos(angle - Math.PI / 6), endY - headLength * Math.sin(angle - Math.PI / 6))
  ctx.moveTo(endX, endY)
  ctx.lineTo(endX - headLength * Math.cos(angle + Math.PI / 6), endY - headLength * Math.sin(angle + Math.PI / 6))
  ctx.stroke()
}

export function drawSeedreamAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: SeedreamAnnotation[],
  width: number,
  height: number,
) {
  const shortEdge = Math.min(width, height)
  for (const annotation of annotations) {
    if (annotation.points.length < 2) continue
    const points = annotation.points.map((point) => ({ x: point.x * width, y: point.y * height }))
    const start = points[0]
    const end = points[points.length - 1]
    ctx.save()
    ctx.strokeStyle = annotation.color
    ctx.fillStyle = annotation.color
    ctx.lineWidth = Math.max(1, annotation.width * shortEdge)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (annotation.kind === 'brush') {
      ctx.beginPath()
      ctx.moveTo(start.x, start.y)
      for (const point of points.slice(1)) ctx.lineTo(point.x, point.y)
      ctx.stroke()
    } else if (annotation.kind === 'rectangle') {
      ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y)
    } else if (annotation.kind === 'ellipse') {
      const centerX = (start.x + end.x) / 2
      const centerY = (start.y + end.y) / 2
      ctx.beginPath()
      ctx.ellipse(centerX, centerY, Math.abs(end.x - start.x) / 2, Math.abs(end.y - start.y) / 2, 0, 0, Math.PI * 2)
      ctx.stroke()
    } else {
      drawArrow(ctx, start.x, start.y, end.x, end.y, ctx.lineWidth, shortEdge)
    }
    ctx.restore()
  }
}

export async function createSeedreamVisualGuideDataUrl(sourceDataUrl: string, annotations: SeedreamAnnotation[]) {
  if (annotations.length === 0) return null
  const source = await loadImage(sourceDataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = source.naturalWidth
  canvas.height = source.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')
  ctx.drawImage(source, 0, 0)
  drawSeedreamAnnotations(ctx, annotations, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

export function appendSeedreamQuickAction(instruction: string, action: string) {
  const current = instruction.trim()
  if (!current) return `${action}：`
  return `${current}${/[，。；：:]$/.test(current) ? '' : '；'}${action}：`
}

export function translateSeedreamAnnotation(
  annotation: SeedreamAnnotation,
  delta: { x: number; y: number },
): SeedreamAnnotation {
  if (annotation.points.length === 0) return annotation
  const xs = annotation.points.map((point) => point.x)
  const ys = annotation.points.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const offsetX = Math.min(1 - maxX, Math.max(-minX, delta.x))
  const offsetY = Math.min(1 - maxY, Math.max(-minY, delta.y))

  return {
    ...annotation,
    points: annotation.points.map((point) => ({
      x: point.x + offsetX,
      y: point.y + offsetY,
    })),
  }
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

export function findSeedreamAnnotationAtPoint(
  annotations: SeedreamAnnotation[],
  point: { x: number; y: number },
  imageWidth: number,
  imageHeight: number,
) {
  const shortEdge = Math.max(1, Math.min(imageWidth, imageHeight))
  const scaleX = imageWidth / shortEdge
  const scaleY = imageHeight / shortEdge
  const px = point.x * scaleX
  const py = point.y * scaleY

  for (let index = annotations.length - 1; index >= 0; index--) {
    const annotation = annotations[index]
    if (annotation.points.length < 2) continue
    const points = annotation.points.map((item) => ({ x: item.x * scaleX, y: item.y * scaleY }))
    const threshold = Math.max(0.012, annotation.width * 2.5)
    const start = points[0]
    const end = points[points.length - 1]

    if (annotation.kind === 'brush' || annotation.kind === 'arrow') {
      for (let pointIndex = 1; pointIndex < points.length; pointIndex++) {
        const previous = points[pointIndex - 1]
        const current = points[pointIndex]
        if (distanceToSegment(px, py, previous.x, previous.y, current.x, current.y) <= threshold) return annotation.id
      }
      continue
    }

    const left = Math.min(start.x, end.x)
    const right = Math.max(start.x, end.x)
    const top = Math.min(start.y, end.y)
    const bottom = Math.max(start.y, end.y)
    if (annotation.kind === 'rectangle') {
      const edgeDistance = Math.min(
        distanceToSegment(px, py, left, top, right, top),
        distanceToSegment(px, py, right, top, right, bottom),
        distanceToSegment(px, py, right, bottom, left, bottom),
        distanceToSegment(px, py, left, bottom, left, top),
      )
      if (edgeDistance <= threshold) return annotation.id
      continue
    }

    const radiusX = Math.max((right - left) / 2, 0.0001)
    const radiusY = Math.max((bottom - top) / 2, 0.0001)
    const centerX = (left + right) / 2
    const centerY = (top + bottom) / 2
    const normalizedRadius = Math.hypot((px - centerX) / radiusX, (py - centerY) / radiusY)
    if (Math.abs(normalizedRadius - 1) <= threshold / Math.max(radiusX, radiusY)) return annotation.id
  }
  return null
}
