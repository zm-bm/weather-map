import type { WeatherMapConfig } from '../config'
import type { ForecastFrameSelection } from '../forecast-time'
import type {
  CycleManifest,
  ScalarProductId,
  VectorProductId,
} from '../manifest'
import {
  loadScalarFrameWindow,
  prefetchScalarFrames,
} from './scalar/frame'
import {
  loadVectorFrameWindow,
} from './vector/frame'
import type { ScalarFrameWindowData } from './scalar/types'
import type { VectorFrameWindowData } from './vector/types'
import { normalizeFrameHourToken } from './loader'
import { prefetchFramePayloads } from './prefetch'
import type { FrameKind } from './spec'

export type ForecastFrames = {
  scalar: ScalarFrameWindowData
  vector: VectorFrameWindowData
}

export type PreviousForecastFrameWindows = {
  scalar?: ScalarFrameWindowData | null
  vector?: VectorFrameWindowData | null
}

export type LoadForecastFramesArgs = ForecastFrameSelection & {
  config: WeatherMapConfig
  manifest: CycleManifest
  activeScalar: ScalarProductId
  activeVector: VectorProductId
  previousWindows?: PreviousForecastFrameWindows
  signal: AbortSignal
}

type ForecastFramePrefetchTask = {
  frameKind: FrameKind
  variableId: string
  hourToken: string
}

export type PrefetchForecastFramesArgs = {
  config: WeatherMapConfig
  manifest: CycleManifest
  activeScalar: ScalarProductId
  activeVector: VectorProductId
  lowerHourToken: string
  upperHourToken: string
  aheadHourCount: number
  concurrency: number
  signal: AbortSignal
}

export async function loadForecastFrames(args: LoadForecastFramesArgs): Promise<ForecastFrames> {
  const [scalar, vector] = await Promise.all([
    loadScalarFrameWindow({
      config: args.config,
      manifest: args.manifest,
      previousWindow: args.previousWindows?.scalar ?? null,
      lowerHourToken: args.lowerHourToken,
      upperHourToken: args.upperHourToken,
      selectedValidTimeMs: args.selectedValidTimeMs,
      mix: args.mix,
      variable: args.activeScalar,
      signal: args.signal,
    }),
    loadVectorFrameWindow({
      config: args.config,
      manifest: args.manifest,
      previousWindow: args.previousWindows?.vector ?? null,
      lowerHourToken: args.lowerHourToken,
      upperHourToken: args.upperHourToken,
      selectedValidTimeMs: args.selectedValidTimeMs,
      mix: args.mix,
      variable: args.activeVector,
      signal: args.signal,
    }),
  ])

  return { scalar, vector }
}

export async function prefetchForecastFrames(args: PrefetchForecastFramesArgs): Promise<void> {
  const tasks = createForecastFramePrefetchTasks(args)
  if (tasks.length === 0) return

  await runPrefetchQueue({
    config: args.config,
    manifest: args.manifest,
    tasks,
    concurrency: args.concurrency,
    signal: args.signal,
  })
}

function createForecastFramePrefetchTasks(args: PrefetchForecastFramesArgs): ForecastFramePrefetchTask[] {
  const hourTokens = uniqueNormalizedHourTokens([
    args.lowerHourToken,
    args.upperHourToken,
    ...nextHourTokensAfterUpper(args.manifest, args.upperHourToken, args.aheadHourCount),
  ])

  return hourTokens.flatMap((hourToken) => [
    {
      frameKind: 'scalar' as const,
      variableId: args.activeScalar,
      hourToken,
    },
    {
      frameKind: 'vector' as const,
      variableId: args.activeVector,
      hourToken,
    },
  ])
}

function nextHourTokensAfterUpper(
  manifest: CycleManifest,
  upperHourToken: string,
  count: number
): string[] {
  if (manifest.times.length === 0 || count <= 0) return []

  const normalizedHours = manifest.times.map((time) => normalizeFrameHourToken(time.id))
  const normalizedUpper = normalizeFrameHourToken(upperHourToken)
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
  manifest: CycleManifest
  tasks: ForecastFramePrefetchTask[]
  concurrency: number
  signal: AbortSignal
}): Promise<void> {
  let nextTaskIndex = 0
  const workerCount = Math.min(
    Math.max(1, args.concurrency),
    args.tasks.length
  )

  async function runWorker() {
    while (!args.signal.aborted) {
      const task = args.tasks[nextTaskIndex]
      nextTaskIndex += 1
      if (!task) return

      try {
        if (task.frameKind === 'scalar') {
          await prefetchScalarFrames({
            config: args.config,
            manifest: args.manifest,
            variable: task.variableId,
            hourTokens: [task.hourToken],
            signal: args.signal,
          })
        } else {
          await prefetchFramePayloads({
            config: args.config,
            manifest: args.manifest,
            frameKind: task.frameKind,
            variableId: task.variableId,
            hourTokens: [task.hourToken],
            signal: args.signal,
          })
        }
      } catch {
        // Prefetch is opportunistic; rendering sync owns user-visible errors.
      }
    }
  }

  await Promise.all(
    Array.from({ length: workerCount }, () => runWorker())
  )
}
