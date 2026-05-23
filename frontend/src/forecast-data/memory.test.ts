import { describe, expect, it } from 'vitest'

import { createSingleTimeManifestFixture, createActiveRunFixture } from '../test/fixtures'
import type { ForecastDataRequest } from './request'
import { createForecastDataMemory } from './memory'
import type {
  ForecastDataKind,
  ForecastDataLoad,
} from '../forecast-data-loaders'
import type {
  FieldInterpolationWindowData,
  LoadedForecastData,
} from './types'

function dataLoad(id: ForecastDataKind, key: string): ForecastDataLoad {
  return {
    id,
    key,
    failurePolicy: 'required',
    toProbeField: id === 'field'
      ? ((window: FieldInterpolationWindowData) => window)
      : undefined,
    loadTimeSlice: async () => {
      throw new Error('test data loader should not run')
    },
  } as ForecastDataLoad
}

function createRequest(
  fieldKey = 'field:temperature',
  windVectorKey = 'wind-vectors:wind:wind10m_uv',
  extraLoads: ForecastDataLoad[] = []
): ForecastDataRequest {
  return {
    activeRun: createActiveRunFixture(createSingleTimeManifestFixture()),
    selectedValidTimeMs: 0,
    lowerHourToken: '000',
    upperHourToken: '000',
    mix: 0,
    requestKey: 'request:key',
    loads: [
      dataLoad('field', fieldKey),
      dataLoad('windVectors', windVectorKey),
      ...extraLoads,
    ],
  }
}

describe('createForecastDataMemory', () => {
  it('reuses committed windows only for matching data keys', () => {
    const memory = createForecastDataMemory()
    const request = createRequest()
    const loadedData = {
      windows: {
        field: { lower: { layerId: 'temperature' } },
        pressure: { lower: { artifactId: 'prmsl_msl' } },
        windVectors: { lower: { artifactId: 'wind10m_uv' } },
      },
      probeField: { lower: { layerId: 'temperature' } },
    } as LoadedForecastData

    expect(memory.reusableWindowsFor(request)).toEqual({})
    expect(memory.shouldClearProbeField(request)).toBe(false)

    memory.commit(request, loadedData)
    expect(memory.reusableWindowsFor(request)).toEqual({
      field: loadedData.windows.field,
      windVectors: loadedData.windows.windVectors,
    })

    const pressureRequest = createRequest(
      'field:temperature',
      'wind-vectors:wind:wind10m_uv',
      [dataLoad('pressure', 'pressure:prmsl_msl')]
    )
    memory.commit(pressureRequest, loadedData)
    expect(memory.reusableWindowsFor(pressureRequest)).toEqual({
      field: loadedData.windows.field,
      pressure: loadedData.windows.pressure,
      windVectors: loadedData.windows.windVectors,
    })

    const nextLayerRequest = createRequest('field:relative_humidity', 'wind-vectors:wind:wind10m_uv')
    expect(memory.shouldClearProbeField(nextLayerRequest)).toBe(true)
    expect(memory.reusableWindowsFor(nextLayerRequest)).toEqual({
      windVectors: loadedData.windows.windVectors,
    })
  })

  it('resets committed interpolation windows', () => {
    const memory = createForecastDataMemory()
    const request = createRequest()
    const loadedData = {
      windows: {
        field: { lower: { layerId: 'temperature' } },
      },
      probeField: { lower: { layerId: 'temperature' } },
    } as LoadedForecastData

    memory.commit(request, loadedData)
    memory.reset()

    expect(memory.reusableWindowsFor(request)).toEqual({})
    expect(memory.shouldClearProbeField(request)).toBe(false)
  })
})
