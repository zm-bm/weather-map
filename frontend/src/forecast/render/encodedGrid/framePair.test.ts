import { describe, expect, it } from 'vitest'

import {
  createGridFixture,
  createMockWebGl2,
  createScalarEncodingFixture,
} from '@/test/fixtures'
import { EncodedGridTextureCache } from './texture'
import {
  assertEncodedRasterBandIds,
  ENCODED_GRID_X_WRAP_NONE,
  ENCODED_GRID_X_WRAP_REPEAT,
  ENCODED_GRID_Y_MODE_CLAMP,
  ENCODED_GRID_Y_MODE_NONE,
  encodedFramePairUniforms,
  encodedGridBoundaryUniforms,
  encodedGridUniforms,
  encodedLinearUniforms,
  encodedRasterBandIdMismatch,
  encodedRasterFrameSpec,
  resolveEncodedFramePair,
  validateEncodedGridFrameSpec,
} from './framePair'

type FrameFixture = {
  key: string
  values: Int8Array
}

describe('encoded grid frame pair helpers', () => {
  it('collapses same-frame mixes and uploads only one cached texture', () => {
    const gl = createMockWebGl2()
    const cache = new EncodedGridTextureCache()
    const grid = createGridFixture({ nx: 2, ny: 1 })
    const frame = {
      key: 'frame:000',
      values: new Int8Array([1, 2]),
    }

    const pair = resolveEncodedFramePair({
      gl: gl as never,
      textureCache: cache,
      current: null,
      lowerFrame: frame,
      upperFrame: {
        key: 'frame:003',
        values: new Int8Array([3, 4]),
      },
      mix: 0,
      frameSpec: (entry) => ({
        key: entry.key,
        grid,
        bands: [entry.values],
        label: entry.key,
      }),
    })

    expect(pair?.grid).toBe(grid)
    expect(pair?.upperFrame).toBe(frame)
    expect(pair?.upperTexture).toBe(pair?.lowerTexture)
    expect(pair?.timeMix).toBe(0)
    expect(gl.texImage3D).toHaveBeenCalledTimes(1)
  })

  it('reuses lower and upper textures from the previous frame pair', () => {
    const gl = createMockWebGl2()
    const cache = new EncodedGridTextureCache()
    const grid = createGridFixture({ nx: 1, ny: 1 })
    const lowerFrame = { key: 'frame:000', values: new Int8Array([1]) }
    const upperFrame = { key: 'frame:003', values: new Int8Array([2]) }
    const spec = (entry: FrameFixture) => ({
      key: entry.key,
      grid,
      bands: [entry.values],
      label: entry.key,
    })

    const first = resolveEncodedFramePair({
      gl: gl as never,
      textureCache: cache,
      current: null,
      lowerFrame,
      upperFrame,
      mix: 0.5,
      frameSpec: spec,
    })
    const second = resolveEncodedFramePair({
      gl: gl as never,
      textureCache: cache,
      current: first,
      lowerFrame,
      upperFrame,
      mix: 0.5,
      frameSpec: spec,
    })

    expect(second?.lowerTexture).toBe(first?.lowerTexture)
    expect(second?.upperTexture).toBe(first?.upperTexture)
    expect(gl.texImage3D).toHaveBeenCalledTimes(2)
  })

  it('validates band sizes and exposes grid uniforms', () => {
    const grid = createGridFixture({ nx: 2, ny: 2, lon0: -180, lat0: 90, dx: 0.25, dy: -0.25 })

    expect(() => validateEncodedGridFrameSpec({
      key: 'bad',
      grid,
      bands: [new Int8Array([1, 2, 3])],
      label: 'bad frame',
    })).toThrow('Unexpected bad frame grid size: got=3 expected=4')

    expect(encodedGridUniforms(grid)).toEqual({
      u_grid_size: [2, 2],
      u_lon0: -180,
      u_lat0: 90,
      u_dx: 0.25,
      u_dy: -0.25,
      u_x_wrap: ENCODED_GRID_X_WRAP_NONE,
      u_y_mode: ENCODED_GRID_Y_MODE_NONE,
    })
  })

  it('derives effective boundary uniforms from grid coverage', () => {
    const globalGrid = createGridFixture({
      nx: 1440,
      ny: 720,
      lon0: 0,
      lat0: 90,
      dx: 0.25,
      dy: -0.25,
      x_wrap: 'repeat',
      y_mode: 'clamp',
    })
    const staleRegionalGrid = createGridFixture({
      nx: 3500,
      ny: 1750,
      lon0: -130,
      lat0: 55,
      dx: 0.02,
      dy: -0.02,
      x_wrap: 'repeat',
      y_mode: 'clamp',
    })

    expect(encodedGridBoundaryUniforms(globalGrid)).toEqual({
      u_x_wrap: ENCODED_GRID_X_WRAP_REPEAT,
      u_y_mode: ENCODED_GRID_Y_MODE_CLAMP,
    })
    expect(encodedGridBoundaryUniforms(staleRegionalGrid)).toEqual({
      u_x_wrap: ENCODED_GRID_X_WRAP_NONE,
      u_y_mode: ENCODED_GRID_Y_MODE_NONE,
    })
  })

  it('builds encoded raster frame specs after exact band-id validation', () => {
    const grid = createGridFixture({ nx: 2, ny: 1 })
    const raster = {
      frameId: '000',
      artifactId: 'tmp_surface',
      cacheKey: 'tmp_surface:000',
      grid,
      encoding: createScalarEncodingFixture(),
      bandIds: ['value'],
      bands: [new Int8Array([1, 2])],
    }

    expect(encodedRasterFrameSpec({
      raster,
      expectedBandIds: ['value'],
      label: 'temperature raster',
    })).toEqual({
      key: 'tmp_surface:000',
      grid,
      bands: raster.bands,
      label: 'temperature raster',
    })
  })

  it('reports encoded raster band-id mismatches consistently', () => {
    const raster = {
      frameId: '000',
      artifactId: 'wind10m_uv',
      cacheKey: 'wind10m_uv:000',
      grid: createGridFixture({ nx: 1, ny: 1 }),
      encoding: createScalarEncodingFixture(),
      bandIds: ['u'],
      bands: [new Int8Array([1])],
    }

    expect(encodedRasterBandIdMismatch({
      raster,
      expectedBandIds: ['u', 'v'],
      label: 'wind raster',
    })).toBe('wind raster requires bands u, v; got u')
    expect(() => assertEncodedRasterBandIds({
      raster,
      expectedBandIds: ['u', 'v'],
      label: 'wind raster',
    })).toThrow('wind raster requires bands u, v; got u')
  })

  it('exposes standard lower/upper texture, grid, and mix uniforms for a frame pair', () => {
    const grid = createGridFixture({ nx: 2, ny: 2, lon0: -180, lat0: 90, dx: 0.25, dy: -0.25 })
    const lowerTexture = {} as WebGLTexture
    const upperTexture = {} as WebGLTexture
    const lowerFrame: FrameFixture = {
      key: 'frame:000',
      values: new Int8Array([1, 2, 3, 4]),
    }
    const upperFrame: FrameFixture = {
      key: 'frame:001',
      values: new Int8Array([5, 6, 7, 8]),
    }

    expect(encodedFramePairUniforms({
      lowerFrame,
      upperFrame,
      grid,
      lowerTexture,
      upperTexture,
      timeMix: 0.25,
    })).toEqual({
      u_encoded_tex_lower: lowerTexture,
      u_encoded_tex_upper: upperTexture,
      u_grid_size: [2, 2],
      u_lon0: -180,
      u_lat0: 90,
      u_dx: 0.25,
      u_dy: -0.25,
      u_x_wrap: ENCODED_GRID_X_WRAP_NONE,
      u_y_mode: ENCODED_GRID_Y_MODE_NONE,
      u_time_mix: 0.25,
    })
  })

  it('exposes standard linear decode uniforms for render specs and encodings', () => {
    expect(encodedLinearUniforms({
      hasNodata: 1,
      nodata: -128,
      scale: 4,
      offset: 0,
    })).toEqual({
      u_has_nodata: 1,
      u_nodata: -128,
      u_scale: 4,
      u_offset: 0,
    })

    expect(encodedLinearUniforms({
      nodata: -9999,
      scale: 0.5,
      offset: 273.15,
    })).toEqual({
      u_has_nodata: 1,
      u_nodata: -9999,
      u_scale: 0.5,
      u_offset: 273.15,
    })

    expect(encodedLinearUniforms({
      scale: 1,
      offset: 0,
    })).toEqual({
      u_has_nodata: 0,
      u_nodata: 0,
      u_scale: 1,
      u_offset: 0,
    })
  })
})
