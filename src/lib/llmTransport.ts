import type { ApiProfile } from '../types'
import { DEFAULT_CHAT_MODEL, DEFAULT_RESPONSES_MODEL } from './apiProfiles'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from './devProxy'
import { getApiErrorMessage } from './imageApiShared'
import {
  isEventStreamResponse,
  looksLikeServerSentEvents,
  readJsonServerSentEvents,
  readJsonServerSentEventText,
} from './serverSentEvents'

export function resolveLlmModel(profile: ApiProfile, useChatCompletions = profile.apiMode === 'chat'): string {
  return profile.model.trim() || (useChatCompletions ? DEFAULT_CHAT_MODEL : DEFAULT_RESPONSES_MODEL)
}

export function createLlmAuthHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

export function resolveLlmRequestUrl(profile: ApiProfile, useChatCompletions = profile.apiMode === 'chat'): string {
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(profile.apiProxy, proxyConfig, profile.baseUrl)
  return useChatCompletions
    ? buildApiUrl(profile.baseUrl, 'chat/completions', proxyConfig, useApiProxy, { prefixV1: false })
    : buildApiUrl(profile.baseUrl, 'responses', proxyConfig, useApiProxy)
}

export async function postLlmRequest(options: {
  profile: ApiProfile
  body: unknown
  signal?: AbortSignal
  useChatCompletions?: boolean
}): Promise<Response> {
  const useChatCompletions = options.useChatCompletions ?? options.profile.apiMode === 'chat'
  return fetch(resolveLlmRequestUrl(options.profile, useChatCompletions), {
    method: 'POST',
    signal: options.signal,
    headers: createLlmAuthHeaders(options.profile.apiKey),
    cache: 'no-store',
    body: JSON.stringify(options.body),
  })
}

export async function assertLlmResponseOk(response: Response, timeoutNote?: string): Promise<void> {
  if (response.ok) return
  const message = await getApiErrorMessage(response)
  if (response.status === 524 && timeoutNote) throw new Error(timeoutNote)
  throw new Error(`HTTP ${response.status}: ${message}`)
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getStringValue(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' && value ? value : undefined
}

export function readResponsesOutputText(payload: unknown): string {
  const record = isRecordValue(payload) ? payload : {}
  if (typeof record.output_text === 'string') return record.output_text

  const output = Array.isArray(record.output) ? record.output : []
  const parts: string[] = []
  for (const item of output) {
    if (!isRecordValue(item)) continue
    const content = Array.isArray(item.content) ? item.content : []
    for (const part of content) {
      if (!isRecordValue(part)) continue
      const text = part.text
      if (typeof text === 'string') parts.push(text)
    }
  }
  return parts.join('\n').trim()
}

export function readChatCompletionText(payload: unknown): string {
  const record = isRecordValue(payload) ? payload : {}
  const choices = Array.isArray(record.choices) ? record.choices : []
  for (const choice of choices) {
    if (!isRecordValue(choice)) continue
    const message = isRecordValue(choice.message) ? choice.message : {}
    const content = message.content
    if (typeof content === 'string' && content.trim()) return content.trim()
    if (Array.isArray(content)) {
      const text = content
        .map((part) => (isRecordValue(part) ? part.text : ''))
        .filter((part): part is string => typeof part === 'string' && Boolean(part.trim()))
        .join('\n')
        .trim()
      if (text) return text
    }
  }
  return ''
}

export function extractLlmText(payload: unknown, useChatCompletions: boolean): string {
  return useChatCompletions ? readChatCompletionText(payload) : readResponsesOutputText(payload)
}

function extractEventText(event: Record<string, unknown>, useChatCompletions: boolean): string {
  const direct = extractLlmText(event, useChatCompletions)
  if (direct) return direct
  if (isRecordValue(event.response)) {
    const responseText = extractLlmText(event.response, useChatCompletions)
    if (responseText) return responseText
  }
  if (isRecordValue(event.item)) {
    const itemText = readResponsesOutputText({ output: [event.item] })
    if (itemText) return itemText
  }
  return (
    getStringValue(event, 'text') || (isRecordValue(event.part) ? getStringValue(event.part, 'text') : undefined) || ''
  )
}

function appendLlmStreamEvent(
  event: Record<string, unknown>,
  useChatCompletions: boolean,
  state: { completedText: string; outputItemText: string; doneText: string; deltaText: string },
) {
  const type = getStringValue(event, 'type') ?? ''
  if (type === 'response.output_text.delta') {
    state.deltaText += getStringValue(event, 'delta') ?? ''
    return
  }

  const choices = Array.isArray(event.choices) ? event.choices : []
  for (const choice of choices) {
    if (!isRecordValue(choice) || !isRecordValue(choice.delta)) continue
    const content = getStringValue(choice.delta, 'content')
    if (content) state.deltaText += content
  }

  const text = extractEventText(event, useChatCompletions)
  if (!text) return
  if (type === 'response.completed') state.completedText = text
  else if (type === 'response.output_item.done') state.outputItemText = text
  else if (
    type === 'response.output_text.done' ||
    type === 'response.content_part.done' ||
    type.includes('done') ||
    type.includes('completed')
  ) {
    state.doneText = text
  } else if (!type) state.deltaText += text
}

function collectedStreamText(state: {
  completedText: string
  outputItemText: string
  doneText: string
  deltaText: string
}): string {
  return state.completedText.trim() || state.outputItemText.trim() || state.doneText.trim() || state.deltaText.trim()
}

function isJsonContentType(contentType: string): boolean {
  return contentType.includes('application/json') || contentType.includes('+json')
}

function truncateForError(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= 1200) return trimmed
  return `${trimmed.slice(0, 1200)}...`
}

export async function readLlmResponseText(
  response: Response,
  useChatCompletions: boolean,
  options: { emptyError: string; allowNonJsonText?: boolean } = { emptyError: 'AI 没有返回可解析文本' },
): Promise<string> {
  const emptyError = options.emptyError
  const allowNonJsonText = options.allowNonJsonText !== false

  if (isEventStreamResponse(response)) {
    const state = { completedText: '', outputItemText: '', doneText: '', deltaText: '' }
    await readJsonServerSentEvents(response, (event) => appendLlmStreamEvent(event, useChatCompletions, state))
    const text = collectedStreamText(state)
    if (!text) throw new Error(emptyError)
    return text
  }

  const rawText = await response.text()
  if (!rawText.trim()) throw new Error(emptyError)

  if (looksLikeServerSentEvents(rawText)) {
    const state = { completedText: '', outputItemText: '', doneText: '', deltaText: '' }
    await readJsonServerSentEventText(rawText, (event) => appendLlmStreamEvent(event, useChatCompletions, state))
    const text = collectedStreamText(state)
    if (!text) throw new Error(emptyError)
    return text
  }

  const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? ''
  if (!isJsonContentType(contentType) && !/^[{\[]/.test(rawText.trimStart())) {
    if (allowNonJsonText) return rawText.trim()
    throw new Error(`${emptyError}：${truncateForError(rawText)}`)
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawText)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`${emptyError}（JSON 无法解析：${message}）\n\n${truncateForError(rawText)}`)
  }

  const text = extractLlmText(payload, useChatCompletions)
  if (!text) throw new Error(emptyError)
  return text
}
