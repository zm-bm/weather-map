import { describe, expect, it, vi } from 'vitest'

import {
  createMockWebGl2,
  createGridFixture,
  createPressureFrameFixture,
  createScalarEncodingFixture,
} from '@/test/fixtures'
import { createRenderControllerRegistry } from '../../maplibre/layerAdapter'
import {
  createContourRuntime,
  type ContourController,
} from './runtime'
import {
  PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE,
} from './shaders/contour'
import {
  PRESSURE_CONTOUR_RAW_FRAGMENT_SHADER_SOURCE,
} from './shaders/rawContour'
import {
  PRESSURE_SMOOTHING_FRAGMENT_SHADER_SOURCE,
} from './shaders/smoothing'
import { pressureFramePairRenderSpec } from './pressureEncoding'

function createMapFixture() {
  return {
    getZoom: vi.fn(() => 4.25),
    getCenter: vi.fn(() => ({ lng: 0 })),
    triggerRepaint: vi.fn(),
  }
}

describe('pressure contour encoded runtime', () => {
  it('derives runtime availability from the raw contour program and quad', () => {
    const controllers = createRenderControllerRegistry<ContourController>()
    const runtime = createContourRuntime(controllers)
    const gl = createMockWebGl2()
    gl.getExtension.mockReturnValue(null)
    const map = createMapFixture()

    runtime.onAdd(map as never, gl as never)
    expect(controllers.get(map as never)?.isAvailable()).toBe(true)

    runtime.onRemove(map as never, gl as never)
  })

  it('normalizes compatible pressure frame encoding for rendering', () => {
    const frame = createPressureFrameFixture()

    expect(pressureFramePairRenderSpec(frame, frame)).toEqual({
      hasNodata: 1,
      nodata: -128,
      scale: 50,
      offset: 100500,
    })
  })

  it('rejects pressure frame pairs with mismatched grids or encodings', () => {
    const lower = createPressureFrameFixture()
    const gridMismatch = {
      ...lower,
      raster: {
        ...lower.raster,
        grid: createGridFixture({ nx: 3, ny: 2 }),
      },
    }
    const encodingMismatch = {
      ...lower,
      raster: {
        ...lower.raster,
        encoding: createScalarEncodingFixture({
          id: 'pressure-other',
          format: 'linear-i8-v1',
          dtype: 'int8',
          byte_order: 'none',
          scale: 100,
          offset: 100500,
          nodata: -128,
        }),
      },
    }

    expect(() => pressureFramePairRenderSpec(lower, gridMismatch))
      .toThrow('Pressure contour frames must share the same grid')
    expect(() => pressureFramePairRenderSpec(lower, encodingMismatch))
      .toThrow('Pressure contour frames must share the same encoding')
  })

  it('uploads raw pressure as an integer texture array and prefilters to R32F when supported', () => {
    const controllers = createRenderControllerRegistry<ContourController>()
    const runtime = createContourRuntime(controllers)
    const gl = createMockWebGl2()
    gl.getExtension.mockReturnValue({})
    const map = createMapFixture()
    const slice = createPressureFrameFixture()

    runtime.onAdd(map as never, gl as never)
    controllers.get(map as never)?.applyFrame({
      lower: slice,
      upper: slice,
      selectedValidTimeMs: 0,
      lowerFrameId: slice.raster.frameId,
      upperFrameId: slice.raster.frameId,
      mix: 0,
    })

    expect(gl.texImage3D).toHaveBeenCalledWith(
      gl.TEXTURE_2D_ARRAY,
      0,
      gl.R8I,
      slice.raster.grid.nx,
      slice.raster.grid.ny,
      1,
      0,
      gl.RED_INTEGER,
      gl.BYTE,
      expect.any(Int8Array)
    )
    expect(gl.texImage2D).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      0,
      gl.R32F,
      slice.raster.grid.nx,
      slice.raster.grid.ny,
      0,
      gl.RED,
      gl.FLOAT,
      null
    )
    expect(gl.framebufferTexture2D).toHaveBeenCalledWith(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      expect.anything(),
      0
    )

    runtime.onRemove(map as never, gl as never)
  })

  it('reuses smoothed pressure textures across lower-to-upper frame transitions', () => {
    const controllers = createRenderControllerRegistry<ContourController>()
    const runtime = createContourRuntime(controllers)
    const gl = createMockWebGl2()
    gl.getExtension.mockReturnValue({})
    const map = createMapFixture()
    const first = createPressureFrameFixture({ frameId: '000' })
    const second = createPressureFrameFixture({ frameId: '001' })
    const third = createPressureFrameFixture({ frameId: '002' })

    runtime.onAdd(map as never, gl as never)
    const controller = controllers.get(map as never)
    controller?.applyFrame({
      lower: first,
      upper: second,
      selectedValidTimeMs: 0,
      lowerFrameId: '000',
      upperFrameId: '001',
      mix: 0.5,
    })
    const rawTextureUploads = () => gl.texImage3D.mock.calls.length
    const prefilterTextureUploads = () => gl.texImage2D.mock.calls.filter((call) => call[2] === gl.R32F).length
    expect(rawTextureUploads()).toBe(2)
    expect(prefilterTextureUploads()).toBe(2)

    controller?.applyFrame({
      lower: second,
      upper: third,
      selectedValidTimeMs: 0,
      lowerFrameId: '001',
      upperFrameId: '002',
      mix: 0.5,
    })

    expect(rawTextureUploads()).toBe(3)
    expect(prefilterTextureUploads()).toBe(3)
    runtime.onRemove(map as never, gl as never)
  })

  it('falls back to raw encoded contour rendering without float render support', () => {
    const controllers = createRenderControllerRegistry<ContourController>()
    const runtime = createContourRuntime(controllers)
    const gl = createMockWebGl2()
    gl.getExtension.mockReturnValue(null)
    const map = createMapFixture()
    const slice = createPressureFrameFixture()

    runtime.onAdd(map as never, gl as never)
    controllers.get(map as never)?.applyFrame({
      lower: slice,
      upper: slice,
      selectedValidTimeMs: 0,
      lowerFrameId: slice.raster.frameId,
      upperFrameId: slice.raster.frameId,
      mix: 0,
    })
    runtime.render(gl as never, {
      modelViewProjectionMatrix: new Float32Array(16),
    } as never)

    expect(gl.texImage2D).not.toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      0,
      gl.R32F,
      expect.any(Number),
      expect.any(Number),
      0,
      gl.RED,
      gl.FLOAT,
      null
    )
    expect(gl.uniform1i).toHaveBeenCalledWith('u_encoded_tex_lower', expect.any(Number))
    runtime.onRemove(map as never, gl as never)
  })

  it('falls back to raw encoded contours when the smoothing framebuffer is incomplete', () => {
    const controllers = createRenderControllerRegistry<ContourController>()
    const runtime = createContourRuntime(controllers)
    const gl = createMockWebGl2()
    gl.getExtension.mockReturnValue({})
    gl.checkFramebufferStatus.mockReturnValue(0)
    const map = createMapFixture()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const slice = createPressureFrameFixture()

    try {
      runtime.onAdd(map as never, gl as never)
      controllers.get(map as never)?.applyFrame({
        lower: slice,
        upper: slice,
        selectedValidTimeMs: 0,
        lowerFrameId: slice.raster.frameId,
        upperFrameId: slice.raster.frameId,
        mix: 0,
      })
      runtime.render(gl as never, {
        modelViewProjectionMatrix: new Float32Array(16),
      } as never)

      expect(warn).toHaveBeenCalledWith(
        '[contour] smoothed pressure framebuffer is incomplete; using raw fallback'
      )
      expect(gl.uniform1i).toHaveBeenCalledWith('u_encoded_tex_lower', expect.any(Number))
    } finally {
      runtime.onRemove(map as never, gl as never)
      warn.mockRestore()
    }
  })
})

describe('pressure contour shaders', () => {
  it('prefilters raw encoded pressure into hPa with the smoothing kernel', () => {
    expect(PRESSURE_SMOOTHING_FRAGMENT_SHADER_SOURCE).toContain('uniform isampler2DArray u_encoded_tex')
    expect(PRESSURE_SMOOTHING_FRAGMENT_SHADER_SOURCE).toContain('u_scale')
    expect(PRESSURE_SMOOTHING_FRAGMENT_SHADER_SOURCE).toContain('u_offset')
    expect(PRESSURE_SMOOTHING_FRAGMENT_SHADER_SOURCE).toContain('/ PASCALS_PER_HECTOPASCAL')
    expect(PRESSURE_SMOOTHING_FRAGMENT_SHADER_SOURCE).toContain('for (int y = -1; y <= 1; y++)')
  })

  it('uses smoothed bilinear pressure in the main contour shader', () => {
    expect(PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE).toContain('sampleSmoothedPressureBilinear')
    expect(PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE).toContain('blendEncodedSamples')
    expect(PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE).not.toContain('for (int y = -1; y <= 1; y++)')
    expect(PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE).not.toContain('u_encoded_tex_lower')
  })

  it('keeps a raw encoded fallback shader with contour-equivalent smoothing', () => {
    expect(PRESSURE_CONTOUR_RAW_FRAGMENT_SHADER_SOURCE).toContain('uniform isampler2DArray u_encoded_tex_lower')
    expect(PRESSURE_CONTOUR_RAW_FRAGMENT_SHADER_SOURCE).toContain('uniform isampler2DArray u_encoded_tex_upper')
    expect(PRESSURE_CONTOUR_RAW_FRAGMENT_SHADER_SOURCE).toContain('sampleLinearTemporalLayer')
    expect(PRESSURE_CONTOUR_RAW_FRAGMENT_SHADER_SOURCE).toContain('sampleSmoothedRawPressureHpa')
    expect(PRESSURE_CONTOUR_RAW_FRAGMENT_SHADER_SOURCE).toContain('/ PASCALS_PER_HECTOPASCAL')
  })
})
