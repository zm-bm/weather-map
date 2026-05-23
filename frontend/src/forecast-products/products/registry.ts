import type { ArtifactLoader } from '../../forecast-artifacts'
import { createCloudLayersChannel } from '../cloud-layers/channel'
import { createFieldChannel } from '../field/channel'
import { canLoadFieldSource } from '../field/source'
import { createPrecipTypeChannel } from '../precip-type/channel'
import { createPressureChannel } from '../pressure/channel'
import type { ForecastProductTarget } from '../target'
import {
  type CloudLayersInterpolationWindowData,
  type FieldInterpolationWindowData,
  type ForecastProductId,
  type ForecastProductLoad,
  type ForecastProductTimeSlices,
} from '../types'
import { createWindVectorChannel } from '../wind-vectors/channel'

export type ForecastProductOptions = {
  pressure: boolean
  windVectors: boolean
}

export const DEFAULT_FORECAST_PRODUCT_OPTIONS: ForecastProductOptions = {
  pressure: true,
  windVectors: true,
}

type ProductDefinition = {
  create: (args: CreateForecastProductLoadArgs) => ForecastProductLoad | null
}

type CreateForecastProductLoadArgs = {
  target: ForecastProductTarget
  artifacts: ArtifactLoader
  options: ForecastProductOptions
}

const productDefinitions: readonly ProductDefinition[] = [
  {
    create({ target, artifacts }) {
      if (target.selectedLayer.source.kind === 'cloud-layers') return null
      if (!canLoadFieldSource({
        artifacts,
        source: target.selectedLayer.source,
      })) {
        return null
      }
      const channel = createFieldChannel({
        artifacts,
        activeRun: target.activeRun,
        layer: target.selectedLayer,
      })
      return channel == null
        ? null
        : requiredProduct('field', channel, { toProbeField: fieldProbeWindow })
    },
  },
  {
    create({ target, artifacts }) {
      if (target.selectedLayer.source.kind !== 'cloud-layers') return null
      if (!artifacts.canLoadVectorComponents(target.selectedLayer.source.artifactId, ['low', 'middle', 'high'])) {
        return null
      }
      const channel = createCloudLayersChannel({
        artifacts,
        activeRun: target.activeRun,
        layer: target.selectedLayer,
      })
      return channel == null
        ? null
        : requiredProduct('cloudLayers', channel, { toProbeField: cloudLayersProbeWindow })
    },
  },
  {
    create({ target, artifacts }) {
      const channel = createPrecipTypeChannel({
        artifacts,
        activeRun: target.activeRun,
        layer: target.selectedLayer,
      })
      return channel == null ? null : optionalProduct('precipType', channel)
    },
  },
  {
    create({ target, artifacts, options }) {
      if (!options.pressure) return null
      const channel = createPressureChannel({
        artifacts,
        activeRun: target.activeRun,
      })
      return channel == null ? null : optionalProduct('pressure', channel)
    },
  },
  {
    create({ target, artifacts, options }) {
      if (!options.windVectors || target.windVectorSource == null) return null
      if (!artifacts.canLoadVector(target.windVectorSource.artifactId)) return null
      const channel = createWindVectorChannel({
        artifacts,
        activeRun: target.activeRun,
        source: target.windVectorSource,
      })
      return channel == null ? null : requiredProduct('windVectors', channel)
    },
  },
] as const

export function createForecastProductLoads(args: CreateForecastProductLoadArgs): ForecastProductLoad[] {
  return productDefinitions
    .map((definition) => definition.create(args))
    .filter((product): product is ForecastProductLoad => product != null)
}

function requiredProduct<K extends ForecastProductId>(
  id: K,
  channel: {
    key: string
    load: (hourToken: string) => Promise<ForecastProductTimeSlices[K]>
  },
  options: Pick<ForecastProductLoad<K>, 'toProbeField'> = {}
): ForecastProductLoad<K> {
  return {
    id,
    key: channel.key,
    failurePolicy: 'required',
    load: channel.load,
    ...options,
  }
}

function optionalProduct<K extends ForecastProductId>(
  id: K,
  channel: {
    key: string
    load: (hourToken: string) => Promise<ForecastProductTimeSlices[K]>
  }
): ForecastProductLoad<K> {
  return {
    id,
    key: channel.key,
    failurePolicy: 'optional',
    load: channel.load,
  }
}

function fieldProbeWindow(window: FieldInterpolationWindowData): FieldInterpolationWindowData {
  return window
}

function cloudLayersProbeWindow(
  window: CloudLayersInterpolationWindowData
): FieldInterpolationWindowData {
  return {
    selectedValidTimeMs: window.selectedValidTimeMs,
    lowerHourToken: window.lowerHourToken,
    upperHourToken: window.upperHourToken,
    mix: window.mix,
    lower: window.lower.coverage,
    upper: window.upper.coverage,
  }
}
