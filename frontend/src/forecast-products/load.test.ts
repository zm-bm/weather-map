import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createActiveRunFixture, createManifestFixture } from '../test/fixtures'
import type { ForecastProductRequest } from './request'
import type {
  CloudLayersInterpolationWindowData,
  FieldInterpolationWindowData,
  ForecastProductFailurePolicy,
  ForecastProductId,
  ForecastProductLoad,
  ForecastProductTimeSlices,
} from './types'
import { loadForecastProducts } from './load'

const loaders = {
  field: vi.fn(),
  cloudLayers: vi.fn(),
  precipType: vi.fn(),
  pressure: vi.fn(),
  windVectors: vi.fn(),
}

function product<K extends ForecastProductId>(
  id: K,
  load: (hourToken: string) => Promise<ForecastProductTimeSlices[K]>,
  failurePolicy: ForecastProductFailurePolicy = 'required',
): ForecastProductLoad<K> {
  const loadProduct = {
    id,
    key: `${id}:key`,
    failurePolicy,
    load,
  }

  if (id === 'field') {
    return {
      ...loadProduct,
      toProbeField: fieldProbeWindow,
    } as ForecastProductLoad<K>
  }
  if (id === 'cloudLayers') {
    return {
      ...loadProduct,
      toProbeField: cloudLayersProbeWindow,
    } as ForecastProductLoad<K>
  }

  return loadProduct as ForecastProductLoad<K>
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

function createRequest(products: readonly ForecastProductLoad[]): ForecastProductRequest {
  return {
    activeRun: createActiveRunFixture(createManifestFixture()),
    selectedValidTimeMs: 123,
    lowerHourToken: '000',
    upperHourToken: '003',
    mix: 0.5,
    requestKey: 'request:key',
    products,
  }
}

describe('loadForecastProducts', () => {
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

  it('loads planned product interpolation windows', async () => {
    const request = createRequest([
      product('field', loaders.field),
      product('precipType', loaders.precipType, 'optional'),
      product('windVectors', loaders.windVectors),
    ])

    await expect(loadForecastProducts({ request })).resolves.toEqual({
      products: {
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

  it('loads only products included in the request', async () => {
    const request = createRequest([
      product('field', loaders.field),
    ])

    await expect(loadForecastProducts({ request })).resolves.toEqual({
      products: {
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
      product('cloudLayers', loaders.cloudLayers),
    ])

    await expect(loadForecastProducts({ request })).resolves.toEqual({
      products: {
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
      product('field', loaders.field),
      product('pressure', loaders.pressure, 'optional'),
    ])

    await expect(loadForecastProducts({ request })).resolves.toMatchObject({
      products: {
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

  it('omits optional products when they fail', async () => {
    const request = createRequest([
      product('field', loaders.field),
      product('precipType', loaders.precipType, 'optional'),
      product('pressure', loaders.pressure, 'optional'),
    ])
    loaders.precipType.mockRejectedValue(new Error('overlay missing'))
    loaders.pressure.mockRejectedValue(new Error('pressure missing'))

    await expect(loadForecastProducts({ request })).resolves.toMatchObject({
      products: {
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
