import {
  forecastRunScopeKey,
  type ActiveForecastRun,
} from '@/forecast/manifest'
import {
  createPayloadCache,
  type PayloadCache,
  type PayloadCacheLimits,
  type PayloadCacheTestControls,
} from '@/forecast/cache/payloadCache'

const DEFAULT_PAYLOAD_CACHE_LIMITS: PayloadCacheLimits = {
  memoryBytes: 128 * 1024 * 1024,
  persistedBytes: 384 * 1024 * 1024,
}

const payloadCacheInstance = createPayloadCache({
  dbName: 'weather-map-frame-payload-cache',
  storeName: 'payloads',
  defaultLimits: DEFAULT_PAYLOAD_CACHE_LIMITS,
})
const payloadCache: PayloadCache = payloadCacheInstance
const payloadCacheTestControls: PayloadCacheTestControls = payloadCacheInstance

export function payloadCacheKey(
  activeRun: ActiveForecastRun,
  payloadRef: { path: string; byteLength: number }
): string {
  return [
    forecastRunScopeKey(activeRun),
    payloadRef.path,
    String(payloadRef.byteLength),
  ].join(':')
}

export async function ensurePayloadCacheScope(
  activeRun: ActiveForecastRun
): Promise<void> {
  await payloadCache.activateScope(forecastRunScopeKey(activeRun))
}

export async function readCachedPayload(
  key: string
): Promise<ArrayBuffer | null> {
  return payloadCache.read(key)
}

export async function writeCachedPayload(args: {
  activeRun: ActiveForecastRun
  key: string
  payload: ArrayBuffer
}): Promise<void> {
  await payloadCache.write({
    scopeKey: forecastRunScopeKey(args.activeRun),
    key: args.key,
    payload: args.payload,
  })
}

export async function __resetPayloadCacheForTests(): Promise<void> {
  await payloadCacheTestControls.resetForTests()
}

export async function __flushPayloadCacheForTests(): Promise<void> {
  await payloadCacheTestControls.flushForTests()
}

export function __setPayloadCacheLimitsForTests(limits: {
  memoryBytes?: number
  persistedBytes?: number
}) {
  payloadCacheTestControls.setLimitsForTests(limits)
}
