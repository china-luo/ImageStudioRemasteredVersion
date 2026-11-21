/// <reference types="vite/client" />

declare const __APP_VERSION__: string | undefined
declare const __DEV_PROXY_CONFIG__: unknown

interface Window {
  readonly imageStudioDesktop?: {
    readonly isDesktop: boolean
    readonly platform: string
    readonly selectImageSaveDirectory?: () => Promise<boolean>
    readonly saveImageFile?: (file: { fileName: string; data: Uint8Array }) => Promise<string>
    readonly finishImageSave?: () => Promise<void>
    readonly fetch?: (payload: {
      url: string
      method?: string
      headers?: Record<string, string>
      body?: number[]
      allowedHosts?: string[]
    }) => Promise<{
      status: number
      statusText: string
      headers: Record<string, string>
      body: number[]
    }>
    readonly getSecrets?: () => Promise<{
      vocApiKey: string
      apiKey: string
      profiles: Record<string, string>
    }>
    readonly setSecrets?: (payload: {
      vocApiKey: string
      apiKey: string
      profiles: Record<string, string>
    }) => Promise<boolean>
  }
}

interface ImportMetaEnv {
  readonly VITE_DEFAULT_API_URL?: string
  readonly VITE_API_PROXY_AVAILABLE?: string
  readonly VITE_API_PROXY_LOCKED?: string
  readonly VITE_DOCKER_DEPLOYMENT?: string
  readonly VITE_DOCKER_LEGACY_API_URL_USED?: string
  readonly VITE_APP_VERSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
