import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createActiveRunFixture, createManifestFixture } from '@/test/fixtures'
import type { ForecastDataRequest } from './request'
import type {
  ForecastDataFailurePolicy,
  ForecastDataLoad,
} from './loadDefinition'
import type {
  ForecastDataKind,
  ForecastDataSliceMap,
} from './types'
import type {
  FieldInterpolationWindowData,
} from './types'
import { loadForecastData } from './load'

const loaders = {
  field: vi.fn(),
  cloudLayers: vi.fn(),
  precipType: vi.fn(),
  pressure: vi.fn(),
  windVectors: vi.fn(),
}

function dataLoad<K extends ForecastDataKind>(
  id: K,
  loadTimeSlice: (hourToken: string) => Promise<ForecastDataSliceMap[K]>,
  failurePolicy: ForecastDataFailurePolicy = 'required',
): ForecastDataLoad<K> {
  const loadFixture = {
    id,
    key: `${id}:key`,
    failurePolicy,
    loadTimeSlice,
  }

  if (id === 'field') {
    return {
      ...loadFixture,
      probeField: {
        key: loadFixture.key,
        projectTimeSlice: fieldProbeTimeSlice,
      },
    } as ForecastDataLoad<K>
  }
  if (id === 'cloudLayers') {
    return {
      ...loadFixture,
      probeField: {
        key: loadFixture.key,
        projectTimeSlice: (slice: ForecastDataSliceMap['cloudLayers']) => slice.coverage,
      },
    } as ForecastDataLoad<K>
  }

  return loadFixture as ForecastDataLoad<K>
}

function fieldProbeTimeSlice(
  slice: ForecastDataSliceMap['field']
): FieldInterpolationWindowData['lower'] {
  return slice
}

function createRequest(loads: readonly ForecastDataLoad[]): ForecastDataRequest {
  return {
    activeRun: createActiveRunFixture(createManifestFixture()),
    selectedValidTimeMs: 123,
    lowerHourToken: '000',
    upperHourToken: '003',
    mix: 0.5,
    requestKey: 'request:key',
    loads,
  }
}

describe('loadForecastData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loaders.field.mockImplementation(async (hourToken: string) => ({
      layerId: 'relative_humidity',
      hourToken,
    }))
    loaders.cloudLayers.mockImplementation(async (hourToken: string) => ({
      layerId: 'cloud_layers',
      hourToken,
      coverage: { layerId: 'cloud_layers', hourToken },
    }))
    loaders.precipType.mockImplementation(async (hourToken: string) => ({
      artifactId: 'precip_type_surface',
      hourToken,
    }))
    loaders.pressure.mockImplementation(async (hourToken: string) => ({
      artifactId: 'prmsl_msl',
      hourToken,
    }))
    loaders.windVectors.mockImplementation(async (hourToken: string) => ({
      artifactId: 'wind10m_uv',
      hourToken,
    }))
  })

  it('loads planned data interpolation windows', async () => {
    const request = createRequest([
      dataLoad('field', loaders.field),
      dataLoad('precipType', loaders.precipType, 'optional'),
      dataLoad('windVectors', loaders.windVectors),
    ])

    await expect(loadForecastData({ request })).resolves.toEqual({
      windows: {
        field: {
          lower: { layerId: 'relative_humidity', hourToken: '000' },
          upper: { layerId: 'relative_humidity', hourToken: '003' },
          selectedValidTimeMs: 123,
          lowerHourToken: '000',
          upperHourToken: '003',
          mix: 0.5,
        },
        precipType: {
          lower: { artifactId: 'precip_type_surface', hourToken: '000' },
          upper: { artifactId: 'precip_type_surface', hourToken: '003' },
          selectedValidTimeMs: 123,
          lowerHourToken: '000',
          upperHourToken: '003',
          mix: 0.5,
        },
        windVectors: {
          lower: { artifactId: 'wind10m_uv', hourToken: '000' },
          upper: { artifactId: 'wind10m_uv', hourToken: '003' },
          selectedValidTimeMs: 123,
          lowerHourToken: '000',
          upperHourToken: '003',
          mix: 0.5,
        },
      },
      probeField: {
        lower: { layerId: 'relative_humidity', hourToken: '000' },
        upper: { layerId: 'relative_humidity', hourToken: '003' },
        selectedValidTimeMs: 123,
        lowerHourToken: '000',
        upperHourToken: '003',
        mix: 0.5,
      },
    })

    expect(loaders.field).toHaveBeenCalledTimes(2)
    expect(loaders.precipType).toHaveBeenCalledTimes(2)
    expect(loaders.pressure).not.toHaveBeenCalled()
    expect(loaders.windVectors).toHaveBeenCalledTimes(2)
  })

  it('loads only data loads included in the request', async () => {
    const request = createRequest([
      dataLoad('field', loaders.field),
    ])

    await expect(loadForecastData({ request })).resolves.toEqual({
      windows: {
        field: {
          lower: { layerId: 'relative_humidity', hourToken: '000' },
          upper: { layerId: 'relative_humidity', hourToken: '003' },
          selectedValidTimeMs: 123,
          lowerHourToken: '000',
          upperHourToken: '003',
          mix: 0.5,
        },
      },
      probeField: {
        lower: { layerId: 'relative_humidity', hourToken: '000' },
        upper: { layerId: 'relative_humidity', hourToken: '003' },
        selectedValidTimeMs: 123,
        lowerHourToken: '000',
        upperHourToken: '003',
        mix: 0.5,
      },
    })

    expect(loaders.field).toHaveBeenCalledTimes(2)
    expect(loaders.precipType).not.toHaveBeenCalled()
    expect(loaders.pressure).not.toHaveBeenCalled()
    expect(loaders.windVectors).not.toHaveBeenCalled()
  })

  it('publishes cloud-layer coverage as the probe field', async () => {
    const request = createRequest([
      dataLoad('cloudLayers', loaders.cloudLayers),
    ])

    await expect(loadForecastData({ request })).resolves.toEqual({
      windows: {
        cloudLayers: {
          lower: {
            layerId: 'cloud_layers',
            hourToken: '000',
            coverage: { layerId: 'cloud_layers', hourToken: '000' },
          },
          upper: {
            layerId: 'cloud_layers',
            hourToken: '003',
            coverage: { layerId: 'cloud_layers', hourToken: '003' },
          },
          selectedValidTimeMs: 123,
          lowerHourToken: '000',
          upperHourToken: '003',
          mix: 0.5,
        },
      },
      probeField: {
        lower: { layerId: 'cloud_layers', hourToken: '000' },
        upper: { layerId: 'cloud_layers', hourToken: '003' },
        selectedValidTimeMs: 123,
        lowerHourToken: '000',
        upperHourToken: '003',
        mix: 0.5,
      },
    })

    expect(loaders.field).not.toHaveBeenCalled()
    expect(loaders.cloudLayers).toHaveBeenCalledTimes(2)
  })

  it('loads optional pressure windows when planned', async () => {
    const request = createRequest([
      dataLoad('field', loaders.field),
      dataLoad('pressure', loaders.pressure, 'optional'),
    ])

    await expect(loadForecastData({ request })).resolves.toMatchObject({
      windows: {
        pressure: {
          lower: { artifactId: 'prmsl_msl', hourToken: '000' },
          upper: { artifactId: 'prmsl_msl', hourToken: '003' },
          selectedValidTimeMs: 123,
          lowerHourToken: '000',
          upperHourToken: '003',
          mix: 0.5,
        },
      },
    })

    expect(loaders.pressure).toHaveBeenCalledTimes(2)
  })

  it('omits optional data loads when they fail', async () => {
    const request = createRequest([
      dataLoad('field', loaders.field),
      dataLoad('precipType', loaders.precipType, 'optional'),
      dataLoad('pressure', loaders.pressure, 'optional'),
    ])
    loaders.precipType.mockRejectedValue(new Error('overlay missing'))
    loaders.pressure.mockRejectedValue(new Error('pressure missing'))

    await expect(loadForecastData({ request })).resolves.toMatchObject({
      windows: {
        field: {
          lower: { layerId: 'relative_humidity', hourToken: '000' },
          upper: { layerId: 'relative_humidity', hourToken: '003' },
        },
      },
      probeField: {
        lower: { layerId: 'relative_humidity', hourToken: '000' },
        upper: { layerId: 'relative_humidity', hourToken: '003' },
      },
    })

    expect(loaders.field).toHaveBeenCalledTimes(2)
    expect(loaders.precipType).toHaveBeenCalledTimes(2)
    expect(loaders.pressure).toHaveBeenCalledTimes(2)
  })
})
