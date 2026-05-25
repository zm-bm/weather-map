import { describe, expect, it } from 'vitest'

import {
  buildFieldColormapLut,
  buildColormapLut,
  createColormapKey,
} from './colormap'
import { createFieldTimeSliceFixture } from '@/test/fixtures'

function getLutRgb(lut: Uint8Array, index: number): [number, number, number] {
  const offset = index * 4
  return [lut[offset], lut[offset + 1], lut[offset + 2]]
}

function getLutAlpha(lut: Uint8Array, index: number): number {
  return lut[index * 4 + 3]
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
    const frame = createFieldTimeSliceFixture()
    const lut = buildFieldColormapLut(frame, 4, 'banded')

    expect(createColormapKey(frame)).toContain('temperature.air.c.v1')
    expect(lut.length).toBe(16)
  })

  it('preserves explicit alpha stops and keeps RGB stops opaque', () => {
    const lut = buildColormapLut([
      [0, 0, 0, 0, 0],
      [1, 255, 255, 255, 128],
      [2, 255, 0, 0],
    ], [0, 2], 3, 'banded')

    expect(getLutAlpha(lut, 0)).toBe(0)
    expect(getLutAlpha(lut, 1)).toBe(128)
    expect(getLutAlpha(lut, 2)).toBe(255)
  })

  it('makes exact zero snow depth transparent and positive snow visible', () => {
    const frame = createFieldTimeSliceFixture({
      paletteId: 'snow.depth.m.v1',
      displayRange: [0, 3],
    })
    const lut = buildFieldColormapLut(frame, 2048, 'banded')

    expect(getLutAlpha(lut, 0)).toBe(0)
    expect(getLutAlpha(lut, 9)).toBe(255)
  })
})
