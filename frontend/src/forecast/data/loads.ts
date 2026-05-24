import type { ArtifactLoader } from '@/forecast/artifacts'
import { createCloudLayersDataLoad } from './loaders/cloud-layers/load'
import { createFieldDataLoad } from './loaders/field/load'
import { createPrecipTypeDataLoad } from './loaders/precip-type/load'
import { createPressureDataLoad } from './loaders/pressure/load'
import { createWindVectorDataLoad } from './loaders/wind-vectors/load'
import type { ForecastDataLoad } from './loadDefinition'
import type { ForecastDataTarget } from './target'
import type { ForecastDataOptions } from './types'

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
      if (target.layerSource.kind !== 'field') return null
      return createFieldDataLoad({
        artifacts,
        activeRun: target.activeRun,
        source: target.layerSource,
      })
    },
  },
  {
    create({ target, artifacts }) {
      if (target.layerSource.kind !== 'cloudLayers') return null
      return createCloudLayersDataLoad({
        artifacts,
        activeRun: target.activeRun,
        source: target.layerSource,
      })
    },
  },
  {
    create({ target, artifacts }) {
      return createPrecipTypeDataLoad({
        artifacts,
        activeRun: target.activeRun,
        source: target.layerSource.precipType,
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
      if (!options.windVectors || target.windVectorSource == null) return null
      return createWindVectorDataLoad({
        artifacts,
        activeRun: target.activeRun,
        source: target.windVectorSource,
      })
    },
  },
] as const

export function createForecastDataLoads(args: CreateForecastDataLoadArgs): ForecastDataLoad[] {
  return dataDefinitions
    .map((definition) => definition.create(args))
    .filter((load): load is ForecastDataLoad => load != null)
}
