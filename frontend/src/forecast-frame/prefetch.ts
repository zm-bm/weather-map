import type { ForecastFramePlan } from './plan'
import type { ForecastFrameChannel } from './types'
import { normalizeFrameHourToken } from './window'

type ForecastFramePrefetchTask = {
  channel: ForecastFrameChannel
  hourToken: string
}

type PrefetchForecastFramesArgs = {
  plan: ForecastFramePlan
  aheadHourCount: number
  concurrency: number
  signal: AbortSignal
}

export async function prefetchForecastFrames(args: PrefetchForecastFramesArgs): Promise<void> {
  const tasks = createForecastFramePrefetchTasks(args)
  if (tasks.length === 0) return

  await runPrefetchQueue({
    tasks,
    concurrency: args.concurrency,
    signal: args.signal,
  })
}

function createForecastFramePrefetchTasks(args: PrefetchForecastFramesArgs): ForecastFramePrefetchTask[] {
  const hourTokens = uniqueNormalizedHourTokens([
    args.plan.lowerHourToken,
    args.plan.upperHourToken,
    ...nextHourTokensAfterUpper(args.plan, args.aheadHourCount),
  ])

  return hourTokens.flatMap((hourToken) => {
    return prefetchChannels(args.plan).map((channel) => ({ channel, hourToken }))
  })
}

function prefetchChannels(plan: ForecastFramePlan): ForecastFrameChannel[] {
  return plan.particles == null ? [plan.field] : [plan.field, plan.particles]
}

function uniqueNormalizedHourTokens(hourTokens: readonly string[]): string[] {
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

function nextHourTokensAfterUpper(
  plan: ForecastFramePlan,
  count: number
): string[] {
  if (plan.manifest.times.length === 0 || count <= 0) return []

  const normalizedHours = plan.manifest.times.map((time) => normalizeFrameHourToken(time.id))
  const normalizedUpper = normalizeFrameHourToken(plan.upperHourToken)
  const upperIndex = normalizedHours.indexOf(normalizedUpper)
  const startIndex = upperIndex < 0 ? -1 : upperIndex

  return Array.from({ length: count }, (_unused, idx) => (
    normalizedHours[(startIndex + idx + 1) % normalizedHours.length]
  )).filter((hourToken): hourToken is string => hourToken != null)
}

async function runPrefetchQueue(args: {
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
        await task.channel.load(task.hourToken)
      } catch {
        // Prefetch is opportunistic; rendering sync owns user-visible errors.
      }
    }
  }

  await Promise.all(
    Array.from({ length: workerCount }, () => runWorker())
  )
}
