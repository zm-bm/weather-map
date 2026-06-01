import type {
  ActiveForecastRun,
  ManifestArtifactSpec,
} from '@/forecast/manifest'
import type { WeatherMapConfig } from '@/core/config'
import { createAbortError } from '@/core/abort'
import { joinUrl } from '@/core/url/joinUrl'
import {
  ensurePayloadCacheScope,
  payloadCacheKey,
  readCachedPayload,
  writeCachedPayload,
} from './payloadCache'

type PayloadRef = {
  path: string
  byteLength: number
}

type ReadArtifactPayloadArgs = {
  config: WeatherMapConfig
  activeRun: ActiveForecastRun
  hourToken: string
  artifact: ManifestArtifactSpec
  signal: AbortSignal
}

const inFlightPayloadFetchesByKey = new Map<string, Promise<ArrayBuffer>>()

export async function readArtifactPayload(
  args: ReadArtifactPayloadArgs
): Promise<ArrayBuffer> {
  const {
    artifact,
    hourToken,
  } = args
  const artifactKind = artifact.kind
  const frameRef = resolvePayloadRef({
    activeRun: args.activeRun,
    hourToken,
    artifact,
  })

  await ensurePayloadCacheScope(args.activeRun)
  const cacheKey = payloadCacheKey(args.activeRun, frameRef)
  const cachedPayload = await readCachedPayload(cacheKey)
  const payload = cachedPayload ?? await waitForSharedPayloadFetch({
    cacheKey,
    signal: args.signal,
    fetchPayload: async () => {
      const fetchedPayload = await fetchFramePayloadBuffer({
        artifactBaseUrl: args.config.artifactBaseUrl,
        payloadPath: frameRef.path,
        artifactKind,
      })

      await writeCachedPayload({
        activeRun: args.activeRun,
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
  artifactKind: ManifestArtifactSpec['kind']
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

function resolvePayloadRef(args: {
  activeRun: ActiveForecastRun
  hourToken: string
  artifact: ManifestArtifactSpec
}): PayloadRef {
  const artifactId = String(args.artifact.id)
  const time = args.activeRun.latest.times.find((entry) => entry.id === args.hourToken)
  if (!time) {
    throw new Error(`No ${args.artifact.kind} frame ref for model=${args.activeRun.modelId} artifact=${artifactId} hour=${args.hourToken}`)
  }

  return {
    path: resolveFramePayloadPath({
      activeRun: args.activeRun,
      artifact: args.artifact,
      timeId: time.id,
    }),
    byteLength: args.artifact.byteLength,
  }
}

function resolveFramePayloadPath(args: {
  activeRun: ActiveForecastRun
  artifact: Pick<ManifestArtifactSpec, 'payloadFile'>
  timeId: string
}): string {
  const { payloadRoot } = args.activeRun.latest.run
  const { payloadFile } = args.artifact
  return [
    payloadRoot,
    args.timeId,
    payloadFile,
  ].join('/')
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
}
