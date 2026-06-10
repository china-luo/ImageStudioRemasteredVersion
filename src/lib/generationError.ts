type ParsedProviderError = {
  message?: string
  type?: string
  code?: string
  param?: string | null
  requestId?: string
}

function getErrorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error ?? '')
}

function parseJsonError(text: string): ParsedProviderError | null {
  const trimmed = text.trim()
  const jsonStart = trimmed.search(/[\[{]/)
  if (jsonStart < 0) return null

  const candidate = trimmed.slice(jsonStart)
  try {
    const payload = JSON.parse(candidate) as unknown
    if (!payload || typeof payload !== 'object') return null
    const record = payload as Record<string, unknown>
    const rawError = record.error
    const errorRecord = rawError && typeof rawError === 'object'
      ? rawError as Record<string, unknown>
      : record
    const message = typeof errorRecord.message === 'string' ? errorRecord.message : undefined
    const type = typeof errorRecord.type === 'string' ? errorRecord.type : undefined
    const code = typeof errorRecord.code === 'string' ? errorRecord.code : undefined
    const param = typeof errorRecord.param === 'string' || errorRecord.param === null ? errorRecord.param : undefined
    return { message, type, code, param, requestId: extractRequestId(message ?? trimmed) }
  } catch {
    return null
  }
}

function extractRequestId(text: string): string | undefined {
  const match = text.match(/\b(?:request\s+ID|request_id|req(?:uest)?[-_ ]?id)[:\s]+([a-zA-Z0-9_-]{8,})/i)
  return match?.[1]
}

function extractStreamId(text: string): string | undefined {
  const match = text.match(/\bstream\s+ID\s+([^;,\s]+)/i)
  return match?.[1]
}

function uniqueLines(lines: string[]) {
  const seen = new Set<string>()
  return lines.filter((line) => {
    const normalized = line.trim()
    if (!normalized || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

export function summarizeGenerationError(error: unknown): string {
  const raw = getErrorText(error).trim()
  if (!raw) return '生成失败：接口没有返回明确错误信息，请稍后重试。'

  const lower = raw.toLowerCase()
  const parsed = parseJsonError(raw)
  const lines: string[] = []

  if (parsed?.code === 'server_error' || parsed?.type === 'server_error' || /server_error/.test(lower)) {
    lines.push('生成失败：生图服务商处理请求时发生临时错误。')
    lines.push('建议：请先重试；如果连续失败，可以稍后再试，或降低提示词/参考图复杂度。')
  } else if (/internal_error|received from peer|stream error/.test(lower)) {
    const streamId = extractStreamId(raw)
    lines.push('生成失败：流式连接在生成过程中中断。')
    lines.push('建议：请重试；如果频繁出现，可以关闭流式图片、开启 API 代理，或稍后再试。')
    if (streamId) lines.push(`流式任务：${streamId}`)
  } else if (/timeout|timed out|超时/.test(lower)) {
    lines.push('生成失败：接口等待时间过长。')
    lines.push('建议：提高超时时间、减少并发或稍后重试。')
  } else if (/failed to fetch|fetch failed|network|load failed|cors|跨域|连接/.test(lower)) {
    lines.push('生成失败：浏览器未能连接到生图接口。')
    lines.push('建议：检查网络、API 地址和跨域设置，必要时开启 API 代理。')
  } else if (/401|unauthorized|invalid api key|incorrect api key|forbidden|鉴权|认证|权限/.test(lower)) {
    lines.push('生成失败：API Key 或账号权限校验未通过。')
    lines.push('建议：检查生图配置中的 API Key、模型权限和账户额度。')
  } else if (/404|not found|endpoint|route|路径|不存在/.test(lower)) {
    lines.push('生成失败：生图接口地址或路径不匹配。')
    lines.push('建议：检查 API URL、模型和接口模式是否对应。')
  } else if (/model|unsupported|not supported|does not exist|模型/.test(lower)) {
    lines.push('生成失败：当前模型不支持该生图请求。')
    lines.push('建议：切换到支持图片生成的模型或接口模式。')
  } else {
    lines.push(`生成失败：${parsed?.message ?? raw}`)
  }

  const requestId = parsed?.requestId ?? extractRequestId(raw)
  if (requestId) lines.push(`请求 ID：${requestId}`)

  const debugParts = [
    parsed?.code ? `code=${parsed.code}` : '',
    parsed?.type ? `type=${parsed.type}` : '',
    parsed?.param ? `param=${parsed.param}` : '',
  ].filter(Boolean)
  if (debugParts.length) lines.push(`开发信息：${debugParts.join('，')}`)

  return uniqueLines(lines).join('\n')
}
