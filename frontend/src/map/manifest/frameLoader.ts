import type {
  CycleManifest,
  FramePayloadRef,
  ScalarGridSpec,
} from './types'
import type { WeatherMapConfig } from '../../config'
import { joinUrl } from '../../url/joinUrl'
import {
  domainLabelCapital,
  domainLabelLower,
  resolveFrameSpec,
  type FrameDomainTypeMap,
  type FrameKind,
} from './frame'

export type { FrameKind } from './frame'

type LoadedFrameDomainTypeMap = FrameDomainTypeMap

export type LoadedFrame<D extends FrameKind> = {
  hourToken: string
  frameRef: FramePayloadRef
  grid: ScalarGridSpec
  payload: ArrayBuffer
} & LoadedFrameDomainTypeMap[D]

export type FrameLoadRequest = {
  config: WeatherMapConfig
  manifest: CycleManifest
  hourToken: string
  variable: string
  signal: AbortSignal
}

export type LoadFrameArgs<D extends FrameKind> = FrameLoadRequest & {
  domain: D
}

export async function loadFrame<D extends FrameKind>(
  args: LoadFrameArgs<D>
): Promise<LoadedFrame<D>> {
  const { config, manifest, variable, domain, signal } = args
  const hourToken = toHourToken(args.hourToken)

  const { frameRef, variableMeta, encoding, grid } = resolveFrameSpec(
    manifest,
    hourToken,
    variable,
    domain
  )

  const payload = await fetchPayloadBuffer({
    serverUrl: config.serverUrl,
    payloadPath: frameRef.path,
    signal,
    domain,
  })

  assertPayloadSize({
    domain,
    variable,
    hourToken,
    actualByteLength: payload.byteLength,
    expectedFrameByteLength: frameRef.byte_length,
    grid,
  })

  if (config.verifyScalarSha256) {
    await verifyPayloadSha({
      domain,
      payload,
      expectedSha: frameRef.sha256,
      variable,
      hourToken,
    })
  }

  return {
    hourToken,
    frameRef,
    grid,
    variableMeta,
    encoding,
    payload,
  } as LoadedFrame<D>
}

export function toHourToken(value: string): string {
  return value.trim().padStart(3, '0')
}

export async function computeSha256Hex(payload: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('SHA-256 verification is unavailable: crypto.subtle is not supported')
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', payload)
  const bytes = new Uint8Array(digest)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
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
      `Failed to fetch ${domainLabelLower(args.domain)} payload: ${response.status} ${response.statusText}`
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
      `Unexpected ${domainLabelLower(domain)} payload size for variable=${variable} hour=${hourToken}: got=${actualByteLength} expected=${expectedFrameByteLength}`
    )
  }

  const expectedGridByteLength = grid.nx * grid.ny * 2
  if (actualByteLength !== expectedGridByteLength) {
    throw new Error(
      `${domainLabelCapital(domain)} payload bytes do not match grid dimensions for ${variable}: got=${actualByteLength} expected=${expectedGridByteLength}`
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
      `${domainLabelCapital(args.domain)} SHA-256 mismatch for variable=${args.variable} hour=${args.hourToken}: expected=${args.expectedSha} actual=${actualSha}`
    )
  }
}
