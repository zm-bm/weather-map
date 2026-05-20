import { describe, expect, it } from 'vitest'

import {
  blendLayerValues,
  createLayerProbeSampler,
  probeFieldTimeSlice,
  probeFieldInterpolationWindow,
  sampleFieldInterpolationWindowWithSampler,
  sampleFieldTimeSliceWithSampler,
} from './layer'
import type { FieldTimeSliceData } from '../forecast-data'

function createFrame(values: number[]): FieldTimeSliceData {
  return {
    hourToken: '000',
    layerId: 'temperature',
    paletteId: 'temperature.air.c.v1',
    grid: {
      id: 'g0',
      crs: 'EPSG:4326',
      nx: 2,
      ny: 2,
      lon0: 0,
      lat0: 1,
      dx: 1,
      dy: -1,
      origin: 'cell_center',
      layout: 'row_major',
      xWrap: 'repeat',
      yMode: 'clamp',
    },
    encoding: {
      id: 'e0',
      format: 'linear-i16-v1',
      dtype: 'int16',
      byteOrder: 'little',
      nodata: -32768,
      scale: 1,
      offset: 0,
      decodeFormula: 'value = stored * scale + offset',
    },
    values: Float32Array.from(values),
    displayRange: [0, 100],
    colortable: [[0, 0, 0, 0]],
  }
}

describe('probeFieldTimeSlice', () => {
  it('bilinearly interpolates nearby layer values', () => {
    const probe = probeFieldTimeSlice(createFrame([10, 20, 30, 40]), {
      lon: 0.5,
      lat: 0.5,
    })

    expect(probe?.value).toBe(25)
    expect(probe?.points.map((point) => point.weight)).toEqual([0.25, 0.25, 0.25, 0.25])
  })

  it('skips nodata neighbors when interpolating', () => {
    const probe = probeFieldTimeSlice(createFrame([10, Number.NaN, 30, 50]), {
      lon: 0.5,
      lat: 0.5,
    })

    expect(probe?.value).toBe(30)
    expect(probe?.points.map((point) => point.value)).toEqual([10, null, 30, 50])
  })

  it('wraps longitudes across repeating grids', () => {
    const probe = probeFieldTimeSlice(createFrame([10, 20, 30, 40]), {
      lon: 2.25,
      lat: 0.5,
    })

    expect(probe?.gridX).toBe(0.25)
    expect(probe?.value).toBe(22.5)
  })

  it('blends probe values across a layer interpolation window', () => {
    const interpolationWindow = {
      lower: createFrame([10, 20, 30, 40]),
      upper: {
        ...createFrame([20, 30, 40, 50]),
        hourToken: '001',
      },
      selectedValidTimeMs: 1,
      lowerHourToken: '000',
      upperHourToken: '001',
      mix: 0.5,
    }
    const coords = {
      lon: 0.5,
      lat: 0.5,
    }
    const probe = probeFieldInterpolationWindow(interpolationWindow, coords)
    const sampler = createLayerProbeSampler(interpolationWindow.lower, coords)

    expect(probe?.value).toBe(30)
    expect(probe?.mix).toBe(0.5)
    expect(sampler).not.toBeNull()
    expect(sampleFieldInterpolationWindowWithSampler(interpolationWindow, sampler!)).toBe(probe?.value)
  })

  it('falls back to the available side when blending nodata values', () => {
    expect(blendLayerValues(12, null, 0.5)).toBe(12)
    expect(blendLayerValues(null, 24, 0.5)).toBe(24)
    expect(blendLayerValues(null, null, 0.5)).toBeNull()
  })

  it('samples a field time slice from a cached probe sampler', () => {
    const frame = createFrame([10, Number.NaN, 30, 50])
    const coords = {
      lon: 0.5,
      lat: 0.5,
    }
    const sampler = createLayerProbeSampler(frame, coords)

    expect(sampler).not.toBeNull()
    expect(sampleFieldTimeSliceWithSampler(frame, sampler!)).toBe(probeFieldTimeSlice(frame, coords)?.value)
  })
})
