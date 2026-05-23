import { describe, expect, it } from 'vitest'

import {
  buildFieldColormapLut,
  buildColormapLut,
  createColormapKey,
} from './colormap'
import type { FieldTimeSliceData } from '../../../forecast-data'

function getLutRgb(lut: Uint8Array, index: number): [number, number, number] {
  const offset = index * 4
  return [lut[offset], lut[offset + 1], lut[offset + 2]]
}

describe('field colormap helpers', () => {
  it('uses lower-bound threshold colors for banded colormap LUTs', () => {
    const lut = buildColormapLut([
      [0, 0, 0, 0],
      [50, 200, 0, 0],
      [100, 255, 255, 255],
    ], [0, 100], 6, 'banded')

    expect(getLutRgb(lut, 2)).toEqual([0, 0, 0])
    expect(getLutRgb(lut, 3)).toEqual([200, 0, 0])
  })

  it('resolves field palette stops from the frame palette id', () => {
    const frame = createFieldFrame()
    const lut = buildFieldColormapLut(frame, 4, 'banded')

    expect(createColormapKey(frame)).toContain('temperature.air.c.v1')
    expect(lut.length).toBe(16)
  })
})

function createFieldFrame(): FieldTimeSliceData {
  return {
    hourToken: '000',
    layerId: 'temperature',
    paletteId: 'temperature.air.c.v1',
    grid: {
      id: 'grid',
      crs: 'EPSG:4326',
      nx: 1,
      ny: 1,
      lon0: 0,
      lat0: 0,
      dx: 1,
      dy: 1,
      origin: 'cell_center',
      layout: 'row_major',
      xWrap: 'none',
      yMode: 'clamp',
    },
    encoding: {
      id: 'encoding',
      format: 'linear-i16-v1',
      dtype: 'int16',
      byteOrder: 'little',
      nodata: -32768,
      scale: 1,
      offset: 0,
      decodeFormula: 'value = stored * scale + offset',
    },
    values: new Float32Array([0]),
    displayRange: [-35, 50],
  }
}
