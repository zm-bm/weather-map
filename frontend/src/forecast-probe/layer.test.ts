import { describe, expect, it } from 'vitest'

import {
  blendLayerValues,
  createLayerProbeSampler,
  probeFieldFrame,
  probeFieldFrameWindow,
  sampleFieldFrameWindowWithSampler,
  sampleFieldFrameWithSampler,
} from './layer'
import type { FieldFrameData } from '../forecast-frame'

function createFrame(values: number[]): FieldFrameData {
  return {
    hourToken: '000',
    layerId: 'tmp_surface',
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
    overlays: [],
  }
}

describe('probeFieldFrame', () => {
  it('bilinearly interpolates nearby layer values', () => {
    const probe = probeFieldFrame(createFrame([10, 20, 30, 40]), {
      lon: 0.5,
      lat: 0.5,
    })

    expect(probe?.value).toBe(25)
    expect(probe?.points.map((point) => point.weight)).toEqual([0.25, 0.25, 0.25, 0.25])
  })

  it('skips nodata neighbors when interpolating', () => {
    const probe = probeFieldFrame(createFrame([10, Number.NaN, 30, 50]), {
      lon: 0.5,
      lat: 0.5,
    })

    expect(probe?.value).toBe(30)
    expect(probe?.points.map((point) => point.value)).toEqual([10, null, 30, 50])
  })

  it('wraps longitudes across repeating grids', () => {
    const probe = probeFieldFrame(createFrame([10, 20, 30, 40]), {
      lon: 2.25,
      lat: 0.5,
    })

    expect(probe?.gridX).toBe(0.25)
    expect(probe?.value).toBe(22.5)
  })

  it('blends probe values across a layer frame window', () => {
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
    const probe = probeFieldFrameWindow(frameWindow, coords)
    const sampler = createLayerProbeSampler(frameWindow.lower, coords)

    expect(probe?.value).toBe(30)
    expect(probe?.mix).toBe(0.5)
    expect(sampler).not.toBeNull()
    expect(sampleFieldFrameWindowWithSampler(frameWindow, sampler!)).toBe(probe?.value)
  })

  it('falls back to the available side when blending nodata values', () => {
    expect(blendLayerValues(12, null, 0.5)).toBe(12)
    expect(blendLayerValues(null, 24, 0.5)).toBe(24)
    expect(blendLayerValues(null, null, 0.5)).toBeNull()
  })

  it('samples a layer frame from a cached probe sampler', () => {
    const frame = createFrame([10, Number.NaN, 30, 50])
    const coords = {
      lon: 0.5,
      lat: 0.5,
    }
    const sampler = createLayerProbeSampler(frame, coords)

    expect(sampler).not.toBeNull()
    expect(sampleFieldFrameWithSampler(frame, sampler!)).toBe(probeFieldFrame(frame, coords)?.value)
  })
})
