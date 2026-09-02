import { DEFAULT_PARAMS, type TaskParams } from '../../types'

export function normalizeCompressionInput(value: string, current: TaskParams['output_compression']) {
  if (value.trim() === '') return { input: '', value: null as TaskParams['output_compression'] }
  const parsed = Number(value)
  if (Number.isNaN(parsed)) return { input: current == null ? '' : String(current), value: undefined }
  const clamped = Math.min(100, Math.max(0, Math.trunc(parsed)))
  return { input: String(clamped), value: clamped }
}

export function normalizeCountInput(value: string, current: number, limit: number) {
  const parsed = Number(value)
  const next = value.trim() === '' ? DEFAULT_PARAMS.n : Number.isNaN(parsed) ? current : parsed
  const clamped = Math.min(limit, Math.max(1, next))
  return { input: String(clamped), value: clamped }
}
