export function isEventStreamResponse(response: Response): boolean {
  return response.headers.get('Content-Type')?.toLowerCase().includes('text/event-stream') ?? false
}

export function looksLikeServerSentEvents(text: string): boolean {
  return /^(?:event|data):\s*/m.test(text.trimStart())
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getStringValue(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function getStreamEventErrorMessage(event: Record<string, unknown>): string | null {
  const error = event.error
  if (isRecordValue(error)) {
    const message = getStringValue(error, 'message')
    if (message) return message
  }
  if (typeof error === 'string' && error.trim()) return error

  const type = getStringValue(event, 'type')
  if (type?.endsWith('.failed')) {
    return getStringValue(event, 'message') ?? '流式请求失败'
  }
  return null
}

function parseServerSentEventBlock(block: string): string | null {
  const dataLines: string[] = []
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue
    if (!line.startsWith('data:')) continue
    dataLines.push(line.slice(5).replace(/^ /, ''))
  }

  const data = dataLines.join('\n').trim()
  if (!data || data === '[DONE]') return null
  return data
}

async function processServerSentEventBlock(
  block: string,
  onEvent: (event: Record<string, unknown>) => void | Promise<void>,
) {
  const data = parseServerSentEventBlock(block)
  if (!data) return

  let event: unknown
  try {
    event = JSON.parse(data)
  } catch {
    throw new Error('流式响应包含无法解析的 JSON 事件')
  }
  if (!isRecordValue(event)) return

  const errorMessage = getStreamEventErrorMessage(event)
  if (errorMessage) throw new Error(errorMessage)

  await onEvent(event)
}

export async function readJsonServerSentEventText(
  text: string,
  onEvent: (event: Record<string, unknown>) => void | Promise<void>,
): Promise<void> {
  const normalized = text.replace(/\r\n/g, '\n')
  for (const block of normalized.split(/\n\n+/)) {
    if (block.trim()) await processServerSentEventBlock(block, onEvent)
  }
}

export async function readJsonServerSentEvents(
  response: Response,
  onEvent: (event: Record<string, unknown>) => void | Promise<void>,
): Promise<void> {
  if (!response.body) throw new Error('接口未返回可读取的流式响应')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let separatorIndex = buffer.search(/\r?\n\r?\n/)
    while (separatorIndex >= 0) {
      const block = buffer.slice(0, separatorIndex)
      const separator = buffer.match(/\r?\n\r?\n/)?.[0] ?? '\n\n'
      buffer = buffer.slice(separatorIndex + separator.length)
      await processServerSentEventBlock(block, onEvent)
      separatorIndex = buffer.search(/\r?\n\r?\n/)
    }
  }

  buffer += decoder.decode()
  if (buffer.trim()) await processServerSentEventBlock(buffer, onEvent)
}
