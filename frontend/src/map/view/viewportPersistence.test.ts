import type { Map as MapLibreMap } from 'maplibre-gl'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  loadStoredViewport,
  saveStoredViewport,
} from './viewportPersistence'

const VIEWPORT_STORAGE_KEY = 'weather-map:viewport'

describe('viewportPersistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('loads valid stored viewport data', () => {
    localStorage.setItem(VIEWPORT_STORAGE_KEY, JSON.stringify({
      center: [-95.1, 39.2],
      zoom: 4.5,
    }))

    expect(loadStoredViewport()).toEqual({
      center: [-95.1, 39.2],
      zoom: 4.5,
    })
  })

  it('ignores invalid stored viewport data', () => {
    localStorage.setItem(VIEWPORT_STORAGE_KEY, JSON.stringify({
      center: [-95.1],
      zoom: '4.5',
    }))

    expect(loadStoredViewport()).toBeNull()
  })

  it('saves rounded map viewport data', () => {
    saveStoredViewport({
      getCenter: () => ({
        lng: -95.123456,
        lat: 39.987654,
      }),
      getZoom: () => 4.567,
    } as unknown as MapLibreMap)

    expect(JSON.parse(localStorage.getItem(VIEWPORT_STORAGE_KEY) ?? '')).toEqual({
      center: [-95.12346, 39.98765],
      zoom: 4.57,
    })
  })
})
