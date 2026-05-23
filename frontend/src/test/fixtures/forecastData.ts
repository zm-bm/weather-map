import type { ForecastDataTarget } from '../../forecast-data'
import type { ActiveForecastRun } from '../../forecast-manifest'
import { normalizeForecastHourToken } from '../../forecast-manifest'
import {
  interpolationWindowMinuteOffset,
  resolveForecastInterpolationWindow,
  type ForecastInterpolationWindow,
} from '../../forecast-time'
import {
  createActiveRunFixture,
  createManifestFixture,
} from './manifest'

type LayerSource = ForecastDataTarget['layerSource']
type FieldLayerSource = Extract<LayerSource, { kind: 'field' }>
type CloudLayerSource = Extract<LayerSource, { kind: 'cloudLayers' }>
type FieldSource = FieldLayerSource['fieldSource']
type PrecipTypeSource = NonNullable<LayerSource['precipType']>
type WindVectorSource = NonNullable<ForecastDataTarget['windVectorSource']>

export function createForecastDataTargetFixture(args: {
  activeRun?: ActiveForecastRun
  layerSource?: LayerSource
  windVectorSource?: WindVectorSource | null
  interpolationWindow?: ForecastInterpolationWindow
  targetTimeMs?: number
  overrides?: Partial<ForecastDataTarget>
} = {}): ForecastDataTarget {
  const activeRun = args.activeRun ?? createActiveRunFixture(createManifestFixture())
  const firstTime = activeRun.latest.times[0]
  if (firstTime == null) throw new Error('Forecast data target fixture requires at least one time')

  const selectedValidTimeMs = args.targetTimeMs ?? Date.parse(firstTime.validAt)
  const interpolationWindow = args.interpolationWindow ??
    resolveForecastInterpolationWindow(activeRun.latest.times, selectedValidTimeMs)

  return {
    activeRun,
    layerSource: args.layerSource ?? createFieldLayerSourceFixture(),
    windVectorSource: args.windVectorSource === undefined
      ? createWindVectorSourceFixture()
      : args.windVectorSource,
    selectedValidTimeMs: interpolationWindow.selectedValidTimeMs,
    lowerHourToken: normalizeForecastHourToken(interpolationWindow.lowerHourToken),
    upperHourToken: normalizeForecastHourToken(interpolationWindow.upperHourToken),
    mix: interpolationWindow.mix,
    minuteOffset: interpolationWindowMinuteOffset(interpolationWindow),
    ...args.overrides,
  }
}

export function createPrecipTypeSourceFixture(
  overrides: Partial<PrecipTypeSource> = {}
): PrecipTypeSource {
  return {
    id: 'precipitation_type',
    artifactId: 'precip_type_surface',
    optional: true,
    ...overrides,
  }
}

export function createFieldLayerSourceFixture(args: {
  layerId?: string
  paletteId?: string
  displayRange?: [number, number]
  fieldSource?: FieldSource
  precipType?: PrecipTypeSource | null
} = {}): FieldLayerSource {
  return {
    kind: 'field',
    layerId: args.layerId ?? 'temperature',
    paletteId: args.paletteId ?? 'temperature.air.c.v1',
    displayRange: args.displayRange ?? [-35, 50],
    precipType: args.precipType ?? null,
    fieldSource: args.fieldSource ?? {
      kind: 'scalar',
      artifactId: 'tmp_surface',
    },
  }
}

export function createCloudLayerSourceFixture(args: {
  layerId?: string
  paletteId?: string
  displayRange?: [number, number]
  artifactId?: string
  precipType?: PrecipTypeSource | null
} = {}): CloudLayerSource {
  return {
    kind: 'cloudLayers',
    layerId: args.layerId ?? 'cloud_layers',
    paletteId: args.paletteId ?? 'cloud.layers.coverage.v1',
    displayRange: args.displayRange ?? [0, 100],
    precipType: args.precipType ?? null,
    artifactId: args.artifactId ?? 'cloud_layers',
  }
}

export function createWindVectorSourceFixture(
  overrides: Partial<WindVectorSource> = {}
): WindVectorSource {
  return {
    id: 'wind',
    artifactId: 'wind10m_uv',
    ...overrides,
  }
}
