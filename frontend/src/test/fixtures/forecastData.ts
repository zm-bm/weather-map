import type {
  FieldInterpolationWindowData,
  FieldTimeSliceData,
  CloudLayersInterpolationWindowData,
  CloudLayersTimeSliceData,
  PrecipTypeInterpolationWindowData,
  PrecipTypeTimeSliceData,
  PressureInterpolationWindowData,
  PressureTimeSliceData,
  ForecastDataSession,
  ForecastDataTarget,
  LoadedForecastData,
  WindVectorInterpolationWindowData,
} from '@/forecast/data'
import type { ActiveForecastRun } from '@/forecast/manifest'
import { normalizeForecastHourToken } from '@/forecast/manifest'
import {
  interpolationWindowMinuteOffset,
  resolveForecastInterpolationWindow,
  type ForecastInterpolationWindow,
} from '@/forecast/time'
import { vi } from 'vitest'
import {
  createActiveRunFixture,
  createGridFixture,
  createManifestFixture,
  createScalarEncodingFixture,
  createVectorEncodingFixture,
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

export function createFieldTimeSliceFixture(args: {
  hourToken?: string
  layerId?: string
  paletteId?: string
  values?: number[] | Float32Array
  displayRange?: [number, number]
  frame?: number
} = {}): FieldTimeSliceData {
  return {
    hourToken: args.hourToken ?? '000',
    layerId: args.layerId ?? 'temperature',
    paletteId: args.paletteId ?? 'temperature.air.c.v1',
    grid: createGridFixture({ nx: 2, ny: 2 }),
    encoding: createScalarEncodingFixture(),
    values: args.values instanceof Float32Array
      ? args.values
      : new Float32Array(args.values ?? [1, 2, 3, 4]),
    displayRange: args.displayRange ?? [-35, 50],
    ...(args.frame === undefined ? {} : { frame: args.frame }),
  } as FieldTimeSliceData
}

export function createFieldWindowFixture(args: {
  lower?: FieldTimeSliceData
  upper?: FieldTimeSliceData
  layerId?: string
  mix?: number
  selectedValidTimeMs?: number
  lowerHourToken?: string
  upperHourToken?: string
  frame?: number
} = {}): FieldInterpolationWindowData {
  const lower = args.lower ?? createFieldTimeSliceFixture({
    hourToken: args.lowerHourToken,
    layerId: args.layerId,
    frame: args.frame,
  })
  const upper = args.upper ?? createFieldTimeSliceFixture({
    hourToken: args.upperHourToken,
    layerId: args.layerId,
    frame: args.frame,
  })

  return {
    lower,
    upper,
    selectedValidTimeMs: args.selectedValidTimeMs ?? Date.UTC(2026, 3, 13, 12),
    lowerHourToken: lower.hourToken,
    upperHourToken: upper.hourToken,
    mix: args.mix ?? 0,
  }
}

export function createWindVectorWindowFixture(args: {
  artifactId?: string
  mix?: number
} = {}): WindVectorInterpolationWindowData {
  const slice = {
    hourToken: '000',
    artifactId: args.artifactId ?? 'wind10m_uv',
    grid: createGridFixture({ nx: 2, ny: 2 }),
    scale: 0.5,
    offset: 0,
    u: new Int8Array([1, 2, 3, 4]),
    v: new Int8Array([-1, -2, -3, -4]),
  }

  return {
    lower: slice,
    upper: slice,
    selectedValidTimeMs: Date.UTC(2026, 3, 13, 12),
    lowerHourToken: '000',
    upperHourToken: '000',
    mix: args.mix ?? 0,
  } as WindVectorInterpolationWindowData
}

export function createCloudLayersTimeSliceFixture(args: {
  hourToken?: string
  layerId?: string
  artifactId?: string
} = {}): CloudLayersTimeSliceData {
  const coverage = createFieldTimeSliceFixture({
    hourToken: args.hourToken,
    layerId: args.layerId ?? 'cloud_layers',
    paletteId: 'cloud.layers.coverage.v1',
    values: [0, 25, 50, 100],
    displayRange: [0, 100],
  })

  return {
    hourToken: args.hourToken ?? '000',
    layerId: args.layerId ?? 'cloud_layers',
    artifactId: args.artifactId ?? 'cloud_layers',
    grid: coverage.grid,
    encoding: createVectorEncodingFixture(),
    low: new Int8Array([0, 25, 50, 100]),
    middle: new Int8Array([0, 20, 40, 80]),
    high: new Int8Array([0, 10, 30, 60]),
    coverage,
  }
}

export function createCloudLayersWindowFixture(args: {
  lower?: CloudLayersTimeSliceData
  upper?: CloudLayersTimeSliceData
  layerId?: string
  mix?: number
} = {}): CloudLayersInterpolationWindowData {
  const lower = args.lower ?? createCloudLayersTimeSliceFixture({ layerId: args.layerId })
  const upper = args.upper ?? createCloudLayersTimeSliceFixture({ layerId: args.layerId })

  return {
    lower,
    upper,
    selectedValidTimeMs: Date.UTC(2026, 3, 13, 12),
    lowerHourToken: lower.hourToken,
    upperHourToken: upper.hourToken,
    mix: args.mix ?? 0,
  }
}

export function createPrecipTypeTimeSliceFixture(args: {
  hourToken?: string
  artifactId?: string
} = {}): PrecipTypeTimeSliceData {
  return {
    hourToken: args.hourToken ?? '000',
    artifactId: args.artifactId ?? 'precip_type_surface',
    grid: createGridFixture({ nx: 2, ny: 2 }),
    snowFrac: new Float32Array([0, 0.25, 0.5, 1]),
    mixFrac: new Float32Array([0, 0.1, 0.2, 0.4]),
  }
}

export function createPrecipTypeWindowFixture(args: {
  lower?: PrecipTypeTimeSliceData
  upper?: PrecipTypeTimeSliceData
  mix?: number
} = {}): PrecipTypeInterpolationWindowData {
  const lower = args.lower ?? createPrecipTypeTimeSliceFixture()
  const upper = args.upper ?? createPrecipTypeTimeSliceFixture()

  return {
    lower,
    upper,
    selectedValidTimeMs: Date.UTC(2026, 3, 13, 12),
    lowerHourToken: lower.hourToken,
    upperHourToken: upper.hourToken,
    mix: args.mix ?? 0,
  }
}

export function createPressureTimeSliceFixture(args: {
  hourToken?: string
  artifactId?: string
} = {}): PressureTimeSliceData {
  return {
    hourToken: args.hourToken ?? '000',
    artifactId: args.artifactId ?? 'prmsl_msl',
    grid: createGridFixture({ nx: 2, ny: 2 }),
    pressureHpa: new Float32Array([1000, 1001, 1002, 1003]),
  }
}

export function createPressureWindowFixture(args: {
  lower?: PressureTimeSliceData
  upper?: PressureTimeSliceData
  mix?: number
} = {}): PressureInterpolationWindowData {
  const lower = args.lower ?? createPressureTimeSliceFixture()
  const upper = args.upper ?? createPressureTimeSliceFixture()

  return {
    lower,
    upper,
    selectedValidTimeMs: Date.UTC(2026, 3, 13, 12),
    lowerHourToken: lower.hourToken,
    upperHourToken: upper.hourToken,
    mix: args.mix ?? 0,
  }
}

export function createLoadedForecastDataFixture(args: {
  field?: LoadedForecastData['windows']['field']
  cloudLayers?: LoadedForecastData['windows']['cloudLayers'] | null
  precipType?: LoadedForecastData['windows']['precipType'] | null
  pressure?: LoadedForecastData['windows']['pressure'] | null
  windVectors?: LoadedForecastData['windows']['windVectors'] | null
  probeField?: FieldInterpolationWindowData | null
} = {}): LoadedForecastData {
  const field = args.field ?? createFieldWindowFixture()
  const windows: LoadedForecastData['windows'] = {}

  if (field != null) windows.field = field
  if (args.cloudLayers != null) windows.cloudLayers = args.cloudLayers
  if (args.precipType != null) windows.precipType = args.precipType
  if (args.pressure != null) windows.pressure = args.pressure
  if (args.windVectors === undefined) {
    windows.windVectors = createWindVectorWindowFixture()
  } else if (args.windVectors != null) {
    windows.windVectors = args.windVectors
  }

  return {
    windows,
    probeField: args.probeField === undefined ? field : args.probeField,
  }
}

export function createDataLoadJobFixture(args: {
  key?: string
  selectedValidTimeMs?: number
  shouldClearProbeFrame?: boolean
  load?: () => Promise<LoadedForecastData>
  commit?: (data: LoadedForecastData) => void
} = {}) {
  return {
    key: args.key ?? 'job:default',
    selectedValidTimeMs: args.selectedValidTimeMs ?? Date.UTC(2026, 3, 13, 12),
    shouldClearProbeFrame: args.shouldClearProbeFrame ?? false,
    load: args.load ?? vi.fn(),
    commit: args.commit ?? vi.fn(),
  }
}

export function createDataSessionFixture(
  overrides: Partial<ForecastDataSession> = {}
): ForecastDataSession {
  return {
    createLoadJob: vi.fn(),
    prefetch: vi.fn(),
    reset: vi.fn(),
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
