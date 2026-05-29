import type { ReadonlyNonEmptyArray } from '@/core/types'
import type { RasterBandOrder } from '@/forecast/artifacts'
import type { ForecastWindowId } from '@/forecast/frames'
import type {
  ForecastWindowFailurePolicy,
  ForecastWindowPlan,
  RasterFramePlan,
} from '../plan'

type RasterFramePlanFixtureArgs = {
  source: unknown
  artifactId: string
  bandIds: ReadonlyNonEmptyArray<string>
  cacheKeyPrefix: string
  order?: RasterBandOrder
  failurePolicy?: ForecastWindowFailurePolicy
}

type ForecastWindowPlanFixtureArgs =
  | {
    id: ForecastWindowId
    key: string
    failurePolicy: ForecastWindowFailurePolicy
    output: 'single'
    frame: RasterFramePlanFixtureArgs
  }
  | {
    id: 'overlay'
    key: string
    failurePolicy: ForecastWindowFailurePolicy
    output: 'array'
    frames: ReadonlyNonEmptyArray<RasterFramePlanFixtureArgs>
  }

export function createRasterFramePlanTestFixture(
  args: RasterFramePlanFixtureArgs
): RasterFramePlan {
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
  if (args.output === 'array') {
    const [firstFrame, ...remainingFrames] = args.frames
    return {
      id: args.id,
      key: args.key,
      failurePolicy: args.failurePolicy,
      output: args.output,
      frames: [
        createRasterFramePlanTestFixture(firstFrame),
        ...remainingFrames.map(createRasterFramePlanTestFixture),
      ],
    }
  }

  return {
    id: args.id,
    key: args.key,
    failurePolicy: args.failurePolicy,
    output: args.output,
    frames: [createRasterFramePlanTestFixture(args.frame)],
  }
}
