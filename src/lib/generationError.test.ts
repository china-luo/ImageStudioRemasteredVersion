import { describe, expect, it } from 'vitest'
import { summarizeGenerationError } from './generationError'

describe('summarizeGenerationError', () => {
  it('summarizes provider JSON server errors in Chinese and keeps request id', () => {
    const message = summarizeGenerationError(JSON.stringify({
      error: {
        type: 'server_error',
        code: 'server_error',
        message: 'An error occurred while processing your request. You can retry your request, or contact us through our help center at help.openai.com if the error persists. Please include the request ID 0ff61b97-2a54-4948-aa82-d4b06dc98f1c in your message.',
        param: null,
      },
    }))

    expect(message).toContain('生成失败：生图服务商处理请求时发生临时错误。')
    expect(message).toContain('请求 ID：0ff61b97-2a54-4948-aa82-d4b06dc98f1c')
    expect(message).toContain('code=server_error')
    expect(message).not.toContain('help.openai.com')
  })

  it('summarizes stream internal errors in Chinese', () => {
    const message = summarizeGenerationError('stream error: stream ID 1; INTERNAL_ERROR; received from peer')

    expect(message).toContain('生成失败：流式连接在生成过程中中断。')
    expect(message).toContain('流式任务：1')
    expect(message).toContain('关闭流式图片')
    expect(message).not.toContain('received from peer')
  })
})
