import type { CloudLayersTimeSliceData } from '../types'

const DECODED_CLOUD_LAYERS_TIME_SLICE_CACHE_LIMIT = 4
const cloudLayersTimeSliceCache = new Map<string, CloudLayersTimeSliceData>()

export function clearCloudLayersTimeSliceCache() {
  cloudLayersTimeSliceCache.clear()
}

export function getCachedCloudLayersTimeSlice(cacheKey: string): CloudLayersTimeSliceData | null {
  const timeSlice = cloudLayersTimeSliceCache.get(cacheKey)
  if (!timeSlice) return null

  cloudLayersTimeSliceCache.delete(cacheKey)
  cloudLayersTimeSliceCache.set(cacheKey, timeSlice)
  return timeSlice
}

export function setCachedCloudLayersTimeSlice(cacheKey: string, timeSlice: CloudLayersTimeSliceData): void {
  if (cloudLayersTimeSliceCache.has(cacheKey)) {
    cloudLayersTimeSliceCache.delete(cacheKey)
  }

  cloudLayersTimeSliceCache.set(cacheKey, timeSlice)

  while (cloudLayersTimeSliceCache.size > DECODED_CLOUD_LAYERS_TIME_SLICE_CACHE_LIMIT) {
    const oldestKey = cloudLayersTimeSliceCache.keys().next().value
    if (oldestKey == null) return
    cloudLayersTimeSliceCache.delete(oldestKey)
  }
}
