import { describe, expect, it, vi } from 'vitest'

import {
  createCustomRenderInputFixture,
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
import { pressureFramePairRenderSpec } from './renderPaths/pressure'

function createMapFixture() {
  return {
    getZoom: vi.fn(() => 4.25),
    getCenter: vi.fn(() => ({ lng: 0 })),
    triggerRepaint: vi.fn(),
  }
}

describe('pressure contour encoded runtime', () => {
  it('derives runtime availability from the contour program, quad, and float prefilter', () => {
    const controllers = createRenderControllerRegistry<ContourController>()
    const runtime = createContourRuntime(controllers)
    const gl = createMockWebGl2()
    gl.getExtension.mockReturnValue({})
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

  it('uploads raw pressure as an integer texture array and prefilters to RG32F when supported', () => {
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
      gl.RG32F,
      slice.raster.grid.nx,
      slice.raster.grid.ny,
      0,
      gl.RG,
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
    const prefilterTextureUploads = () => gl.texImage2D.mock.calls.filter((call) => call[2] === gl.RG32F).length
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

  it('is unavailable without float render support instead of using a raw fallback', () => {
    const controllers = createRenderControllerRegistry<ContourController>()
    const runtime = createContourRuntime(controllers)
    const gl = createMockWebGl2()
    gl.getExtension.mockReturnValue(null)
    const map = createMapFixture()
    const slice = createPressureFrameFixture()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      runtime.onAdd(map as never, gl as never)
      expect(controllers.get(map as never)?.isAvailable()).toBe(false)
      expect(warn).toHaveBeenCalledWith(
        '[contour] EXT_color_buffer_float is required for pressure contours; contours disabled'
      )
      expect(() => controllers.get(map as never)?.applyFrame({
        lower: slice,
        upper: slice,
        selectedValidTimeMs: 0,
        lowerFrameId: slice.raster.frameId,
        upperFrameId: slice.raster.frameId,
        mix: 0,
      })).toThrow('Contour runtime unavailable')
      runtime.render(gl as never, createCustomRenderInputFixture() as never)

      expect(gl.texImage2D).not.toHaveBeenCalledWith(
        gl.TEXTURE_2D,
        0,
        gl.RG32F,
        expect.any(Number),
        expect.any(Number),
        0,
        gl.RG,
        gl.FLOAT,
        null
      )
      expect(gl.uniform1i).not.toHaveBeenCalledWith('u_encoded_tex_lower', expect.any(Number))
    } finally {
      runtime.onRemove(map as never, gl as never)
      warn.mockRestore()
    }
  })

  it('disables contours when the smoothing framebuffer is incomplete', () => {
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
      runtime.render(gl as never, createCustomRenderInputFixture() as never)

      expect(warn).toHaveBeenCalledWith(
        '[contour] smoothed pressure framebuffer is incomplete; contours disabled'
      )
      expect(controllers.get(map as never)?.isAvailable()).toBe(false)
      expect(gl.uniform1i).not.toHaveBeenCalledWith('u_encoded_tex_lower', expect.any(Number))
    } finally {
      runtime.onRemove(map as never, gl as never)
      warn.mockRestore()
    }
  })
})
