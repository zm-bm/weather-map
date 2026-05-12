import { describe, expect, it } from 'vitest'

import type { ScalarFrameData } from '../../../forecast-frame/scalar'
import {
  buildColormapLut,
  createCloudLayerTextureData,
  getScalarFrameRenderMode,
} from './runtime'

function getLutRgb(lut: Uint8Array, index: number): [number, number, number] {
  const offset = index * 4
  return [lut[offset], lut[offset + 1], lut[offset + 2]]
}

function createScalarFrame(overrides: Partial<ScalarFrameData> = {}): ScalarFrameData {
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
      lat0: 0,
      dx: 1,
      dy: -1,
      origin: 'cell_center',
      layout: 'row_major',
      xWrap: 'repeat',
      yMode: 'clamp',
    },
    encoding: {
      id: 'e0',
      format: 'linear-i8-v1',
      dtype: 'int8',
      byteOrder: 'none',
      nodata: -128,
      scale: 1,
      offset: 0,
      decodeFormula: 'value = stored * scale + offset',
    },
    values: new Float32Array([1, 2, 3, 4]),
    displayRange: [0, 100],
    colortable: [[0, 0, 0, 0], [100, 255, 255, 255]],
    ...overrides,
  }
}

describe('scalar runtime helpers', () => {
  it('uses the normal colormap render path for standard scalar frames', () => {
    expect(getScalarFrameRenderMode(createScalarFrame())).toBe('colormap')
  })

  it('uses the cloud render path for component scalar frames', () => {
    expect(getScalarFrameRenderMode(createScalarFrame({
      variableId: 'cloud_layers',
      cloudLayers: {
        low: new Float32Array([0, 5, 10, 15]),
        medium: new Float32Array([20, 25, 30, 35]),
        high: new Float32Array([40, 45, 50, 55]),
      },
    }))).toBe('cloud_layers')
  })

  it('packs low medium and high cloud layers into RGBA texture data', () => {
    const data = createCloudLayerTextureData({
      low: new Float32Array([0, Number.NaN, 100, Number.NaN]),
      medium: new Float32Array([10, 55, Number.NaN, Number.NaN]),
      high: new Float32Array([15, 45, 65, Number.NaN]),
    }, 4)

    expect(Array.from(data)).toEqual([
      0, 10, 15, 1,
      0, 55, 45, 1,
      100, 0, 65, 1,
      0, 0, 0, 0,
    ])
  })

  it('uses lower-bound threshold colors for banded colormap LUTs', () => {
    const lut = buildColormapLut([
      [0, 0, 0, 0],
      [50, 200, 0, 0],
      [100, 255, 255, 255],
    ], [0, 100], 6, 'banded')

    expect(getLutRgb(lut, 2)).toEqual([0, 0, 0])
    expect(getLutRgb(lut, 3)).toEqual([200, 0, 0])
  })
})
