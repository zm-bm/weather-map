import type { FieldTimeSliceData } from '../types'
import { createLruCache } from '../lruCache'

const DECODED_FIELD_TIME_SLICE_CACHE_LIMIT = 6
const fieldTimeSliceCache = createLruCache<FieldTimeSliceData>(
  DECODED_FIELD_TIME_SLICE_CACHE_LIMIT
)

export function clearFieldTimeSliceCache() {
  fieldTimeSliceCache.clear()
}

export function getCachedFieldTimeSlice(cacheKey: string): FieldTimeSliceData | null {
  return fieldTimeSliceCache.get(cacheKey)
}

export function setCachedFieldTimeSlice(cacheKey: string, timeSlice: FieldTimeSliceData): void {
  fieldTimeSliceCache.set(cacheKey, timeSlice)
}
