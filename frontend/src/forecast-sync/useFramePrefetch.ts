import { useEffect } from 'react'

import type { WeatherMapConfig } from '../config'
import { prefetchFramePayloads } from '../forecast-frame/prefetch'
import { normalizeFrameHourToken } from '../forecast-frame/loader'
import type { FrameKind } from '../forecast-frame/spec'
import type { SyncRequest } from './types'

const PREFETCH_CONCURRENCY = 2
const PREFETCH_AHEAD_HOUR_COUNT = 2

type PrefetchTask = {
  frameKind: FrameKind
  variableId: string
  hourToken: string
}

export type UseFramePrefetchArgs = {
  config: WeatherMapConfig
  request: SyncRequest | null
  enabled: boolean
}

export function useFramePrefetch({
  config,
  request,
  enabled,
}: UseFramePrefetchArgs): void {
  useEffect(() => {
    if (!enabled || request == null) return

    const controller = new AbortController()
    const tasks = createFramePayloadPrefetchTasks(request)

    void runPrefetchQueue({
      config,
      request,
      tasks,
      signal: controller.signal,
    })

    return () => {
      controller.abort()
    }
  }, [config, enabled, request])
}

function createFramePayloadPrefetchTasks(request: SyncRequest): PrefetchTask[] {
  const hourTokens = uniqueNormalizedHourTokens([
    request.lowerHourToken,
    request.upperHourToken,
    ...nextHourTokensAfterUpper(request, PREFETCH_AHEAD_HOUR_COUNT),
  ])

  return hourTokens.flatMap((hourToken) => [
    {
      frameKind: 'scalar' as const,
      variableId: request.activeScalar,
      hourToken,
    },
    {
      frameKind: 'vector' as const,
      variableId: request.activeVector,
      hourToken,
    },
  ])
}

function nextHourTokensAfterUpper(request: SyncRequest, count: number): string[] {
  const forecastHours = request.manifest.forecastHours
  if (forecastHours.length === 0 || count <= 0) return []

  const normalizedHours = forecastHours.map(normalizeFrameHourToken)
  const normalizedUpper = normalizeFrameHourToken(request.upperHourToken)
  const upperIndex = normalizedHours.indexOf(normalizedUpper)
  const startIndex = upperIndex < 0 ? -1 : upperIndex

  return Array.from({ length: count }, (_unused, idx) => (
    normalizedHours[(startIndex + idx + 1) % normalizedHours.length]
  )).filter((hourToken): hourToken is string => hourToken != null)
}

function uniqueNormalizedHourTokens(hourTokens: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const hourToken of hourTokens) {
    const normalized = normalizeFrameHourToken(hourToken)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    unique.push(normalized)
  }

  return unique
}

async function runPrefetchQueue(args: {
  config: WeatherMapConfig
  request: SyncRequest
  tasks: PrefetchTask[]
  signal: AbortSignal
}): Promise<void> {
  let nextTaskIndex = 0

  async function runWorker() {
    while (!args.signal.aborted) {
      const task = args.tasks[nextTaskIndex]
      nextTaskIndex += 1
      if (!task) return

      try {
        await prefetchFramePayloads({
          config: args.config,
          manifest: args.request.manifest,
          frameKind: task.frameKind,
          variableId: task.variableId,
          hourTokens: [task.hourToken],
          signal: args.signal,
        })
      } catch {
        // Prefetch is opportunistic; rendering sync owns user-visible errors.
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(PREFETCH_CONCURRENCY, args.tasks.length) },
      () => runWorker()
    )
  )
}
