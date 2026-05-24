import type { ForecastDataRequest } from './request'
import type { ForecastDataLoad } from './loadDefinition'
import { normalizeForecastHourToken } from '@/forecast/manifest'

type ForecastDataPrefetchTask = {
  load: ForecastDataLoad
  hourToken: string
}

type PrefetchForecastDataArgs = {
  request: ForecastDataRequest
  aheadHourCount: number
  concurrency: number
  signal: AbortSignal
}

export async function prefetchForecastData(args: PrefetchForecastDataArgs): Promise<void> {
  const tasks = createForecastDataPrefetchTasks(args)
  if (tasks.length === 0) return

  await runPrefetchQueue({
    tasks,
    concurrency: args.concurrency,
    signal: args.signal,
  })
}

function createForecastDataPrefetchTasks(args: PrefetchForecastDataArgs): ForecastDataPrefetchTask[] {
  const hourTokens = uniqueNormalizedHourTokens([
    args.request.lowerHourToken,
    args.request.upperHourToken,
    ...nextHourTokensAfterUpper(args.request, args.aheadHourCount),
  ])

  return hourTokens.flatMap((hourToken) => {
    return args.request.loads.map((load) => ({ load, hourToken }))
  })
}

function uniqueNormalizedHourTokens(hourTokens: readonly string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const hourToken of hourTokens) {
    const normalized = normalizeForecastHourToken(hourToken)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    unique.push(normalized)
  }

  return unique
}

function nextHourTokensAfterUpper(
  request: ForecastDataRequest,
  count: number
): string[] {
  if (request.activeRun.latest.times.length === 0 || count <= 0) return []

  const normalizedHours = request.activeRun.latest.times.map((time) => normalizeForecastHourToken(time.id))
  const normalizedUpper = normalizeForecastHourToken(request.upperHourToken)
  const upperIndex = normalizedHours.indexOf(normalizedUpper)
  const startIndex = upperIndex < 0 ? -1 : upperIndex

  return Array.from({ length: count }, (_unused, idx) => (
    normalizedHours[(startIndex + idx + 1) % normalizedHours.length]
  )).filter((hourToken): hourToken is string => hourToken != null)
}

async function runPrefetchQueue(args: {
  tasks: ForecastDataPrefetchTask[]
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
        await task.load.loadTimeSlice(task.hourToken)
      } catch {
        // Prefetch is opportunistic; rendering sync owns user-visible errors.
      }
    }
  }

  await Promise.all(
    Array.from({ length: workerCount }, () => runWorker())
  )
}
