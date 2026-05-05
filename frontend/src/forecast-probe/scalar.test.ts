import { describe, expect, it } from 'vitest'

import {
  blendScalarValues,
  createScalarProbeSampler,
  probeScalarFrame,
  probeScalarFrameWindow,
  sampleScalarFrameWindowWithSampler,
  sampleScalarFrameWithSampler,
} from './scalar'
import type { ScalarFrameData } from '../forecast-frame/scalar'

function createFrame(values: number[]): ScalarFrameData {
  return {
    hourToken: '000',
    variableId: 'tmp_surface',
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

describe('probeScalarFrame', () => {
  it('bilinearly interpolates nearby scalar values', () => {
    const probe = probeScalarFrame(createFrame([10, 20, 30, 40]), {
      lon: 0.5,
      lat: 0.5,
    })

    expect(probe?.value).toBe(25)
    expect(probe?.points.map((point) => point.weight)).toEqual([0.25, 0.25, 0.25, 0.25])
  })

  it('skips nodata neighbors when interpolating', () => {
    const probe = probeScalarFrame(createFrame([10, Number.NaN, 30, 50]), {
      lon: 0.5,
      lat: 0.5,
    })

    expect(probe?.value).toBe(30)
    expect(probe?.points.map((point) => point.value)).toEqual([10, null, 30, 50])
  })

  it('wraps longitudes across repeating grids', () => {
    const probe = probeScalarFrame(createFrame([10, 20, 30, 40]), {
      lon: 2.25,
      lat: 0.5,
    })

    expect(probe?.gridX).toBe(0.25)
    expect(probe?.value).toBe(22.5)
  })

  it('blends probe values across a scalar frame window', () => {
    const frameWindow = {
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
    const probe = probeScalarFrameWindow(frameWindow, coords)
    const sampler = createScalarProbeSampler(frameWindow.lower, coords)

    expect(probe?.value).toBe(30)
    expect(probe?.mix).toBe(0.5)
    expect(sampler).not.toBeNull()
    expect(sampleScalarFrameWindowWithSampler(frameWindow, sampler!)).toBe(probe?.value)
  })

  it('falls back to the available side when blending nodata values', () => {
    expect(blendScalarValues(12, null, 0.5)).toBe(12)
    expect(blendScalarValues(null, 24, 0.5)).toBe(24)
    expect(blendScalarValues(null, null, 0.5)).toBeNull()
  })

  it('samples a scalar frame from a cached probe sampler', () => {
    const frame = createFrame([10, Number.NaN, 30, 50])
    const coords = {
      lon: 0.5,
      lat: 0.5,
    }
    const sampler = createScalarProbeSampler(frame, coords)

    expect(sampler).not.toBeNull()
    expect(sampleScalarFrameWithSampler(frame, sampler!)).toBe(probeScalarFrame(frame, coords)?.value)
  })
})
