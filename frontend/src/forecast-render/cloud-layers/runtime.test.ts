import { describe, expect, it, vi } from 'vitest'

import type { CloudLayersTimeSliceData } from '../../forecast-data'
import { getCloudLayersController } from './controller'
import { createCloudLayersRuntime, packCloudTextureBytes } from './runtime'

function createMockWebGl2() {
  return {
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,
    ARRAY_BUFFER: 34962,
    STATIC_DRAW: 35044,
    FLOAT: 5126,
    TEXTURE_2D: 3553,
    UNPACK_ALIGNMENT: 3317,
    TEXTURE_MIN_FILTER: 10241,
    TEXTURE_MAG_FILTER: 10240,
    NEAREST: 9728,
    TEXTURE_WRAP_S: 10242,
    TEXTURE_WRAP_T: 10243,
    REPEAT: 10497,
    CLAMP_TO_EDGE: 33071,
    RGBA8: 32856,
    RGBA: 6408,
    UNSIGNED_BYTE: 5121,
    TEXTURE0: 33984,
    TEXTURE1: 33985,
    DEPTH_TEST: 2929,
    BLEND: 3042,
    SRC_ALPHA: 770,
    ONE_MINUS_SRC_ALPHA: 771,
    TRIANGLES: 4,
    createVertexArray: vi.fn(() => ({})),
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ''),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ''),
    deleteProgram: vi.fn(),
    createBuffer: vi.fn(() => ({})),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    deleteBuffer: vi.fn(),
    bindVertexArray: vi.fn(),
    deleteVertexArray: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    getUniformLocation: vi.fn((_program: unknown, name: string) => name),
    createTexture: vi.fn(() => ({})),
    bindTexture: vi.fn(),
    pixelStorei: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    deleteTexture: vi.fn(),
    useProgram: vi.fn(),
    activeTexture: vi.fn(),
    uniform1i: vi.fn(),
    uniform1f: vi.fn(),
    uniform2f: vi.fn(),
    uniformMatrix4fv: vi.fn(),
    disable: vi.fn(),
    enable: vi.fn(),
    blendFunc: vi.fn(),
    drawArrays: vi.fn(),
  }
}

function createCloudTimeSlice(): CloudLayersTimeSliceData {
  return {
    hourToken: '000',
    layerId: 'cloud_layers',
    artifactId: 'cloud_layers',
    grid: {
      id: 'global-1deg',
      crs: 'EPSG:4326',
      nx: 1,
      ny: 1,
      lon0: 0,
      lat0: 0,
      dx: 1,
      dy: 1,
      origin: 'cell_center',
      layout: 'row_major',
      xWrap: 'repeat',
      yMode: 'clamp',
    },
    encoding: {
      id: 'cloud_layers_vector_i8_2pct_v1',
      format: 'linear-i8-v1',
      dtype: 'int8',
      byteOrder: 'none',
      scale: 2,
      offset: 0,
      nodata: -128,
      decodeFormula: 'decoded = stored * scale + offset',
    },
    low: new Int8Array([20]),
    middle: new Int8Array([40]),
    high: new Int8Array([60]),
    coverage: {} as CloudLayersTimeSliceData['coverage'],
  }
}

describe('cloud layers runtime', () => {
  it('passes map zoom to the shader for zoom-aware opacity', () => {
    const runtime = createCloudLayersRuntime()
    const gl = createMockWebGl2()
    const map = {
      getZoom: vi.fn(() => 4.25),
      getCenter: vi.fn(() => ({ lng: 0 })),
      triggerRepaint: vi.fn(),
    }

    runtime.onAdd(map as never, gl as never)
    const controller = getCloudLayersController(map as never)
    const slice = createCloudTimeSlice()
    controller?.applyFrame({
      lower: slice,
      upper: slice,
      selectedValidTimeMs: 0,
      lowerHourToken: '000',
      upperHourToken: '000',
      mix: 0,
    })

    runtime.render(gl as never, {
      modelViewProjectionMatrix: new Float32Array(16),
    } as never)

    expect(gl.uniform1f).toHaveBeenCalledWith('u_zoom', 4.25)

    runtime.onRemove(map as never, gl as never)
  })

  it('packs cloud layer components into renderer texture bytes', () => {
    const slice = createCloudTimeSlice()

    expect(Array.from(packCloudTextureBytes(slice))).toEqual([20, 40, 60, 255])
  })
})
