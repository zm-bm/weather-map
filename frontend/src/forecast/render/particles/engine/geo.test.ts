import { describe, expect, it } from 'vitest'
import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  computeViewportState,
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
