import { describe, expect, it } from 'vitest'

import { createSingleTimeManifestFixture, createActiveRunFixture } from '../test/fixtures'
import type { ForecastProductRequest } from './request'
import { createForecastProductMemory } from './memory'
import type {
  FieldInterpolationWindowData,
  ForecastProductId,
  ForecastProductLoad,
  LoadedForecastProducts,
} from './types'

function product(id: ForecastProductId, key: string): ForecastProductLoad {
  return {
    id,
    key,
    failurePolicy: 'required',
    toProbeField: id === 'field'
      ? ((window: FieldInterpolationWindowData) => window)
      : undefined,
    load: async () => {
      throw new Error('test product loader should not run')
    },
  } as ForecastProductLoad
}

function createRequest(
  fieldKey = 'field:temperature',
  windVectorKey = 'wind-vectors:wind:wind10m_uv',
  extraProducts: ForecastProductLoad[] = []
): ForecastProductRequest {
  return {
    activeRun: createActiveRunFixture(createSingleTimeManifestFixture()),
    selectedValidTimeMs: 0,
    lowerHourToken: '000',
    upperHourToken: '000',
    mix: 0,
    requestKey: 'request:key',
    products: [
      product('field', fieldKey),
      product('windVectors', windVectorKey),
      ...extraProducts,
    ],
  }
}

describe('createForecastProductMemory', () => {
  it('reuses committed windows only for matching product keys', () => {
    const memory = createForecastProductMemory()
    const request = createRequest()
    const loadedProducts = {
      products: {
        field: { lower: { layerId: 'temperature' } },
        pressure: { lower: { artifactId: 'prmsl_msl' } },
        windVectors: { lower: { artifactId: 'wind10m_uv' } },
      },
      probeField: { lower: { layerId: 'temperature' } },
    } as LoadedForecastProducts

    expect(memory.reusableWindowsFor(request)).toEqual({})
    expect(memory.shouldClearProbeField(request)).toBe(false)

    memory.commit(request, loadedProducts)
    expect(memory.reusableWindowsFor(request)).toEqual({
      field: loadedProducts.products.field,
      windVectors: loadedProducts.products.windVectors,
    })

    const pressureRequest = createRequest(
      'field:temperature',
      'wind-vectors:wind:wind10m_uv',
      [product('pressure', 'pressure:prmsl_msl')]
    )
    memory.commit(pressureRequest, loadedProducts)
    expect(memory.reusableWindowsFor(pressureRequest)).toEqual({
      field: loadedProducts.products.field,
      pressure: loadedProducts.products.pressure,
      windVectors: loadedProducts.products.windVectors,
    })

    const nextLayerRequest = createRequest('field:relative_humidity', 'wind-vectors:wind:wind10m_uv')
    expect(memory.shouldClearProbeField(nextLayerRequest)).toBe(true)
    expect(memory.reusableWindowsFor(nextLayerRequest)).toEqual({
      windVectors: loadedProducts.products.windVectors,
    })
  })

  it('resets committed interpolation windows', () => {
    const memory = createForecastProductMemory()
    const request = createRequest()
    const loadedProducts = {
      products: {
        field: { lower: { layerId: 'temperature' } },
      },
      probeField: { lower: { layerId: 'temperature' } },
    } as LoadedForecastProducts

    memory.commit(request, loadedProducts)
    memory.reset()

    expect(memory.reusableWindowsFor(request)).toEqual({})
    expect(memory.shouldClearProbeField(request)).toBe(false)
  })
})
