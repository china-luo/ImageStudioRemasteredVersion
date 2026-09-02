const COPY_IMPORT_URL_OPTIONS_STORAGE_KEY = 'gpt-image-playground.copy-import-url-options'

export const DEFAULT_COPY_IMPORT_URL_OPTIONS = {
  includeApiKey: false,
  useNewApiAddress: false,
  useNewApiKey: true,
  useNewApiModel: false,
}

export type CopyImportUrlOptions = typeof DEFAULT_COPY_IMPORT_URL_OPTIONS

export function readCopyImportUrlOptions(): CopyImportUrlOptions {
  if (typeof window === 'undefined') return DEFAULT_COPY_IMPORT_URL_OPTIONS

  try {
    const saved = window.localStorage.getItem(COPY_IMPORT_URL_OPTIONS_STORAGE_KEY)
    if (!saved) return DEFAULT_COPY_IMPORT_URL_OPTIONS

    const parsed = JSON.parse(saved) as Partial<CopyImportUrlOptions> | null
    if (!parsed || typeof parsed !== 'object') return DEFAULT_COPY_IMPORT_URL_OPTIONS

    return {
      includeApiKey: false,
      useNewApiAddress: Boolean(parsed.useNewApiAddress),
      useNewApiKey: parsed.useNewApiKey === undefined ? true : Boolean(parsed.useNewApiKey),
      useNewApiModel: Boolean(parsed.useNewApiModel),
    }
  } catch {
    return DEFAULT_COPY_IMPORT_URL_OPTIONS
  }
}

export function saveCopyImportUrlOptions(options: CopyImportUrlOptions) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(
      COPY_IMPORT_URL_OPTIONS_STORAGE_KEY,
      JSON.stringify({
        useNewApiAddress: options.useNewApiAddress,
        useNewApiKey: options.useNewApiKey,
        useNewApiModel: options.useNewApiModel,
      }),
    )
  } catch {
    // localStorage 不可用时只保留当前会话状态。
  }
}

export function isPristineNewOpenAIProfile(
  profile: {
    id: string
    name: string
    provider: string
    baseUrl: string
    apiKey: string
    model: string
    timeout: number
    apiMode: string
    codexCli: boolean
    apiProxy: boolean
  },
  defaults: { baseUrl: string; timeout: number; imagesModel: string; apiProxy: boolean },
) {
  return (
    profile.name === '新配置' &&
    profile.provider === 'openai' &&
    profile.baseUrl === defaults.baseUrl &&
    profile.apiKey === '' &&
    profile.model === defaults.imagesModel &&
    profile.timeout === defaults.timeout &&
    profile.apiMode === 'images' &&
    profile.codexCli === false &&
    profile.apiProxy === defaults.apiProxy
  )
}
