import type { ApiProfile } from '../types'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from './devProxy'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeModelsResponse(payload: unknown): string[] {
  const entries = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.data)
      ? payload.data
      : []
  const models = entries
    .map((entry) => {
      if (typeof entry === 'string') return entry
      if (isRecord(entry) && typeof entry.id === 'string') return entry.id
      return ''
    })
    .map((model) => model.trim())
    .filter(Boolean)
  return [...new Set(models)]
}

export function buildModelsEndpoint(profile: Pick<ApiProfile, 'baseUrl' | 'apiProxy'>): string {
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(profile.apiProxy, proxyConfig, profile.baseUrl)
  return buildApiUrl(profile.baseUrl, 'models', proxyConfig, useApiProxy)
}

function getErrorDetail(response: Response): Promise<string> {
  return response
    .text()
    .then((text) => {
      const trimmed = text.trim()
      return trimmed.length > 300 ? `${trimmed.slice(0, 300)}...` : trimmed
    })
    .catch(() => '')
}

export async function fetchUpstreamModels(
  profile: Pick<ApiProfile, 'baseUrl' | 'apiKey' | 'apiProxy'>,
  options: { signal?: AbortSignal } = {},
): Promise<string[]> {
  if (!profile.baseUrl.trim()) throw new Error('请先填写 API Base URL')
  if (!profile.apiKey.trim()) throw new Error('请先填写 API Key')

  const response = await fetch(buildModelsEndpoint(profile), {
    method: 'GET',
    signal: options.signal,
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${profile.apiKey.trim()}`,
    },
  })
  if (!response.ok) {
    const detail = await getErrorDetail(response)
    throw new Error(`HTTP ${response.status}${detail ? `：${detail}` : ''}`)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('上游返回的模型列表不是有效 JSON')
  }
  const models = normalizeModelsResponse(payload)
  if (!models.length) throw new Error('上游返回的模型列表为空或格式无法识别')
  return models
}
