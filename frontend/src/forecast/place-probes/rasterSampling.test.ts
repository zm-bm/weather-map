import { describe, expect, it } from 'vitest'

import {
  blendRasterValues,
  createRasterProbeSampler,
  probeRasterFrame,
  probeRasterWindow,
  sampleRasterWindowWithSampler,
  sampleRasterFrameWithSampler,
} from './rasterSampling'
import type { ProbeWindow } from '@/forecast/frames'
import {
  createCloudLayersRasterFrameFixture,
  createRasterFrameFixture,
  createRasterLayerSourceFixture,
  createUvRasterFrameFixture,
  createVectorEncodingFixture,
} from '@/test/fixtures'

function createFrame(values: number[]): ProbeWindow['lower'] {
  const frame = createRasterFrameFixture({
    values: Int8Array.from(values, (value) => Number.isNaN(value) ? -128 : value),
  })
  return withProbeGrid(frame)
}

function createWindFrame(args: {
  u: number[]
  v: number[]
}): ProbeWindow['lower'] {
  return withProbeGrid(createUvRasterFrameFixture({
    u: args.u,
    v: args.v,
  }))
}

function createUnknownBandFrame(): ProbeWindow['lower'] {
  const baseFrame = createRasterFrameFixture()
  return withProbeGrid({
    ...baseFrame,
    source: createRasterLayerSourceFixture({
      layerId: 'unknown',
      artifactId: 'unknown_artifact',
      bands: [{ id: 'unknown' }],
    }),
    raster: {
      ...baseFrame.raster,
      artifactId: 'unknown_artifact',
      bandIds: ['unknown'],
      bands: [new Int8Array([1, 2, 3, 4])],
    },
  })
}

function withProbeGrid(frame: ProbeWindow['lower']): ProbeWindow['lower'] {
  return {
    ...frame,
    raster: {
      ...frame.raster,
      grid: {
        ...frame.raster.grid,
        lon0: 0,
        lat0: 1,
        dx: 1,
        dy: -1,
      },
    },
  }
}

describe('probeRasterFrame', () => {
  it('bilinearly interpolates nearby raster values', () => {
    const probe = probeRasterFrame(createFrame([10, 20, 30, 40]), {
      lon: 0.5,
      lat: 0.5,
    })

    expect(probe?.value).toBe(25)
    expect(probe?.points.map((point) => point.weight)).toEqual([0.25, 0.25, 0.25, 0.25])
  })

  it('skips nodata neighbors when interpolating', () => {
    const probe = probeRasterFrame(createFrame([10, Number.NaN, 30, 50]), {
      lon: 0.5,
      lat: 0.5,
    })

    expect(probe?.value).toBe(30)
    expect(probe?.points.map((point) => point.value)).toEqual([10, null, 30, 50])
  })

  it('wraps longitudes across repeating grids', () => {
    const probe = probeRasterFrame(createFrame([10, 20, 30, 40]), {
      lon: 2.25,
      lat: 0.5,
    })

    expect(probe?.gridX).toBe(0.25)
    expect(probe?.value).toBe(22.5)
  })

  it('blends probe values across a raster interpolation window', () => {
    const window = {
      lower: createFrame([10, 20, 30, 40]),
      upper: {
        ...createFrame([20, 30, 40, 50]),
        raster: {
          ...createFrame([20, 30, 40, 50]).raster,
          frameId: '001',
        },
      },
      selectedValidTimeMs: 1,
      lowerFrameId: '000',
      upperFrameId: '001',
      mix: 0.5,
    }
    const coords = {
      lon: 0.5,
      lat: 0.5,
    }
    const probe = probeRasterWindow(window, coords)
    const sampler = createRasterProbeSampler(window.lower, coords)

    expect(probe?.value).toBe(30)
    expect(probe?.mix).toBe(0.5)
    expect(sampler).not.toBeNull()
    expect(sampleRasterWindowWithSampler(window, sampler!)).toBe(probe?.value)
  })

  it('falls back to the available side when blending nodata values', () => {
    expect(blendRasterValues(12, null, 0.5)).toBe(12)
    expect(blendRasterValues(null, 24, 0.5)).toBe(24)
    expect(blendRasterValues(null, null, 0.5)).toBeNull()
  })

  it('samples a raster frame from a cached probe sampler', () => {
    const frame = createFrame([10, Number.NaN, 30, 50])
    const coords = {
      lon: 0.5,
      lat: 0.5,
    }
    const sampler = createRasterProbeSampler(frame, coords)

    expect(sampler).not.toBeNull()
    expect(sampleRasterFrameWithSampler(frame, sampler!)).toBe(probeRasterFrame(frame, coords)?.value)
  })

  it('decodes u/v raster bands as wind speed magnitude', () => {
    const probe = probeRasterFrame(createWindFrame({
      u: [3, 0, 0, 0],
      v: [4, 0, 0, 0],
    }), {
      lon: 0,
      lat: 1,
    })

    expect(probe?.value).toBe(5)
  })

  it('selects the decoder from loaded raster band ids instead of source metadata', () => {
    const baseFrame = createRasterFrameFixture()
    const probe = probeRasterFrame(withProbeGrid({
      ...baseFrame,
      raster: {
        ...baseFrame.raster,
        artifactId: 'wind10m_uv',
        encoding: createVectorEncodingFixture({ scale: 1, offset: 0, nodata: -128 }),
        bandIds: ['u', 'v'],
        bands: [
          new Int8Array([3, 0, 0, 0]),
          new Int8Array([4, 0, 0, 0]),
        ],
      },
    }), {
      lon: 0,
      lat: 1,
    })

    expect(probe?.value).toBe(5)
  })

  it('decodes low/middle/high raster bands as composite cloud coverage', () => {
    const frame = withProbeGrid(createCloudLayersRasterFrameFixture())
    const probe = probeRasterFrame({
      ...frame,
      raster: {
        ...frame.raster,
        encoding: createVectorEncodingFixture({ scale: 1, offset: 0, nodata: -128 }),
        bands: [
          new Int8Array([50, 0, 0, 0]),
          new Int8Array([50, 0, 0, 0]),
          new Int8Array([0, 0, 0, 0]),
        ],
      },
    }, {
      lon: 0,
      lat: 1,
    })

    expect(probe?.value).toBe(75)
  })

  it('returns null for unsupported raster band shapes', () => {
    const probe = probeRasterFrame(createUnknownBandFrame(), {
      lon: 0,
      lat: 1,
    })

    expect(probe?.value).toBeNull()
  })
})
