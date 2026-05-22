import type { ForecastDataPlan } from './plan'
import { normalizeHourToken } from './window'

type ForecastDataPrefetchChannel =
  | NonNullable<ForecastDataPlan['field']>
  | NonNullable<ForecastDataPlan['cloudLayers']>
  | NonNullable<ForecastDataPlan['precipTypeOverlay']>
  | NonNullable<ForecastDataPlan['pressureContours']>
  | NonNullable<ForecastDataPlan['particles']>

type ForecastDataPrefetchTask = {
  channel: ForecastDataPrefetchChannel
  hourToken: string
}

type PrefetchForecastDataArgs = {
  plan: ForecastDataPlan
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
    args.plan.lowerHourToken,
    args.plan.upperHourToken,
    ...nextHourTokensAfterUpper(args.plan, args.aheadHourCount),
  ])

  return hourTokens.flatMap((hourToken) => {
    return prefetchChannels(args.plan).map((channel) => ({ channel, hourToken }))
  })
}

function prefetchChannels(plan: ForecastDataPlan): ForecastDataPrefetchChannel[] {
  const channels: ForecastDataPrefetchChannel[] = []
  if (plan.field) channels.push(plan.field)
  if (plan.cloudLayers) channels.push(plan.cloudLayers)
  if (plan.precipTypeOverlay) channels.push(plan.precipTypeOverlay)
  if (plan.pressureContours) channels.push(plan.pressureContours)
  if (plan.particles) channels.push(plan.particles)
  return channels
}

function uniqueNormalizedHourTokens(hourTokens: readonly string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const hourToken of hourTokens) {
    const normalized = normalizeHourToken(hourToken)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    unique.push(normalized)
  }

  return unique
}

function nextHourTokensAfterUpper(
  plan: ForecastDataPlan,
  count: number
): string[] {
  if (plan.activeRun.latest.times.length === 0 || count <= 0) return []

  const normalizedHours = plan.activeRun.latest.times.map((time) => normalizeHourToken(time.id))
  const normalizedUpper = normalizeHourToken(plan.upperHourToken)
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
