export type ByteLruEntry = {
  key: string
  byteLength: number
  lastAccessedAt: number
}

export function sumEntryBytes(entries: Iterable<Pick<ByteLruEntry, 'byteLength'>>): number {
  let total = 0
  for (const entry of entries) {
    total += Math.max(0, entry.byteLength)
  }
  return total
}

export function selectByteLruEvictionKeys(
  entries: ByteLruEntry[],
  maxBytes: number
): string[] {
  const normalizedMaxBytes = Math.max(0, maxBytes)
  let totalBytes = sumEntryBytes(entries)
  if (totalBytes <= normalizedMaxBytes) return []

  const evictionOrder = [...entries].sort((left, right) => {
    if (left.lastAccessedAt !== right.lastAccessedAt) {
      return left.lastAccessedAt - right.lastAccessedAt
    }
    return left.key.localeCompare(right.key)
  })

  const keysToEvict: string[] = []
  for (const entry of evictionOrder) {
    if (totalBytes <= normalizedMaxBytes) break
    keysToEvict.push(entry.key)
    totalBytes -= Math.max(0, entry.byteLength)
  }

  return keysToEvict
}
