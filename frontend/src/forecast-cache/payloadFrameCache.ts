import type { CycleManifest, FramePayloadRef } from '../manifest'
import {
  createPayloadCache,
  type PayloadCacheLimits,
} from './payloadCache'

const DEFAULT_FRAME_PAYLOAD_CACHE_LIMITS: PayloadCacheLimits = {
  memoryBytes: 128 * 1024 * 1024,
  persistedBytes: 384 * 1024 * 1024,
}

const payloadFrameCache = createPayloadCache({
  dbName: 'weather-map-frame-payload-cache',
  storeName: 'payloads',
  defaultLimits: DEFAULT_FRAME_PAYLOAD_CACHE_LIMITS,
})

export function payloadFrameCacheKey(
  manifest: Pick<CycleManifest, 'revision'>,
  frameRef: Pick<FramePayloadRef, 'path' | 'sha256' | 'byte_length'>
): string {
  return [
    manifest.revision,
    frameRef.path,
    frameRef.sha256.toLowerCase(),
    String(frameRef.byte_length),
  ].join(':')
}

export async function ensurePayloadFrameCacheScope(
  manifest: Pick<CycleManifest, 'cycle' | 'revision'>
): Promise<void> {
  await payloadFrameCache.activateScope(payloadFrameScopeKey(manifest))
}

export async function readCachedPayloadFrame(
  key: string
): Promise<ArrayBuffer | null> {
  return payloadFrameCache.read(key)
}

export async function writeCachedPayloadFrame(args: {
  manifest: Pick<CycleManifest, 'cycle' | 'revision'>
  key: string
  payload: ArrayBuffer
}): Promise<void> {
  await payloadFrameCache.write({
    scopeKey: payloadFrameScopeKey(args.manifest),
    key: args.key,
    payload: args.payload,
  })
}

export async function __resetPayloadFrameCacheForTests(): Promise<void> {
  await payloadFrameCache.resetForTests()
}

export async function __flushPayloadFrameCacheForTests(): Promise<void> {
  await payloadFrameCache.flushForTests()
}

export function __setPayloadFrameCacheLimitsForTests(limits: {
  memoryBytes?: number
  persistedBytes?: number
}) {
  payloadFrameCache.setLimitsForTests(limits)
}

function payloadFrameScopeKey(
  manifest: Pick<CycleManifest, 'cycle' | 'revision'>
): string {
  return `${manifest.cycle}:${manifest.revision}`
}
