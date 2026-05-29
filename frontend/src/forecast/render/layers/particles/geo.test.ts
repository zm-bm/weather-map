import { describe, expect, it } from 'vitest'
import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  computeViewportState,
  expandViewportBounds,
  hasCameraChanged,
  toCellCenterOrigin,
  type CameraState,
} from './geo'

describe('particle geo helpers', () => {
  it('unwraps antimeridian-crossing viewport bounds', () => {
    const viewport = computeViewportState(createBoundsMap({
      west: 170,
      east: -170,
      south: -20,
      north: 20,
    }))

    expect(viewport.west).toBe(170)
    expect(viewport.east).toBe(190)
    expect(viewport.south).toBe(-20)
    expect(viewport.north).toBe(20)
  })

  it('shifts cell-edge grid origins to cell centers', () => {
    expect(toCellCenterOrigin(0, 0, 0.25, -0.25)).toEqual({
      lon0: 0,
      lat0: 0,
    })
    expect(toCellCenterOrigin(0.125, -0.125, 0.25, -0.25)).toEqual({
      lon0: 0.25,
      lat0: -0.25,
    })
  })

  it('expands particle simulation bounds by a viewport-relative padding ratio', () => {
    expect(expandViewportBounds({
      west: -100,
      east: -80,
      south: 30,
      north: 40,
    }, 0.15)).toEqual({
      west: -103,
      east: -77,
      south: 28.5,
      north: 41.5,
    })
  })

  it('clamps particle simulation latitude padding to the WebMercator domain', () => {
    const expanded = expandViewportBounds({
      west: -180,
      east: 180,
      south: -84,
      north: 84,
    }, 0.5)

    expect(expanded?.south).toBeCloseTo(-85.05112878)
    expect(expanded?.north).toBeCloseTo(85.05112878)
  })

  it('detects meaningful camera changes', () => {
    const camera: CameraState = {
      centerLng: -97,
      centerLat: 35,
      zoom: 6,
      bearing: 0,
      pitch: 0,
      width: 800,
      height: 600,
    }

    expect(hasCameraChanged(camera, { ...camera, centerLng: -97 + 1e-8 })).toBe(false)
    expect(hasCameraChanged(camera, { ...camera, zoom: 6.1 })).toBe(true)
  })
})

function createBoundsMap(bounds: {
  west: number
  east: number
  south: number
  north: number
}): MapLibreMap {
  return {
    getBounds() {
      return {
        getWest: () => bounds.west,
        getEast: () => bounds.east,
        getSouth: () => bounds.south,
        getNorth: () => bounds.north,
      }
    },
  } as unknown as MapLibreMap
}
