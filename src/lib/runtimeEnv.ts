export function readRuntimeEnv(value: string | undefined): string {
  return String.prototype.trim.call(value ?? '')
}
