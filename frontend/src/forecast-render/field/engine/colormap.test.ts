import { describe, expect, it } from 'vitest'

import {
  buildColormapLut,
} from './colormap'

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
})
