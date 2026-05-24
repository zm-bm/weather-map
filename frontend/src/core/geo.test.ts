import { describe, expect, it } from 'vitest'

import {
  MAP_TILE_SIZE_PX,
  WEB_MERCATOR_MAX_LAT,
  clampWebMercatorLat,
  latToMercatorY,
  lonToMercatorX,
  worldSizeAtZoom,
  worldWrapForLng,
} from './geo'

describe('geo helpers', () => {
  it('clamps latitude to the WebMercator domain', () => {
    expect(clampWebMercatorLat(0)).toBe(0)
    expect(clampWebMercatorLat(90)).toBe(WEB_MERCATOR_MAX_LAT)
    expect(clampWebMercatorLat(-90)).toBe(-WEB_MERCATOR_MAX_LAT)
  })

  it('converts longitude to Mercator X including unwrapped longitudes', () => {
    expect(lonToMercatorX(-180)).toBe(0)
    expect(lonToMercatorX(0)).toBe(0.5)
    expect(lonToMercatorX(180)).toBe(1)
    expect(lonToMercatorX(540)).toBe(2)
  })

  it('converts latitude to Mercator Y with clamped extremes', () => {
    expect(latToMercatorY(0)).toBeCloseTo(0.5)
    expect(latToMercatorY(WEB_MERCATOR_MAX_LAT)).toBeCloseTo(0)
    expect(latToMercatorY(-WEB_MERCATOR_MAX_LAT)).toBeCloseTo(1)
    expect(latToMercatorY(90)).toBeCloseTo(latToMercatorY(WEB_MERCATOR_MAX_LAT))
  })

  it('computes the wrapped world index for map center longitude', () => {
    expect(worldWrapForLng(0)).toBe(0)
    expect(worldWrapForLng(181)).toBe(1)
    expect(worldWrapForLng(-181)).toBe(-1)
    expect(worldWrapForLng(Number.NaN)).toBe(0)
  })

  it('computes world size from zoom with a finite fallback', () => {
    expect(worldSizeAtZoom(0)).toBe(MAP_TILE_SIZE_PX)
    expect(worldSizeAtZoom(2)).toBe(MAP_TILE_SIZE_PX * 4)
    expect(worldSizeAtZoom(Number.NaN)).toBe(MAP_TILE_SIZE_PX)
  })
})
