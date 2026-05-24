export function joinUrl(base: string, path: string): string {
  const normalizedBase = base.replace(/\/+$/, '')
  const normalizedPath = path.replace(/^\/+/, '')
  if (normalizedPath.length === 0) return normalizedBase
  return `${normalizedBase}/${normalizedPath}`
}
