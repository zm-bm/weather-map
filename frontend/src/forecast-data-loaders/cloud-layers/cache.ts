import type { CloudLayersTimeSliceData } from '../types'
import { createLruCache } from '../lruCache'

const DECODED_CLOUD_LAYERS_TIME_SLICE_CACHE_LIMIT = 4
const cloudLayersTimeSliceCache = createLruCache<CloudLayersTimeSliceData>(
  DECODED_CLOUD_LAYERS_TIME_SLICE_CACHE_LIMIT
)

export function clearCloudLayersTimeSliceCache() {
  cloudLayersTimeSliceCache.clear()
}

export function getCachedCloudLayersTimeSlice(cacheKey: string): CloudLayersTimeSliceData | null {
  return cloudLayersTimeSliceCache.get(cacheKey)
}

export function setCachedCloudLayersTimeSlice(cacheKey: string, timeSlice: CloudLayersTimeSliceData): void {
  cloudLayersTimeSliceCache.set(cacheKey, timeSlice)
}
