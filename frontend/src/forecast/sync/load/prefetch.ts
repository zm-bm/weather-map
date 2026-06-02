import type { ArtifactLoader } from '@/forecast/artifacts'
import type { ForecastWindowPlan } from '../plan'
import { loadWindowFrame } from './windowLoader'

type ForecastPrefetchTask = {
  windowPlan: ForecastWindowPlan
  frameId: string
}

type PrefetchForecastFramesArgs = {
  windowPlans: readonly ForecastWindowPlan[]
  artifacts: ArtifactLoader
  lowerFrameId: string
  upperFrameId: string
  frameIds: readonly string[]
  aheadHourCount: number
  concurrency: number
  signal: AbortSignal
}

export async function prefetchForecastFrames(args: PrefetchForecastFramesArgs): Promise<void> {
  const tasks = createForecastPrefetchTasks(args)
  if (tasks.length === 0) return

  await runPrefetchQueue({
    tasks,
    artifacts: args.artifacts,
    concurrency: args.concurrency,
    signal: args.signal,
  })
}

function createForecastPrefetchTasks(args: PrefetchForecastFramesArgs): ForecastPrefetchTask[] {
  const frameIds = uniqueFrameIds([
    args.lowerFrameId,
    args.upperFrameId,
    ...nextFrameIdsAfterUpper(args, args.aheadHourCount),
  ])

  return frameIds.flatMap((frameId) => {
    return args.windowPlans.map((windowPlan) => ({ windowPlan, frameId }))
  })
}

function uniqueFrameIds(frameIds: readonly string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const frameId of frameIds) {
    if (seen.has(frameId)) continue
    seen.add(frameId)
    unique.push(frameId)
  }

  return unique
}

function nextFrameIdsAfterUpper(
  args: Pick<PrefetchForecastFramesArgs, 'frameIds' | 'upperFrameId'>,
  count: number
): string[] {
  if (args.frameIds.length === 0 || count <= 0) return []

  const normalizedFrameIds = args.frameIds
  const upperIndex = normalizedFrameIds.indexOf(args.upperFrameId)
  const startIndex = upperIndex < 0 ? -1 : upperIndex

  return Array.from({ length: count }, (_unused, idx) => (
    normalizedFrameIds[(startIndex + idx + 1) % normalizedFrameIds.length]
  )).filter((frameId): frameId is string => frameId != null)
}

async function runPrefetchQueue(args: {
  tasks: ForecastPrefetchTask[]
  artifacts: ArtifactLoader
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
        await loadWindowFrame(args.artifacts, task.windowPlan, task.frameId)
      } catch {
        // Prefetch is opportunistic; rendering sync owns user-visible errors.
      }
    }
  }

  await Promise.all(
    Array.from({ length: workerCount }, () => runWorker())
  )
}
