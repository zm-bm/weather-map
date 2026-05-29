import type { ArtifactLoader } from '@/forecast/artifacts'
import type { ForecastWindowPlan } from '../plan'
import { loadWindowFrame } from './windowLoader'

type ForecastPrefetchTask = {
  windowPlan: ForecastWindowPlan
  hourToken: string
}

type PrefetchForecastFramesArgs = {
  windowPlans: readonly ForecastWindowPlan[]
  artifacts: ArtifactLoader
  lowerHourToken: string
  upperHourToken: string
  forecastHourTokens: readonly string[]
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
  const hourTokens = uniqueHourTokens([
    args.lowerHourToken,
    args.upperHourToken,
    ...nextHourTokensAfterUpper(args, args.aheadHourCount),
  ])

  return hourTokens.flatMap((hourToken) => {
    return args.windowPlans.map((windowPlan) => ({ windowPlan, hourToken }))
  })
}

function uniqueHourTokens(hourTokens: readonly string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const hourToken of hourTokens) {
    if (seen.has(hourToken)) continue
    seen.add(hourToken)
    unique.push(hourToken)
  }

  return unique
}

function nextHourTokensAfterUpper(
  args: Pick<PrefetchForecastFramesArgs, 'forecastHourTokens' | 'upperHourToken'>,
  count: number
): string[] {
  if (args.forecastHourTokens.length === 0 || count <= 0) return []

  const normalizedHours = args.forecastHourTokens
  const upperIndex = normalizedHours.indexOf(args.upperHourToken)
  const startIndex = upperIndex < 0 ? -1 : upperIndex

  return Array.from({ length: count }, (_unused, idx) => (
    normalizedHours[(startIndex + idx + 1) % normalizedHours.length]
  )).filter((hourToken): hourToken is string => hourToken != null)
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
        await loadWindowFrame(args.artifacts, task.windowPlan, task.hourToken)
      } catch {
        // Prefetch is opportunistic; rendering sync owns user-visible errors.
      }
    }
  }

  await Promise.all(
    Array.from({ length: workerCount }, () => runWorker())
  )
}
