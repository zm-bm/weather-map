import type { ReadonlyNonEmptyArray } from '@/core/types'
import type { RasterBandOrder } from '@/forecast/artifacts'
import type { ForecastWindowId } from '@/forecast/frames'
import type {
  ForecastFramePlan,
  ForecastWindowFailurePolicy,
  ForecastWindowPlan,
} from '../plan'

type ForecastFramePlanFixtureArgs = {
  source: ForecastFramePlan['source']
  artifactId: string
  bandIds: ReadonlyNonEmptyArray<string>
  cacheKeyPrefix: string
  order?: RasterBandOrder
  failurePolicy?: ForecastWindowFailurePolicy
}

type ForecastWindowPlanFixtureArgs = {
  id: ForecastWindowId
  key: string
  failurePolicy: ForecastWindowFailurePolicy
  frames: ReadonlyNonEmptyArray<ForecastFramePlanFixtureArgs>
}

export function createForecastFramePlanTestFixture(
  args: ForecastFramePlanFixtureArgs
): ForecastFramePlan {
  return {
    source: args.source,
    artifactId: args.artifactId,
    bandIds: args.bandIds,
    cacheKeyPrefix: args.cacheKeyPrefix,
    ...(args.order === undefined ? {} : { order: args.order }),
    ...(args.failurePolicy === undefined ? {} : { failurePolicy: args.failurePolicy }),
  }
}

export function createForecastWindowPlanTestFixture(
  args: ForecastWindowPlanFixtureArgs
): ForecastWindowPlan {
  const [firstFrame, ...remainingFrames] = args.frames
  return {
    id: args.id,
    key: args.key,
    failurePolicy: args.failurePolicy,
    frames: [
      createForecastFramePlanTestFixture(firstFrame),
      ...remainingFrames.map(createForecastFramePlanTestFixture),
    ],
  }
}
