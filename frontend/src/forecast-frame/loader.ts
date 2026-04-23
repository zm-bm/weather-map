import type {
  FramePayloadRef,
  ScalarGridSpec,
} from '../manifest/types'
import type { WeatherMapConfig } from '../config'
import { joinUrl } from '../url/joinUrl'
import type { FrameKind } from './spec'

export type LoadedFramePayload = {
  hourToken: string
  payload: ArrayBuffer
}

export type FramePayloadRequest = {
  config: WeatherMapConfig
  frameRef: FramePayloadRef
  grid: ScalarGridSpec
  hourToken: string
  variable: string
  domain: FrameKind
  signal: AbortSignal
  verifySha256: boolean
}

export function normalizeFrameHourToken(value: string): string {
  return value.trim().padStart(3, '0')
}

export async function loadFramePayload(
  args: FramePayloadRequest
): Promise<LoadedFramePayload> {
  const hourToken = normalizeFrameHourToken(args.hourToken)
  const payload = await fetchPayloadBuffer({
    serverUrl: args.config.serverUrl,
    payloadPath: args.frameRef.path,
    signal: args.signal,
    domain: args.domain,
  })

  assertPayloadSize({
    domain: args.domain,
    variable: args.variable,
    hourToken,
    actualByteLength: payload.byteLength,
    expectedFrameByteLength: args.frameRef.byte_length,
    grid: args.grid,
  })

  if (args.verifySha256) {
    await verifyPayloadSha({
      domain: args.domain,
      payload,
      expectedSha: args.frameRef.sha256,
      variable: args.variable,
      hourToken,
    })
  }

  return {
    hourToken,
    payload,
  }
}

async function fetchPayloadBuffer(args: {
  serverUrl: string
  payloadPath: string
  signal: AbortSignal
  domain: FrameKind
}): Promise<ArrayBuffer> {
  const payloadUrl = joinUrl(args.serverUrl, args.payloadPath)
  const response = await fetch(payloadUrl, { signal: args.signal })
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${args.domain} payload: ${response.status} ${response.statusText}`
    )
  }
  return response.arrayBuffer()
}

function assertPayloadSize(args: {
  domain: FrameKind
  variable: string
  hourToken: string
  actualByteLength: number
  expectedFrameByteLength: number
  grid: ScalarGridSpec
}) {
  const { domain, variable, hourToken, actualByteLength, expectedFrameByteLength, grid } = args
  if (actualByteLength !== expectedFrameByteLength) {
    throw new Error(
      `Unexpected ${domain} payload size for variable=${variable} hour=${hourToken}: got=${actualByteLength} expected=${expectedFrameByteLength}`
    )
  }

  const expectedGridByteLength = grid.nx * grid.ny * 2
  if (actualByteLength !== expectedGridByteLength) {
    throw new Error(
      `${domain} payload bytes do not match grid dimensions for ${variable}: got=${actualByteLength} expected=${expectedGridByteLength}`
    )
  }
}

async function verifyPayloadSha(args: {
  domain: FrameKind
  payload: ArrayBuffer
  expectedSha: string
  variable: string
  hourToken: string
}) {
  const actualSha = await computeSha256Hex(args.payload)
  if (actualSha !== args.expectedSha.toLowerCase()) {
    throw new Error(
      `${args.domain} SHA-256 mismatch for variable=${args.variable} hour=${args.hourToken}: expected=${args.expectedSha} actual=${actualSha}`
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
