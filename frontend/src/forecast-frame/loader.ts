import type {
  CycleManifest,
  FramePayloadRef,
  ScalarGridSpec,
} from '../manifest/types'
import type { WeatherMapConfig } from '../config'
import { joinUrl } from '../url/joinUrl'
import {
  ensurePayloadFrameCacheScope,
  payloadFrameCacheKey,
  readCachedPayloadFrame,
  writeCachedPayloadFrame,
} from '../forecast-cache/payloadFrameCache'
import type { FrameKind } from './spec'

export type LoadedFramePayload = {
  hourToken: string
  payload: ArrayBuffer
}

export type LoadFramePayloadArgs = {
  config: WeatherMapConfig
  manifest: CycleManifest
  frameRef: FramePayloadRef
  grid: ScalarGridSpec
  hourToken: string
  variableId: string
  frameKind: FrameKind
  signal: AbortSignal
  verifyPayloadSha256: boolean
}

export function normalizeFrameHourToken(value: string): string {
  return value.trim().padStart(3, '0')
}

export async function loadFramePayload(
  args: LoadFramePayloadArgs
): Promise<LoadedFramePayload> {
  const hourToken = normalizeFrameHourToken(args.hourToken)
  const payload = await loadCachedFramePayload(args)

  assertPayloadSize({
    frameKind: args.frameKind,
    variableId: args.variableId,
    hourToken,
    actualByteLength: payload.byteLength,
    expectedFrameByteLength: args.frameRef.byte_length,
    grid: args.grid,
  })

  if (args.verifyPayloadSha256) {
    await verifyPayloadSha({
      frameKind: args.frameKind,
      payload,
      expectedSha: args.frameRef.sha256,
      variableId: args.variableId,
      hourToken,
    })
  }

  return {
    hourToken,
    payload,
  }
}

async function loadCachedFramePayload(args: LoadFramePayloadArgs): Promise<ArrayBuffer> {
  await ensurePayloadFrameCacheScope(args.manifest)
  const cacheKey = payloadFrameCacheKey(args.manifest, args.frameRef)
  return getOrFetchFramePayload({
    config: args.config,
    manifest: args.manifest,
    frameRef: args.frameRef,
    cacheKey,
    signal: args.signal,
    frameKind: args.frameKind,
  })
}

async function getOrFetchFramePayload(args: {
  config: WeatherMapConfig
  manifest: CycleManifest
  frameRef: FramePayloadRef
  cacheKey: string
  signal: AbortSignal
  frameKind: FrameKind
}): Promise<ArrayBuffer> {
  const cached = await readCachedPayloadFrame(args.cacheKey)
  if (cached) return cached

  const payload = await fetchFramePayloadBuffer({
    artifactBaseUrl: args.config.artifactBaseUrl,
    payloadPath: args.frameRef.path,
    signal: args.signal,
    frameKind: args.frameKind,
  })

  await writeCachedPayloadFrame({
    manifest: args.manifest,
    key: args.cacheKey,
    payload,
  })

  return payload
}

async function fetchFramePayloadBuffer(args: {
  artifactBaseUrl: string
  payloadPath: string
  signal: AbortSignal
  frameKind: FrameKind
}): Promise<ArrayBuffer> {
  const payloadUrl = joinUrl(args.artifactBaseUrl, args.payloadPath)
  const response = await fetch(payloadUrl, { signal: args.signal })
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${args.frameKind} payload: ${response.status} ${response.statusText}`
    )
  }
  return response.arrayBuffer()
}

function assertPayloadSize(args: {
  frameKind: FrameKind
  variableId: string
  hourToken: string
  actualByteLength: number
  expectedFrameByteLength: number
  grid: ScalarGridSpec
}) {
  const { frameKind, variableId, hourToken, actualByteLength, expectedFrameByteLength, grid } = args
  if (actualByteLength !== expectedFrameByteLength) {
    throw new Error(
      `Unexpected ${frameKind} payload size for variable=${variableId} hour=${hourToken}: got=${actualByteLength} expected=${expectedFrameByteLength}`
    )
  }

  const expectedGridByteLength = grid.nx * grid.ny * 2
  if (actualByteLength !== expectedGridByteLength) {
    throw new Error(
      `${frameKind} payload bytes do not match grid dimensions for ${variableId}: got=${actualByteLength} expected=${expectedGridByteLength}`
    )
  }
}

async function verifyPayloadSha(args: {
  frameKind: FrameKind
  payload: ArrayBuffer
  expectedSha: string
  variableId: string
  hourToken: string
}) {
  const actualSha = await computeSha256Hex(args.payload)
  if (actualSha !== args.expectedSha.toLowerCase()) {
    throw new Error(
      `${args.frameKind} SHA-256 mismatch for variable=${args.variableId} hour=${args.hourToken}: expected=${args.expectedSha} actual=${actualSha}`
    )
  }
}

async function computeSha256Hex(payload: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('SHA-256 verification is unavailable: crypto.subtle is not supported')
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', payload)
  const bytes = new Uint8Array(digest)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
