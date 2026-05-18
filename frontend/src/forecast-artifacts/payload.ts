import type {
  CycleManifest,
  FramePayloadRef,
  ManifestArtifactSpec,
} from '../manifest'
import type { WeatherMapConfig } from '../config'
import { createAbortError } from '../abort'
import { joinUrl } from '../url/joinUrl'
import {
  ensurePayloadFrameCacheScope,
  payloadFrameCacheKey,
  readCachedPayloadFrame,
  writeCachedPayloadFrame,
} from '../forecast-cache/payloadFrameCache'
import type { ArtifactKind } from './types'

type ResolvedArtifactPayload = {
  artifactId: string
  hourToken: string
  artifact: ManifestArtifactSpec
  frameRef: FramePayloadRef
}

type ReadArtifactPayloadArgs = {
  config: WeatherMapConfig
  manifest: CycleManifest
  resolved: ResolvedArtifactPayload
  signal: AbortSignal
}

const inFlightPayloadFetchesByKey = new Map<string, Promise<ArrayBuffer>>()

export async function readArtifactPayload(
  args: ReadArtifactPayloadArgs
): Promise<ArrayBuffer> {
  const {
    artifact,
    frameRef,
    hourToken,
  } = args.resolved
  const artifactKind = artifact.kind

  await ensurePayloadFrameCacheScope(args.manifest)
  const cacheKey = payloadFrameCacheKey(args.manifest, frameRef)
  const cachedPayload = await readCachedPayloadFrame(cacheKey)
  const payload = cachedPayload ?? await waitForSharedPayloadFetch({
    cacheKey,
    signal: args.signal,
    fetchPayload: async () => {
      const fetchedPayload = await fetchFramePayloadBuffer({
        artifactBaseUrl: args.config.artifactBaseUrl,
        payloadPath: frameRef.path,
        artifactKind,
      })

      await writeCachedPayloadFrame({
        manifest: args.manifest,
        key: cacheKey,
        payload: fetchedPayload,
      })

      return fetchedPayload
    },
  })

  assertPayloadSize({
    artifact,
    hourToken,
    actualByteLength: payload.byteLength,
    expectedFrameByteLength: frameRef.byteLength,
  })

  return payload
}

function waitForSharedPayloadFetch(args: {
  cacheKey: string
  signal: AbortSignal
  fetchPayload: () => Promise<ArrayBuffer>
}): Promise<ArrayBuffer> {
  if (args.signal.aborted) return Promise.reject(createAbortError())

  let inFlightFetch = inFlightPayloadFetchesByKey.get(args.cacheKey)
  if (!inFlightFetch) {
    const nextFetch = (async () => {
      try {
        return await args.fetchPayload()
      } finally {
        inFlightPayloadFetchesByKey.delete(args.cacheKey)
      }
    })()
    inFlightPayloadFetchesByKey.set(args.cacheKey, nextFetch)
    inFlightFetch = nextFetch
  }

  return waitForPayloadOrAbort(inFlightFetch, args.signal)
}

function waitForPayloadOrAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(createAbortError())

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(createAbortError())
    }

    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        if (signal.aborted) {
          reject(createAbortError())
          return
        }
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

async function fetchFramePayloadBuffer(args: {
  artifactBaseUrl: string
  payloadPath: string
  artifactKind: ArtifactKind
}): Promise<ArrayBuffer> {
  const payloadUrl = joinUrl(args.artifactBaseUrl, args.payloadPath)
  const response = await fetch(payloadUrl)
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${args.artifactKind} payload: ${response.status} ${response.statusText}`
    )
  }
  return response.arrayBuffer()
}

function assertPayloadSize(args: {
  artifact: ManifestArtifactSpec
  hourToken: string
  actualByteLength: number
  expectedFrameByteLength: number
}) {
  const {
    artifact,
    hourToken,
    actualByteLength,
    expectedFrameByteLength,
  } = args
  const artifactId = String(artifact.id)
  if (actualByteLength !== expectedFrameByteLength) {
    throw new Error(
      `Unexpected ${artifact.kind} payload size for artifact=${artifactId} hour=${hourToken}: got=${actualByteLength} expected=${expectedFrameByteLength}`
    )
  }

  if (artifact.kind !== 'vector') return

  const expectedGridByteLength = artifact.grid.nx * artifact.grid.ny * 2
  if (actualByteLength !== expectedGridByteLength) {
    throw new Error(
      `${artifact.kind} payload bytes do not match grid dimensions for ${artifactId}: got=${actualByteLength} expected=${expectedGridByteLength}`
    )
  }
}
