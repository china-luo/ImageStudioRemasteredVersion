import type { ApiProfile } from '../types'
import { assertLlmResponseOk, postLlmRequest, readLlmResponseText, resolveLlmModel } from './llmTransport'

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

export async function callSopReverseApi(options: CallSopReverseApiOptions): Promise<string> {
  const useChatCompletions = options.profile.apiMode === 'chat'
  const model = resolveLlmModel(options.profile, useChatCompletions)
  const images = options.images ?? []
  const response = await postLlmRequest({
    profile: options.profile,
    signal: options.signal,
    useChatCompletions,
    body: useChatCompletions
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
        },
  })
  await assertLlmResponseOk(response)
  const text = await readLlmResponseText(response, useChatCompletions, { emptyError: 'AI 没有返回可解析的拆解结果' })
  if (!text.trim()) throw new Error('AI 没有返回可解析的拆解结果')
  return text.trim()
}
