import type { ArtifactLoader } from '../forecast-artifacts'
import type { ActiveForecastRun } from '../forecast-manifest'
import { createForecastProductRequestKey } from './keys'
import {
  createForecastProductLoads,
  DEFAULT_FORECAST_PRODUCT_OPTIONS,
  type ForecastProductOptions,
} from './products/registry'
import type { ForecastProductTarget } from './target'
import type { ForecastProductLoad } from './types'

export type ForecastProductRequest = {
  activeRun: ActiveForecastRun
  selectedValidTimeMs: number
  lowerHourToken: string
  upperHourToken: string
  mix: number
  requestKey: string
  products: readonly ForecastProductLoad[]
}

type CreateForecastProductRequestArgs = {
  target: ForecastProductTarget
  artifacts: ArtifactLoader
  retryToken: number
  options?: Partial<ForecastProductOptions>
}

export function createForecastProductRequest(args: CreateForecastProductRequestArgs): ForecastProductRequest {
  const products = createForecastProductLoads({
    target: args.target,
    artifacts: args.artifacts,
    options: {
      ...DEFAULT_FORECAST_PRODUCT_OPTIONS,
      ...args.options,
    },
  })

  return {
    activeRun: args.target.activeRun,
    selectedValidTimeMs: args.target.selectedValidTimeMs,
    lowerHourToken: args.target.lowerHourToken,
    upperHourToken: args.target.upperHourToken,
    mix: args.target.mix,
    requestKey: createForecastProductRequestKey({
      activeRun: args.target.activeRun,
      productKeys: products.map((product) => product.key),
      lowerHourToken: args.target.lowerHourToken,
      upperHourToken: args.target.upperHourToken,
      minuteOffset: args.target.minuteOffset,
      retryToken: args.retryToken,
    }),
    products,
  }
}
