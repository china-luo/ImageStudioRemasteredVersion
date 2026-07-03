import type { ApiProfile } from '../types'
import { DEFAULT_CHAT_MODEL, DEFAULT_RESPONSES_MODEL } from './apiProfiles'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from './devProxy'
import { getApiErrorMessage } from './imageApiShared'
import { isEventStreamResponse, looksLikeServerSentEvents, readJsonServerSentEvents, readJsonServerSentEventText } from './serverSentEvents'

export interface SopReverseImageInput {
  dataUrl: string
  name?: string
}

export interface CallSopReverseApiOptions {
  profile: ApiProfile
  prompt: string
  images?: SopReverseImageInput[]
  signal?: AbortSignal
}

const SOP_REVERSE_SYSTEM_PROMPT = [
  '你是资深跨境电商商品图拆解与图片生成提示词反推专家。',
  '你会严格依据用户提供的 SOP、商品信息、竞品图或竞品图说明进行分析，不要只套模板。',
  '先从图片解决的购买疑问、信息层级、构图、可迁移结构和风险项分析，再迁移到用户自家产品。',
  '不要照搬竞品品牌、包装、文案、证书、价格、功效数字、平台标识、人物身份或虚构背书。',
  '最终必须输出可直接给图片模型使用的英文 AI image prompt，并单独输出英文 negative prompt。',
  '除英文提示词段落外，其余分析使用简体中文。不要生成图片，只返回分析文本。',
].join('\n')

function buildChatUserContent(prompt: string, images: SopReverseImageInput[]) {
  if (!images.length) return prompt
  return [
    { type: 'text', text: prompt },
    ...images.map((image) => ({
      type: 'image_url',
      image_url: { url: image.dataUrl },
    })),
  ]
}

function buildResponsesInput(prompt: string, images: SopReverseImageInput[]) {
  return [
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: prompt,
        },
        ...images.map((image) => ({
          type: 'input_image',
          image_url: image.dataUrl,
        })),
      ],
    },
  ]
}

function readResponsesText(payload: unknown): string {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  if (typeof record.output_text === 'string') return record.output_text

  const output = Array.isArray(record.output) ? record.output : []
  const parts: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const content = (item as Record<string, unknown>).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const text = (part as Record<string, unknown>).text
      if (typeof text === 'string') parts.push(text)
    }
  }
  return parts.join('\n').trim()
}

function readChatText(payload: unknown): string {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const choices = Array.isArray(record.choices) ? record.choices : []
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue
    const message = (choice as Record<string, unknown>).message
    if (!message || typeof message !== 'object') continue
    const content = (message as Record<string, unknown>).content
    if (typeof content === 'string' && content.trim()) return content.trim()
    if (Array.isArray(content)) {
      const text = content
        .map((part) => part && typeof part === 'object' ? (part as Record<string, unknown>).text : '')
        .filter((part): part is string => typeof part === 'string' && Boolean(part.trim()))
        .join('\n')
        .trim()
      if (text) return text
    }
  }
  return ''
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getStringValue(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' && value ? value : undefined
}

function extractResponseText(payload: unknown, useChatCompletions: boolean): string {
  return useChatCompletions ? readChatText(payload) : readResponsesText(payload)
}

function getSopTextFromEvent(event: Record<string, unknown>, useChatCompletions: boolean): string {
  const directText = extractResponseText(event, useChatCompletions)
  if (directText) return directText

  if (isRecordValue(event.response)) {
    const responseText = extractResponseText(event.response, useChatCompletions)
    if (responseText) return responseText
  }

  if (isRecordValue(event.item)) {
    const itemText = readResponsesText({ output: [event.item] })
    if (itemText) return itemText
  }

  const text = getStringValue(event, 'text')
  if (text) return text

  const part = event.part
  if (isRecordValue(part)) {
    const partText = getStringValue(part, 'text')
    if (partText) return partText
  }

  return ''
}

function appendSopStreamEvent(
  event: Record<string, unknown>,
  useChatCompletions: boolean,
  state: { completedText: string; outputItemText: string; doneText: string; deltaText: string },
) {
  const type = getStringValue(event, 'type')
  if (type === 'response.output_text.delta') {
    state.deltaText += getStringValue(event, 'delta') ?? ''
    return
  }

  const choices = Array.isArray(event.choices) ? event.choices : []
  for (const choice of choices) {
    if (!isRecordValue(choice)) continue
    const delta = choice.delta
    if (isRecordValue(delta)) {
      const content = getStringValue(delta, 'content')
      if (content) state.deltaText += content
    }
  }

  const text = getSopTextFromEvent(event, useChatCompletions)
  if (!text) return

  if (type === 'response.completed') state.completedText = text
  else if (type === 'response.output_item.done') state.outputItemText = text
  else if (type === 'response.output_text.done' || type === 'response.content_part.done') state.doneText = text
  else if (!type) state.deltaText += text
}

async function readSopTextFromSseResponse(response: Response, useChatCompletions: boolean): Promise<string> {
  const state = { completedText: '', outputItemText: '', doneText: '', deltaText: '' }
  await readJsonServerSentEvents(response, (event) => appendSopStreamEvent(event, useChatCompletions, state))
  return state.completedText.trim() || state.outputItemText.trim() || state.doneText.trim() || state.deltaText.trim()
}

async function readSopTextFromSseText(rawText: string, useChatCompletions: boolean): Promise<string> {
  const state = { completedText: '', outputItemText: '', doneText: '', deltaText: '' }
  await readJsonServerSentEventText(rawText, (event) => appendSopStreamEvent(event, useChatCompletions, state))
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

async function readSopReverseResponseText(response: Response, useChatCompletions: boolean): Promise<string> {
  if (isEventStreamResponse(response)) {
    const text = await readSopTextFromSseResponse(response, useChatCompletions)
    if (!text) throw new Error('AI 拆解反推流式接口未返回文本内容')
    return text
  }

  const rawText = await response.text()
  if (!rawText.trim()) throw new Error('AI 拆解反推接口返回空内容')

  if (looksLikeServerSentEvents(rawText)) {
    const text = await readSopTextFromSseText(rawText, useChatCompletions)
    if (!text) throw new Error('AI 拆解反推流式接口未返回文本内容')
    return text
  }

  const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? ''
  if (!isJsonContentType(contentType) && !/^[{\[]/.test(rawText.trimStart())) {
    return rawText.trim()
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawText)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`AI 拆解反推接口返回了无法解析的 JSON：${message}\n\n${truncateForError(rawText)}`)
  }

  const text = extractResponseText(payload, useChatCompletions)
  if (!text) throw new Error('AI 没有返回可解析的拆解结果')
  return text
}

export async function callSopReverseApi(options: CallSopReverseApiOptions): Promise<string> {
  const model = options.profile.model.trim() || (options.profile.apiMode === 'chat' ? DEFAULT_CHAT_MODEL : DEFAULT_RESPONSES_MODEL)
  const images = options.images ?? []
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(options.profile.apiProxy, proxyConfig)
  const useChatCompletions = options.profile.apiMode === 'chat'

  const response = await fetch(
    useChatCompletions
      ? buildApiUrl(options.profile.baseUrl, 'chat/completions', proxyConfig, useApiProxy, { prefixV1: false })
      : buildApiUrl(options.profile.baseUrl, 'responses', proxyConfig, useApiProxy),
    {
      method: 'POST',
      signal: options.signal,
      headers: {
        Authorization: `Bearer ${options.profile.apiKey}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify(useChatCompletions
        ? {
            model,
            messages: [
              { role: 'system', content: SOP_REVERSE_SYSTEM_PROMPT },
              { role: 'user', content: buildChatUserContent(options.prompt, images) },
            ],
            stream: false,
          }
        : {
            model,
            instructions: SOP_REVERSE_SYSTEM_PROMPT,
            input: buildResponsesInput(options.prompt, images),
            stream: false,
          }),
    },
  )

  if (!response.ok) {
    const message = await getApiErrorMessage(response)
    throw new Error(`HTTP ${response.status}: ${message}`)
  }

  const text = await readSopReverseResponseText(response, useChatCompletions)
  if (!text.trim()) throw new Error('AI 没有返回可解析的拆解结果')
  return text.trim()
}
