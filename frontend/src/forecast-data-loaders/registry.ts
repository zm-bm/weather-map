import type { ArtifactLoader } from '../forecast-artifacts'
import { createCloudLayersDataLoad } from './cloud-layers/load'
import { createFieldDataLoad } from './field/load'
import { createPrecipTypeDataLoad } from './precip-type/load'
import { createPressureDataLoad } from './pressure/load'
import type { ForecastDataTarget } from '../forecast-data-targets'
import {
  type ForecastDataLoad,
} from './types'
import { createWindVectorDataLoad } from './wind-vectors/load'

export type ForecastDataOptions = {
  pressure: boolean
  windVectors: boolean
}

export const DEFAULT_FORECAST_DATA_OPTIONS: ForecastDataOptions = {
  pressure: true,
  windVectors: true,
}

type DataDefinition = {
  create: (args: CreateForecastDataLoadArgs) => ForecastDataLoad | null
}

type CreateForecastDataLoadArgs = {
  target: ForecastDataTarget
  artifacts: ArtifactLoader
  options: ForecastDataOptions
}

const dataDefinitions: readonly DataDefinition[] = [
  {
    create({ target, artifacts }) {
      if (target.layerDataSource.kind !== 'field') return null
      return createFieldDataLoad({
        artifacts,
        activeRun: target.activeRun,
        source: target.layerDataSource,
      })
    },
  },
  {
    create({ target, artifacts }) {
      if (target.layerDataSource.kind !== 'cloudLayers') return null
      return createCloudLayersDataLoad({
        artifacts,
        activeRun: target.activeRun,
        source: target.layerDataSource,
      })
    },
  },
  {
    create({ target, artifacts }) {
      return createPrecipTypeDataLoad({
        artifacts,
        activeRun: target.activeRun,
        source: target.layerDataSource.precipType,
      })
    },
  },
  {
    create({ target, artifacts, options }) {
      if (!options.pressure) return null
      return createPressureDataLoad({
        artifacts,
        activeRun: target.activeRun,
      })
    },
  },
  {
    create({ target, artifacts, options }) {
      if (!options.windVectors || target.windVectorDataSource == null) return null
      return createWindVectorDataLoad({
        artifacts,
        activeRun: target.activeRun,
        source: target.windVectorDataSource,
      })
    },
  },
] as const

export function createForecastDataLoads(args: CreateForecastDataLoadArgs): ForecastDataLoad[] {
  return dataDefinitions
    .map((definition) => definition.create(args))
    .filter((load): load is ForecastDataLoad => load != null)
}
