import type { FieldTimeSliceData } from '../types'

const DECODED_FIELD_TIME_SLICE_CACHE_LIMIT = 6
const fieldTimeSliceCache = new Map<string, FieldTimeSliceData>()

export function clearFieldTimeSliceCache() {
  fieldTimeSliceCache.clear()
}

export function getCachedFieldTimeSlice(cacheKey: string): FieldTimeSliceData | null {
  const timeSlice = fieldTimeSliceCache.get(cacheKey)
  if (!timeSlice) return null

  fieldTimeSliceCache.delete(cacheKey)
  fieldTimeSliceCache.set(cacheKey, timeSlice)
  return timeSlice
}

export function setCachedFieldTimeSlice(cacheKey: string, timeSlice: FieldTimeSliceData): void {
  if (fieldTimeSliceCache.has(cacheKey)) {
    fieldTimeSliceCache.delete(cacheKey)
  }

  fieldTimeSliceCache.set(cacheKey, timeSlice)

  while (fieldTimeSliceCache.size > DECODED_FIELD_TIME_SLICE_CACHE_LIMIT) {
    const oldestKey = fieldTimeSliceCache.keys().next().value
    if (oldestKey == null) return
    fieldTimeSliceCache.delete(oldestKey)
  }
}
