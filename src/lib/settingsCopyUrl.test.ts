import { describe, expect, it } from 'vitest'
import { isPristineNewOpenAIProfile, readCopyImportUrlOptions } from './settingsCopyUrl'

describe('settingsCopyUrl', () => {
  it('treats a blank new OpenAI profile as pristine', () => {
    expect(
      isPristineNewOpenAIProfile(
        {
          id: 'p1',
          name: '新配置',
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          model: 'gpt-image-2',
          timeout: 600,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
        {
          baseUrl: 'https://api.openai.com/v1',
          timeout: 600,
          imagesModel: 'gpt-image-2',
          apiProxy: false,
        },
      ),
    ).toBe(true)
  })

  it('defaults copy-import URL options without localStorage', () => {
    expect(readCopyImportUrlOptions()).toMatchObject({
      includeApiKey: false,
      useNewApiKey: true,
    })
  })
})
