import type { ReadonlyNonEmptyArray } from '@/core/types'
import type { RasterBandOrder } from '@/forecast/artifacts'
import type { ForecastWindowId } from '@/forecast/frames'
import type {
  ForecastFramePlan,
  ForecastWindowFailurePolicy,
  ForecastWindowPlan,
} from '../plan'

type ForecastFramePlanFixtureArgs = {
  sourceKind: ForecastWindowId
  source: ForecastFramePlan['source']
  artifactId: string
  bandIds: ReadonlyNonEmptyArray<string>
  cacheKeyPrefix: string
  order?: RasterBandOrder
  failurePolicy?: ForecastWindowFailurePolicy
}

type SingleForecastWindowId = Exclude<ForecastWindowId, 'overlay'>

type SingleForecastWindowPlanFixtureArgs = {
  id: SingleForecastWindowId
  key: string
  failurePolicy: ForecastWindowFailurePolicy
  output: 'single'
  frame: ForecastFramePlanFixtureArgs
}

type ForecastWindowPlanFixtureArgs =
  | SingleForecastWindowPlanFixtureArgs
  | {
    id: 'overlay'
    key: string
    failurePolicy: ForecastWindowFailurePolicy
    output: 'array'
    frames: ReadonlyNonEmptyArray<ForecastFramePlanFixtureArgs>
  }

export function createForecastFramePlanTestFixture(
  args: ForecastFramePlanFixtureArgs
): ForecastFramePlan {
  return {
    sourceKind: args.sourceKind,
    source: args.source,
    artifactId: args.artifactId,
    bandIds: args.bandIds,
    cacheKeyPrefix: args.cacheKeyPrefix,
    ...(args.order === undefined ? {} : { order: args.order }),
    ...(args.failurePolicy === undefined ? {} : { failurePolicy: args.failurePolicy }),
  } as ForecastFramePlan
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
        createForecastFramePlanTestFixture(firstFrame),
        ...remainingFrames.map(createForecastFramePlanTestFixture),
      ] as ReadonlyNonEmptyArray<ForecastFramePlan<'overlay'>>,
    }
  }

  return {
    id: args.id,
    key: args.key,
    failurePolicy: args.failurePolicy,
    output: args.output,
    frames: [createForecastFramePlanTestFixture(args.frame)],
  } as ForecastWindowPlan
}
