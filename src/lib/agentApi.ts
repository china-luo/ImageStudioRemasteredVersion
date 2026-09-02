// Legacy experimental Agent API. Main image generation should use api.ts instead.
import {
  DEFAULT_AGENT_MAX_TOOL_ROUNDS,
  type ApiProfile,
  type AppSettings,
  type ResponsesApiResponse,
  type ResponsesOutputItem,
  type TaskParams,
} from '../types'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from './devProxy'
import { createLlmAuthHeaders } from './llmTransport'
import {
  appendOutputResolutionToPrompt,
  getApiErrorMessage,
  getPromptOutputResolution,
  MIME_MAP,
  normalizeBase64Image,
  pickActualParams,
} from './imageApiShared'
import { prepareReferenceImageAndMaskPayload, prepareReferenceImagePayload } from './referenceImagePayload'

export interface AgentApiMessage {
  role: 'user' | 'assistant'
  text: string
  imageDataUrls?: string[]
}

export interface AgentApiResultImage {
  toolCallId?: string
  action?: string
  dataUrl: string
  actualParams?: Partial<TaskParams>
  revisedPrompt?: string
}

export interface AgentApiResult {
  responseId?: string
  text: string
  images: AgentApiResultImage[]
  outputItems: ResponsesApiResponse['output']
  rawResponsePayload?: string
}

const AGENT_IMAGE_INSTRUCTIONS = [
  'You are an image-generation assistant in a multi-turn gallery app.',
  '',
  '## Progressive Batch Generation',
  'For multi-image requests, use a progressive batching strategy to ensure consistency:',
  '  1. **Base Reference First:** If the images need to share a consistent style, character, or layout (e.g. PPT slides, storyboards), generate ONE primary image first to establish the visual baseline, then call continue_generation to get another round.',
  '  2. **Batch Remaining Tasks:** Once the base reference is available, list all remaining images to be generated. The app will generate them concurrently for you. In your descriptions, explicitly instruct to reference the base image to maintain consistency.',
  '  3. **Independent Images:** If the requested images are completely independent (e.g. "3 different cats"), generate them together in ONE response. Do NOT generate them one by one across multiple responses.',
  'As the turn continues, output a brief progress note before each tool call.',
  'For single-image requests, generate directly without any listing.',
  '',
  '## Generating images',
  '- One image_generation call per distinct image. Never collage.',
  '- Dependent images (a later image needs to reference an earlier one) → generate the prerequisite first, then call continue_generation. The next round will have the result available as `<ref id="..." />`.',
  '- Only generate when explicitly requested; otherwise reply with text.',
  "- Preserve the user's original intent faithfully. Never substitute requested subjects for copyright/trademark reasons.",
  '',
  '## Reference tags',
  'NEVER output `<ref>`, `<available_refs>`, or any XML reference tags in visible assistant text — the system injects them automatically and your raw output will be shown directly to the user.',
  '- In user messages: `<ref id="..." />` point to attached/cited images.',
  '- After assistant turns: `<available_refs>` list ids of generated images.',
  '- In generate_image_batch tool arguments: use bare ids in `reference_ids`, and also include matching `<ref id="..." />` tags inside that image prompt when the prompt refers to a reference image.',
  'Resolve user mentions ("the first image") to the matching id. Only use existing ids in image_generation prompts and generate_image_batch reference_ids.',
].join('\n')

function createAgentInstructions(settings: AppSettings, params: TaskParams) {
  const maxToolRounds = Number.isFinite(settings.agentMaxToolRounds)
    ? Math.max(1, Math.trunc(settings.agentMaxToolRounds))
    : DEFAULT_AGENT_MAX_TOOL_ROUNDS
  const outputResolution = getPromptOutputResolution(params.size)
  return [
    AGENT_IMAGE_INSTRUCTIONS,
    outputResolution
      ? [
          '',
          '## Technical output',
          `- Expected output resolution for every generated image: ${outputResolution} px.`,
          '- Include this exact resolution in final image-generation prompts and generate_image_batch item prompts as a technical output requirement, not visible image text.',
        ].join('\n')
      : '',
    '',
    '## Tool policy',
    `- Current maximum tool-use rounds for this Agent turn: ${maxToolRounds}.`,
    '- Call continue_generation ONLY when you have generated a prerequisite image and need another round to generate dependent images. Do NOT call it when the task is complete.',
    '- When web_search is available, use it only when current external information would improve the answer or the user asks for research/news/facts.',
    '- When the requested task is complete, stop calling tools and provide the final response.',
  ].join('\n')
}

const AGENT_TITLE_INSTRUCTIONS = [
  'Generate a concise conversation title from the first user message.',
  'Output exactly one XML element in this form: <title>short title</title>',
  'Do not output markdown, code fences, explanations, attributes, or additional XML elements.',
  'Use the main language of the user message. Chinese titles should be no more than 12 characters. English titles should be no more than 5 words.',
  'Escape XML special characters when necessary.',
].join('\n')

const AGENT_TITLE_MAX_LENGTH = 28

function createHeaders(profile: ApiProfile): Record<string, string> {
  return createLlmAuthHeaders(profile.apiKey)
}

function createImageTool(params: TaskParams, profile: ApiProfile, maskDataUrl?: string): Record<string, unknown> {
  const tool: Record<string, unknown> = {
    type: 'image_generation',
    action: 'auto',
    size: params.size,
    output_format: params.output_format,
    moderation: params.moderation,
  }

  tool.quality = params.quality

  if (params.output_format !== 'png' && params.output_compression != null) {
    tool.output_compression = params.output_compression
  }

  if (maskDataUrl) {
    tool.input_image_mask = {
      image_url: maskDataUrl,
    }
  }

  return tool
}

function createAgentTools(
  params: TaskParams,
  profile: ApiProfile,
  settings: AppSettings,
  maskDataUrl?: string,
): Array<Record<string, unknown>> {
  const tools: Array<Record<string, unknown>> = [createImageTool(params, profile, maskDataUrl)]

  // generate_image_batch: custom function tool for concurrent multi-image generation
  tools.push({
    type: 'function',
    name: 'generate_image_batch',
    description: [
      'Generate multiple images concurrently. Use this ONLY when:',
      '1. There are 2+ remaining images whose prerequisites (base references) are ALL already generated.',
      '2. These images are independent of each other (none references another image in this same batch).',
      'For single images or prerequisite/base images, use the built-in image_generation tool instead.',
      'Each image prompt must be self-contained and include full visual style descriptions.',
      'If an image needs to match a previously generated image, include its bare ref id in reference_ids AND include the corresponding XML tag (e.g. <ref id="round-1-image-1" />) inside that image prompt so the reference is unambiguous.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        images: {
          type: 'array',
          description: 'Array of images to generate concurrently.',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Short stable identifier for this image, e.g. "slide_2_problem", "scene_3".',
              },
              prompt: {
                type: 'string',
                description:
                  'Complete image generation prompt with all visual details. If reference_ids is non-empty, mention each referenced image using the matching XML tag, e.g. <ref id="round-1-image-1" />.',
              },
              reference_ids: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'Ref ids of previously generated images to use as visual reference (e.g. ["round-1-image-1"]). Pass empty array if no references needed.',
              },
            },
            required: ['id', 'prompt', 'reference_ids'],
            additionalProperties: false,
          },
        },
      },
      required: ['images'],
      additionalProperties: false,
    },
    strict: true,
  })

  // continue_generation: model calls this to request another round (e.g. after generating a prerequisite image)
  tools.push({
    type: 'function',
    name: 'continue_generation',
    description: [
      'Request another round to continue generating images.',
      'Call this ONLY when you have just generated a prerequisite/base image and still need to generate dependent images that reference it.',
      'Do NOT call this when the task is already complete.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Brief explanation of why another round is needed and what will be generated next.',
        },
      },
      required: ['reason'],
      additionalProperties: false,
    },
    strict: true,
  })

  if (settings.agentWebSearch) {
    tools.push({ type: 'web_search' })
  }
  return tools
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function collectResponsesInputImageDataUrls(value: unknown, output: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectResponsesInputImageDataUrls(item, output)
    return output
  }
  if (!isRecordValue(value)) return output

  if (value.type === 'input_image' && typeof value.image_url === 'string' && value.image_url.startsWith('data:')) {
    output.push(value.image_url)
    return output
  }

  for (const child of Object.values(value)) collectResponsesInputImageDataUrls(child, output)
  return output
}

function replaceResponsesInputImageDataUrls(
  value: unknown,
  replacements: string[],
  cursor: { index: number },
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => replaceResponsesInputImageDataUrls(item, replacements, cursor))
  }
  if (!isRecordValue(value)) return value

  if (value.type === 'input_image' && typeof value.image_url === 'string' && value.image_url.startsWith('data:')) {
    const nextUrl = replacements[cursor.index] ?? value.image_url
    cursor.index += 1
    return { ...value, image_url: nextUrl }
  }

  const next: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    next[key] = replaceResponsesInputImageDataUrls(child, replacements, cursor)
  }
  return next
}

function escapeMarkdownLinkLabel(text: string) {
  return text.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')
}

type ResponseTextAnnotation = NonNullable<NonNullable<ResponsesOutputItem['content']>[number]['annotations']>[number]

function applyUrlCitations(text: string, annotations: ResponseTextAnnotation[] | undefined) {
  const citations = (annotations ?? [])
    .filter(
      (annotation) =>
        annotation.type === 'url_citation' &&
        typeof annotation.url === 'string' &&
        annotation.url.trim() &&
        typeof annotation.start_index === 'number' &&
        typeof annotation.end_index === 'number' &&
        annotation.start_index >= 0 &&
        annotation.end_index > annotation.start_index &&
        annotation.end_index <= text.length,
    )
    .sort((a, b) => (a.start_index ?? 0) - (b.start_index ?? 0))

  if (citations.length === 0) return text

  let cursor = 0
  let output = ''
  for (const citation of citations) {
    const start = citation.start_index ?? 0
    const end = citation.end_index ?? start
    if (start < cursor) continue

    output += text.slice(cursor, start)
    const label = text.slice(start, end) || citation.title || citation.url || 'source'
    output += `[${escapeMarkdownLinkLabel(label)}](${citation.url})`
    cursor = end
  }
  output += text.slice(cursor)
  return output
}

function getAbortedSignal(signals: Array<AbortSignal | undefined>) {
  return signals.find((signal) => signal?.aborted)
}

function throwIfAborted(...signals: Array<AbortSignal | undefined>) {
  const signal = getAbortedSignal(signals)
  if (!signal) return
  throw signal.reason instanceof Error ? signal.reason : new DOMException('请求已停止', 'AbortError')
}

function _createInput(messages: AgentApiMessage[]) {
  return messages.map((message) => {
    const content: Array<Record<string, string>> = [
      { type: message.role === 'user' ? 'input_text' : 'output_text', text: message.text },
    ]

    if (message.role === 'user') {
      for (const dataUrl of message.imageDataUrls ?? []) {
        content.push({ type: 'input_image', image_url: dataUrl })
      }
    }

    return {
      role: message.role,
      content,
    }
  })
}

function extractText(payload: ResponsesApiResponse) {
  const chunks: string[] = []

  for (const item of payload.output ?? []) {
    if (item.type !== 'message') continue
    for (const part of item.content ?? []) {
      if ((part.type === 'output_text' || part.type === 'text') && typeof part.text === 'string') {
        chunks.push(applyUrlCitations(part.text, part.annotations))
      }
    }
  }

  return chunks.join('\n').trim()
}

function decodeXmlText(text: string) {
  return text.replace(
    /&(?:#(\d+)|#x([\da-fA-F]+)|amp|lt|gt|quot|apos);/g,
    (entity, decimal: string | undefined, hex: string | undefined) => {
      if (decimal) return String.fromCodePoint(Number(decimal))
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16))
      switch (entity) {
        case '&amp;':
          return '&'
        case '&lt;':
          return '<'
        case '&gt;':
          return '>'
        case '&quot;':
          return '"'
        case '&apos;':
          return "'"
        default:
          return entity
      }
    },
  )
}

function parseAgentConversationTitleXml(text: string) {
  const match = text.match(/<title>([\s\S]*?)<\/title>/i)
  const title = match ? decodeXmlText(match[1]).trim() : ''
  const chars = Array.from(title)
  if (chars.length <= AGENT_TITLE_MAX_LENGTH) return title
  return `${chars.slice(0, AGENT_TITLE_MAX_LENGTH - 3).join('')}...`
}

function extractImages(payload: ResponsesApiResponse, fallbackMime: string): AgentApiResultImage[] {
  const images: AgentApiResultImage[] = []

  for (const item of payload.output ?? []) {
    if (item.type !== 'image_generation_call') continue

    const result = item.result
    if (typeof result === 'string' && result.trim()) {
      images.push({
        toolCallId: typeof item.id === 'string' ? item.id : undefined,
        action: typeof item.action === 'string' ? item.action : undefined,
        dataUrl: normalizeBase64Image(result, fallbackMime),
        actualParams: pickActualParams(item),
        revisedPrompt: typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined,
      })
      continue
    }

    if (result && typeof result === 'object') {
      const b64 =
        typeof result.b64_json === 'string'
          ? result.b64_json
          : typeof result.image === 'string'
            ? result.image
            : typeof result.data === 'string'
              ? result.data
              : ''
      if (b64.trim()) {
        images.push({
          toolCallId: typeof item.id === 'string' ? item.id : undefined,
          action: typeof item.action === 'string' ? item.action : undefined,
          dataUrl: normalizeBase64Image(b64, fallbackMime),
          actualParams: pickActualParams(item),
          revisedPrompt: typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined,
        })
      }
    }
  }

  return images
}

function _extractImageFromOutputItem(item: ResponsesOutputItem, fallbackMime: string): AgentApiResultImage | null {
  if (item.type !== 'image_generation_call') return null

  const result = item.result
  const b64 =
    typeof result === 'string'
      ? result
      : result && typeof result === 'object'
        ? typeof result.b64_json === 'string'
          ? result.b64_json
          : typeof result.image === 'string'
            ? result.image
            : typeof result.data === 'string'
              ? result.data
              : ''
        : ''

  if (!b64.trim()) return null
  return {
    toolCallId: typeof item.id === 'string' ? item.id : undefined,
    action: typeof item.action === 'string' ? item.action : undefined,
    dataUrl: normalizeBase64Image(b64, fallbackMime),
    actualParams: pickActualParams(item),
    revisedPrompt: typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined,
  }
}

export async function callAgentResponsesApi(opts: {
  settings: AppSettings
  profile: ApiProfile
  params: TaskParams
  input: unknown
  maskDataUrl?: string
  signal?: AbortSignal
  onTextDelta?: (delta: string) => void
  onOutputItems?: (outputItems: ResponsesOutputItem[]) => void
  onImageToolStarted?: (event: { toolCallId: string; outputIndex?: number }) => void | Promise<void>
  onImageToolCompleted?: (image: AgentApiResultImage) => void | Promise<void>
}): Promise<AgentApiResult> {
  const {
    settings,
    profile,
    params,
    input,
    maskDataUrl,
    signal,
    onTextDelta: _onTextDelta,
    onOutputItems: _onOutputItems,
    onImageToolStarted: _onImageToolStarted,
    onImageToolCompleted: _onImageToolCompleted,
  } = opts
  const mime = MIME_MAP[params.output_format] || 'image/png'
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(profile.apiProxy, proxyConfig, profile.baseUrl)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), profile.timeout * 1000)
  const abortFromCaller = () => controller.abort()
  if (signal?.aborted) controller.abort()
  signal?.addEventListener('abort', abortFromCaller, { once: true })

  try {
    const inputImageDataUrls = collectResponsesInputImageDataUrls(input)
    const preparedPayload = await prepareReferenceImageAndMaskPayload(inputImageDataUrls, maskDataUrl, {
      signal: controller.signal,
    })
    const preparedInput = preparedPayload.dataUrls.length
      ? replaceResponsesInputImageDataUrls(input, preparedPayload.dataUrls, { index: 0 })
      : input

    const body: Record<string, unknown> = {
      model: profile.model || settings.model,
      instructions: createAgentInstructions(settings, params),
      input: preparedInput,
      tools: createAgentTools(params, profile, settings, preparedPayload.maskDataUrl),
    }

    const response = await fetch(buildApiUrl(profile.baseUrl, 'responses', proxyConfig, useApiProxy), {
      method: 'POST',
      headers: createHeaders(profile),
      cache: 'no-store',
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response))
    }

    const payload = (await response.json()) as ResponsesApiResponse
    throwIfAborted(controller.signal, signal)
    return {
      responseId: payload.id,
      text: extractText(payload),
      images: extractImages(payload, mime),
      outputItems: payload.output,
      rawResponsePayload: JSON.stringify(payload, null, 2),
    }
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', abortFromCaller)
  }
}

export async function callAgentConversationTitleApi(opts: {
  settings: AppSettings
  profile: ApiProfile
  prompt: string
  imageDataUrls?: string[]
  signal?: AbortSignal
}): Promise<string> {
  const { settings, profile, prompt, imageDataUrls, signal } = opts
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(profile.apiProxy, proxyConfig, profile.baseUrl)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), profile.timeout * 1000)
  const abortFromCaller = () => controller.abort()
  if (signal?.aborted) controller.abort()
  signal?.addEventListener('abort', abortFromCaller, { once: true })

  try {
    const preparedPayload = await prepareReferenceImagePayload(imageDataUrls ?? [], { signal: controller.signal })
    const content: Array<Record<string, string>> = [
      {
        type: 'input_text',
        text: `The following is the first message the user sent in a conversation. Generate a title for this conversation.\n\n${prompt}`,
      },
    ]
    for (const dataUrl of preparedPayload.dataUrls) {
      content.push({ type: 'input_image', image_url: dataUrl })
    }

    const response = await fetch(buildApiUrl(profile.baseUrl, 'responses', proxyConfig, useApiProxy), {
      method: 'POST',
      headers: createHeaders(profile),
      cache: 'no-store',
      body: JSON.stringify({
        model: profile.model || settings.model,
        instructions: AGENT_TITLE_INSTRUCTIONS,
        input: [{ role: 'user', content }],
        max_output_tokens: 32,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response))
    }

    const payload = (await response.json()) as ResponsesApiResponse
    return parseAgentConversationTitleXml(extractText(payload))
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', abortFromCaller)
  }
}

// ---------------------------------------------------------------------------
// Batch image generation: execute a single image via Responses API
// Uses the same pattern as gallery Responses API mode:
//   - PROMPT_REWRITE_GUARD to prevent prompt modification
//   - tool_choice: 'required' to force immediate generation
//   - Reference images passed as input_image
// ---------------------------------------------------------------------------

const PROMPT_REWRITE_GUARD_PREFIX = 'Use the following text as the complete prompt. Do not rewrite it:'

export interface BatchImageCallResult {
  /** The batch item id from the model's function call */
  batchItemId: string
  image: AgentApiResultImage | null
  error: string | null
  rawResponsePayload?: string
}

/**
 * Generate a single image using Responses API with prompt-rewrite guard.
 * This mirrors the gallery mode's callResponsesImageApiSingle pattern.
 */
export async function callBatchImageSingle(opts: {
  profile: ApiProfile
  params: TaskParams
  batchItemId: string
  prompt: string
  referenceImageDataUrls: string[]
  referenceIds?: string[]
  signal?: AbortSignal
  onImageToolStarted?: () => void | Promise<void>
  onImageToolCompleted?: (image: AgentApiResultImage) => void | Promise<void>
}): Promise<BatchImageCallResult> {
  const {
    profile,
    params,
    batchItemId,
    prompt,
    referenceImageDataUrls,
    referenceIds,
    signal,
    onImageToolStarted: _onImageToolStarted,
    onImageToolCompleted,
  } = opts
  const promptWithOutputResolution = appendOutputResolutionToPrompt(prompt, params.size)
  const mime = MIME_MAP[params.output_format] || 'image/png'
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(profile.apiProxy, proxyConfig, profile.baseUrl)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), profile.timeout * 1000)
  const abortFromCaller = () => controller.abort()
  if (signal?.aborted) controller.abort()
  signal?.addEventListener('abort', abortFromCaller, { once: true })

  try {
    const preparedReferencePayload = await prepareReferenceImagePayload(referenceImageDataUrls, {
      signal: controller.signal,
    })
    const apiReferenceImageDataUrls = preparedReferencePayload.dataUrls
    // Build input: reference id mapping + prompt-rewrite guard + reference images.
    const referenceMapping =
      apiReferenceImageDataUrls.length > 0
        ? `Attached reference images correspond to these ids, in order: ${(referenceIds ?? []).map((id) => `<ref id="${id}" />`).join(', ') || 'reference images'}.`
        : ''
    const guardedPrompt = [referenceMapping, `${PROMPT_REWRITE_GUARD_PREFIX}\n${promptWithOutputResolution}`]
      .filter(Boolean)
      .join('\n\n')
    let input: unknown
    if (apiReferenceImageDataUrls.length > 0) {
      input = [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: guardedPrompt },
            ...apiReferenceImageDataUrls.map((dataUrl) => ({
              type: 'input_image',
              image_url: dataUrl,
            })),
          ],
        },
      ]
    } else {
      input = guardedPrompt
    }

    // Build image_generation tool with current params
    const tool: Record<string, unknown> = {
      type: 'image_generation',
      action: apiReferenceImageDataUrls.length > 0 ? 'auto' : 'generate',
      size: params.size,
      output_format: params.output_format,
      moderation: params.moderation,
      quality: params.quality,
    }
    if (params.output_format !== 'png' && params.output_compression != null) {
      tool.output_compression = params.output_compression
    }

    const body: Record<string, unknown> = {
      model: profile.model,
      input,
      tools: [tool],
      tool_choice: 'required',
    }

    const response = await fetch(buildApiUrl(profile.baseUrl, 'responses', proxyConfig, useApiProxy), {
      method: 'POST',
      headers: createHeaders(profile),
      cache: 'no-store',
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!response.ok) {
      const errorMsg = await getApiErrorMessage(response)
      return { batchItemId, image: null, error: errorMsg }
    }

    const payload = (await response.json()) as ResponsesApiResponse
    const images = extractImages(payload, mime)
    const image = images[0] ?? null
    if (image) await onImageToolCompleted?.(image)
    return {
      batchItemId,
      image,
      error: image ? null : '接口未返回图片数据',
      rawResponsePayload: JSON.stringify(payload, null, 2),
    }
  } catch (err) {
    if (controller.signal.aborted || signal?.aborted) {
      return { batchItemId, image: null, error: '请求已取消' }
    }
    return { batchItemId, image: null, error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', abortFromCaller)
  }
}

/** Parse the arguments of a generate_image_batch function call */
export function parseBatchImageCallArguments(
  args: string,
): Array<{ id: string; prompt: string; reference_ids: string[] }> | null {
  try {
    const parsed = JSON.parse(args) as { images?: unknown }
    if (!parsed || !Array.isArray(parsed.images)) return null
    const items: Array<{ id: string; prompt: string; reference_ids: string[] }> = []
    for (const raw of parsed.images) {
      if (!raw || typeof raw !== 'object') continue
      const item = raw as Record<string, unknown>
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : ''
      if (!prompt) continue
      const reference_ids = Array.isArray(item.reference_ids)
        ? (item.reference_ids as unknown[]).filter((r): r is string => typeof r === 'string')
        : []
      items.push({ id: id || `image_${items.length + 1}`, prompt, reference_ids })
    }
    return items.length > 0 ? items : null
  } catch {
    return null
  }
}
