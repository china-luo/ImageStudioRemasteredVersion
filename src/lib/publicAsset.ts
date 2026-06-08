export function getPublicAssetUrl(fileName: string): string {
  const normalizedFileName = fileName.replace(/^\/+/, '')
  const baseUrl = import.meta.env.BASE_URL || './'
  return new URL(`${baseUrl}${normalizedFileName}`, window.location.href).toString()
}
