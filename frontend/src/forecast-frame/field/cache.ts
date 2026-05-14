import type { FieldFrameData } from '../types'

const DECODED_FIELD_FRAME_CACHE_LIMIT = 6
const fieldFrameCache = new Map<string, FieldFrameData>()

export function clearFieldFrameCache() {
  fieldFrameCache.clear()
}

export function getCachedFieldFrame(cacheKey: string): FieldFrameData | null {
  const frame = fieldFrameCache.get(cacheKey)
  if (!frame) return null

  fieldFrameCache.delete(cacheKey)
  fieldFrameCache.set(cacheKey, frame)
  return frame
}

export function setCachedFieldFrame(cacheKey: string, frame: FieldFrameData): void {
  if (fieldFrameCache.has(cacheKey)) {
    fieldFrameCache.delete(cacheKey)
  }

  fieldFrameCache.set(cacheKey, frame)

  while (fieldFrameCache.size > DECODED_FIELD_FRAME_CACHE_LIMIT) {
    const oldestKey = fieldFrameCache.keys().next().value
    if (oldestKey == null) return
    fieldFrameCache.delete(oldestKey)
  }
}
