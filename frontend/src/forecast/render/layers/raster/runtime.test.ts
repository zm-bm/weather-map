import { describe, expect, it, vi } from 'vitest'

import type { ForecastFrameMap } from '@/forecast/frames'
import {
  createMockWebGl2,
  createGridFixture,
  createScalarEncodingFixture,
  createVectorEncodingFixture,
  createRasterLayerSourceFixture,
  createRasterFrameFixture,
  createCloudLayersRasterFrameFixture,
} from '@/test/fixtures'
import {
  WRAPPED_WORLD_VERTEX_SHADER_SOURCE,
  WORLD_WRAP_COPY_OFFSETS,
} from '../../gpu'
import { createRenderControllerRegistry } from '../../maplibre/layerAdapter'
import { createRasterRuntime, type RasterController } from './runtime'
import { COLORMAP_FRAGMENT_SHADER_SOURCE } from './styles/colormapShaders'
import { CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE } from './styles/cloudLayers'

function createMapFixture() {
  return {
    getZoom: vi.fn(() => 4.25),
    getCenter: vi.fn(() => ({ lng: 0 })),
    triggerRepaint: vi.fn(),
  }
}

describe('raster runtime encoded sources', () => {
  it('uses shared wrapped-world render primitives', () => {
    expect(WRAPPED_WORLD_VERTEX_SHADER_SOURCE).toContain('uniform float u_world_offset_x')
    expect(WRAPPED_WORLD_VERTEX_SHADER_SOURCE).toContain('out vec2 v_mercator')
    expect(WORLD_WRAP_COPY_OFFSETS).toEqual([-2, -1, 0, 1, 2])
  })

  it('keeps the colormap raster shader encoded-only', () => {
    expect(COLORMAP_FRAGMENT_SHADER_SOURCE).toContain('uniform isampler2DArray u_encoded_tex_lower')
    expect(COLORMAP_FRAGMENT_SHADER_SOURCE).toContain('uniform isampler2DArray u_encoded_tex_upper')
    expect(COLORMAP_FRAGMENT_SHADER_SOURCE).toContain('uniform int u_source_sampling_mode')
    expect(COLORMAP_FRAGMENT_SHADER_SOURCE).toContain('sampleWindSpeedTemporalLayer')
    expect(COLORMAP_FRAGMENT_SHADER_SOURCE).toContain('sampleWindSpeedNearestTemporalLayer')
    expect(COLORMAP_FRAGMENT_SHADER_SOURCE).toContain('sampleTempCNearestTemporalLayer')
    expect(COLORMAP_FRAGMENT_SHADER_SOURCE).toContain('sampleLinearNearestTemporalLayer')
    expect(COLORMAP_FRAGMENT_SHADER_SOURCE).not.toContain('u_float_tex')
    expect(COLORMAP_FRAGMENT_SHADER_SOURCE).not.toContain('SOURCE_MODE_FLOAT32')
  })

  it('uploads encoded scalar rasters as integer texture arrays', () => {
    const controllers = createRenderControllerRegistry<RasterController>()
    const runtime = createRasterRuntime(controllers)
    const gl = createMockWebGl2()
    const map = createMapFixture()
    const grid = createGridFixture({ nx: 2, ny: 2 })
    const encoding = createScalarEncodingFixture()
    const slice: ForecastFrameMap['raster'] = {
      source: createRasterLayerSourceFixture({ layerId: 'temperature' }),
      raster: {
        frameId: '000',
        artifactId: 'tmp_surface',
        cacheKey: 'fixture:scalar:000',
        grid,
        encoding,
        bandIds: ['value'],
        bands: [new Int8Array([1, 2, 3, 4])],
      },
    }

    runtime.onAdd(map as never, gl as never)
    controllers.get(map as never)?.applyFrame({
      lower: slice,
      upper: slice,
      selectedValidTimeMs: 0,
      lowerFrameId: '000',
      upperFrameId: '000',
      mix: 0,
    })
    runtime.render(gl as never, {
      modelViewProjectionMatrix: new Float32Array(16),
    } as never)

    expect(gl.texImage3D).toHaveBeenCalledWith(
      gl.TEXTURE_2D_ARRAY,
      0,
      gl.R8I,
      2,
      2,
      1,
      0,
      gl.RED_INTEGER,
      gl.BYTE,
      expect.any(Int8Array)
    )
    expect(gl.texImage2D).not.toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      0,
      gl.R32F,
      2,
      2,
      0,
      gl.RED,
      gl.FLOAT,
      expect.anything()
    )
    expect(gl.uniform1i).toHaveBeenCalledWith('u_encoded_tex_lower', expect.any(Number))
    expect(gl.uniform1i).toHaveBeenCalledWith('u_encoded_tex_upper', expect.any(Number))
    expect(gl.uniform1i).toHaveBeenCalledWith('u_source_sampling_mode', 0)
    expect(gl.drawArrays).toHaveBeenCalledTimes(WORLD_WRAP_COPY_OFFSETS.length)

    runtime.onRemove(map as never, gl as never)
  })

  it('uploads shader-derived wind speed rasters as two-band integer texture arrays', () => {
    const controllers = createRenderControllerRegistry<RasterController>()
    const runtime = createRasterRuntime(controllers)
    const gl = createMockWebGl2()
    const map = createMapFixture()
    const grid = createGridFixture({ nx: 2, ny: 2 })
    const vectorEncoding = createVectorEncodingFixture()
    const slice: ForecastFrameMap['raster'] = {
      source: createRasterLayerSourceFixture({
        layerId: 'wind_speed',
        displayProfile: 'wind-speed',
        artifactId: 'wind10m_uv',
        bands: [
          { id: 'u' },
          { id: 'v' },
        ],
      }),
      raster: {
        frameId: '000',
        artifactId: 'wind10m_uv',
        cacheKey: 'fixture:wind:000',
        grid,
        encoding: vectorEncoding,
        bandIds: ['u', 'v'],
        bands: [
          new Int8Array([3, 0, -3, 0]),
          new Int8Array([4, 0, -4, 0]),
        ],
      },
    }

    runtime.onAdd(map as never, gl as never)
    controllers.get(map as never)?.applyFrame({
      lower: slice,
      upper: slice,
      selectedValidTimeMs: 0,
      lowerFrameId: '000',
      upperFrameId: '000',
      mix: 0,
    })

    expect(gl.texImage3D).toHaveBeenCalledWith(
      gl.TEXTURE_2D_ARRAY,
      0,
      gl.R8I,
      2,
      2,
      2,
      0,
      gl.RED_INTEGER,
      gl.BYTE,
      expect.any(Int8Array)
    )

    runtime.onRemove(map as never, gl as never)
  })

  it('reuses encoded textures across lower-to-upper frame transitions', () => {
    const controllers = createRenderControllerRegistry<RasterController>()
    const runtime = createRasterRuntime(controllers)
    const gl = createMockWebGl2()
    const map = createMapFixture()
    const grid = createGridFixture({ nx: 1, ny: 1 })
    const encoding = createScalarEncodingFixture()
    const createSlice = (frameId: string, value: number): ForecastFrameMap['raster'] => ({
      ...createRasterFrameFixture({ frameId, values: [value] }),
      raster: {
        frameId,
        artifactId: 'tmp_surface',
        cacheKey: `fixture:scalar:${frameId}`,
        grid,
        encoding,
        bandIds: ['value'],
        bands: [new Int8Array([value])],
      },
    })
    const first = createSlice('000', 1)
    const second = createSlice('001', 2)
    const third = createSlice('002', 3)

    runtime.onAdd(map as never, gl as never)
    const controller = controllers.get(map as never)
    controller?.applyFrame({
      lower: first,
      upper: second,
      selectedValidTimeMs: 0,
      lowerFrameId: first.raster.frameId,
      upperFrameId: second.raster.frameId,
      mix: 0.5,
    })
    expect(gl.texImage3D).toHaveBeenCalledTimes(2)

    controller?.applyFrame({
      lower: second,
      upper: third,
      selectedValidTimeMs: 0,
      lowerFrameId: second.raster.frameId,
      upperFrameId: third.raster.frameId,
      mix: 0.5,
    })

    expect(gl.texImage3D).toHaveBeenCalledTimes(3)
    runtime.onRemove(map as never, gl as never)
  })

  it('uploads cloud layer rasters as three-band integer texture arrays', () => {
    const controllers = createRenderControllerRegistry<RasterController>()
    const runtime = createRasterRuntime(controllers)
    const gl = createMockWebGl2()
    const map = createMapFixture()
    const slice = createCloudLayersRasterFrameFixture()

    runtime.onAdd(map as never, gl as never)
    controllers.get(map as never)?.applyFrame({
      lower: slice,
      upper: slice,
      selectedValidTimeMs: 0,
      lowerFrameId: '000',
      upperFrameId: '000',
      mix: 0,
    })
    runtime.render(gl as never, {
      modelViewProjectionMatrix: new Float32Array(16),
    } as never)

    expect(CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE).toContain('uniform isampler2DArray u_encoded_tex_lower')
    expect(CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE).toContain('uniform int u_source_sampling_mode')
    expect(CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE).toContain('sampleLinearNearestTemporalLayer')
    expect(CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE).toContain('uniform vec3 u_low_cloud_color')
    expect(gl.texImage3D).toHaveBeenCalledWith(
      gl.TEXTURE_2D_ARRAY,
      0,
      gl.R8I,
      2,
      2,
      3,
      0,
      gl.RED_INTEGER,
      gl.BYTE,
      expect.any(Int8Array)
    )
    expect(gl.uniform1f).toHaveBeenCalledWith('u_zoom', expect.any(Number))
    expect(gl.uniform1i).toHaveBeenCalledWith('u_source_sampling_mode', 0)
    expect(gl.uniform3fv).toHaveBeenCalledWith('u_low_cloud_color', [96 / 255, 104 / 255, 112 / 255])
    expect(gl.uniform3fv).toHaveBeenCalledWith('u_middle_cloud_color', [166 / 255, 172 / 255, 178 / 255])
    expect(gl.uniform3fv).toHaveBeenCalledWith('u_high_cloud_color', [236 / 255, 244 / 255, 252 / 255])

    runtime.onRemove(map as never, gl as never)
  })

  it('passes nearest grid sampling mode to colormap and cloud raster shaders', () => {
    const controllers = createRenderControllerRegistry<RasterController>()
    const runtime = createRasterRuntime(controllers, {
      gridSamplingMode: 'nearest',
      colorSamplingMode: 'gradient',
      opacity: 1,
    })
    const gl = createMockWebGl2()
    const map = createMapFixture()
    const scalarFrame = createRasterFrameFixture()
    const cloudFrame = createCloudLayersRasterFrameFixture()

    runtime.onAdd(map as never, gl as never)
    const controller = controllers.get(map as never)
    controller?.applyFrame({
      lower: scalarFrame,
      upper: scalarFrame,
      selectedValidTimeMs: 0,
      lowerFrameId: scalarFrame.raster.frameId,
      upperFrameId: scalarFrame.raster.frameId,
      mix: 0,
    })
    runtime.render(gl as never, {
      modelViewProjectionMatrix: new Float32Array(16),
    } as never)
    expect(gl.uniform1i).toHaveBeenCalledWith('u_source_sampling_mode', 1)

    gl.uniform1i.mockClear()
    controller?.applyFrame({
      lower: cloudFrame,
      upper: cloudFrame,
      selectedValidTimeMs: 0,
      lowerFrameId: cloudFrame.raster.frameId,
      upperFrameId: cloudFrame.raster.frameId,
      mix: 0,
    })
    runtime.render(gl as never, {
      modelViewProjectionMatrix: new Float32Array(16),
    } as never)
    expect(gl.uniform1i).toHaveBeenCalledWith('u_source_sampling_mode', 1)

    runtime.onRemove(map as never, gl as never)
  })

  it('rejects raster windows with mismatched lower and upper styles', () => {
    const controllers = createRenderControllerRegistry<RasterController>()
    const runtime = createRasterRuntime(controllers)
    const gl = createMockWebGl2()
    const map = createMapFixture()
    const scalarFrame = createRasterFrameFixture()
    const cloudFrame = createCloudLayersRasterFrameFixture()

    runtime.onAdd(map as never, gl as never)

    expect(() => controllers.get(map as never)?.applyFrame({
      lower: scalarFrame,
      upper: cloudFrame,
      selectedValidTimeMs: 0,
      lowerFrameId: scalarFrame.raster.frameId,
      upperFrameId: cloudFrame.raster.frameId,
      mix: 0.5,
    })).toThrow('Raster frame render style mismatch: lower=colormap upper=cloud-layers')

    runtime.onRemove(map as never, gl as never)
  })

  it('clears colormap textures when switching to cloud layer rendering', () => {
    const controllers = createRenderControllerRegistry<RasterController>()
    const runtime = createRasterRuntime(controllers)
    const gl = createMockWebGl2()
    const map = createMapFixture()
    const scalarFrame = createRasterFrameFixture()
    const cloudFrame = createCloudLayersRasterFrameFixture()

    runtime.onAdd(map as never, gl as never)
    const controller = controllers.get(map as never)
    controller?.applyFrame({
      lower: scalarFrame,
      upper: scalarFrame,
      selectedValidTimeMs: 0,
      lowerFrameId: scalarFrame.raster.frameId,
      upperFrameId: scalarFrame.raster.frameId,
      mix: 0,
    })
    const colormapTextureInterpolated = gl.createTexture.mock.results[1]?.value
    const colormapTextureBanded = gl.createTexture.mock.results[2]?.value

    controller?.applyFrame({
      lower: cloudFrame,
      upper: cloudFrame,
      selectedValidTimeMs: 0,
      lowerFrameId: cloudFrame.raster.frameId,
      upperFrameId: cloudFrame.raster.frameId,
      mix: 0,
    })

    expect(gl.deleteTexture).toHaveBeenCalledWith(colormapTextureInterpolated)
    expect(gl.deleteTexture).toHaveBeenCalledWith(colormapTextureBanded)

    runtime.onRemove(map as never, gl as never)
  })
})
