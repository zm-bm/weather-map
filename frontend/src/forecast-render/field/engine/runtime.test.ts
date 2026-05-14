import { describe, expect, it } from 'vitest'

import {
  buildClassifierRowMapping,
  buildColormapAtlasLut,
  buildColormapLut,
} from './runtime'

function getLutRgb(lut: Uint8Array, index: number): [number, number, number] {
  const offset = index * 4
  return [lut[offset], lut[offset + 1], lut[offset + 2]]
}

function getAtlasRgb(lut: Uint8Array, width: number, row: number, index: number): [number, number, number] {
  return getLutRgb(lut, row * width + index)
}

describe('field runtime helpers', () => {
  it('uses lower-bound threshold colors for banded colormap LUTs', () => {
    const lut = buildColormapLut([
      [0, 0, 0, 0],
      [50, 200, 0, 0],
      [100, 255, 255, 255],
    ], [0, 100], 6, 'banded')

    expect(getLutRgb(lut, 2)).toEqual([0, 0, 0])
    expect(getLutRgb(lut, 3)).toEqual([200, 0, 0])
  })

  it('builds colormap atlas rows in default then classified order', () => {
    const lut = buildColormapAtlasLut([
      [
        [0, 0, 0, 0],
        [100, 255, 255, 255],
      ],
      [
        [0, 10, 20, 30],
        [100, 40, 50, 60],
      ],
    ], [0, 100], 4, 'banded')

    expect(getAtlasRgb(lut, 4, 0, 0)).toEqual([0, 0, 0])
    expect(getAtlasRgb(lut, 4, 1, 0)).toEqual([10, 20, 30])
  })

  it('maps classifier values to atlas rows with fallback row zero left implicit', () => {
    const mapping = buildClassifierRowMapping({
      classifierOverlayId: 'precip-type',
      classes: [
        { values: [1], colortable: [] },
        { values: [4], colortable: [] },
        { values: [2, 3, 5], colortable: [] },
      ],
    })

    expect(mapping.count).toBe(5)
    expect(Array.from(mapping.values.slice(0, mapping.count))).toEqual([1, 4, 2, 3, 5])
    expect(Array.from(mapping.rows.slice(0, mapping.count))).toEqual([1, 2, 3, 3, 3])
  })
})
