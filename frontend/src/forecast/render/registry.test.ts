import { describe, expect, it } from 'vitest'
import type { Map as MapLibreMap } from 'maplibre-gl'

import { createRenderSettingsFixture } from '@/test/fixtures'
import {
  type ForecastRenderProfile,
} from './profile'
import { reconcileProfile } from './registry'
import { FORECAST_LAYER_BEFORE_ID } from './maplibre/customLayer'

const DEFAULT_RENDER_SETTINGS = createRenderSettingsFixture()
const DEFAULT_RENDER_PROFILE = {
  layerIds: ['raster', 'overlay', 'particles'],
} as const satisfies ForecastRenderProfile

describe('reconcileProfile', () => {
  it('installs requested profile renderers in deterministic order', () => {
    const { map, operations } = createLayerMap([FORECAST_LAYER_BEFORE_ID])

    reconcileProfile(map, DEFAULT_RENDER_PROFILE, DEFAULT_RENDER_SETTINGS)

    expect(operations).toEqual([
      { kind: 'layer', id: 'forecast-raster-layer', beforeId: FORECAST_LAYER_BEFORE_ID },
      { kind: 'layer', id: 'forecast-overlay-layer', beforeId: FORECAST_LAYER_BEFORE_ID },
      { kind: 'layer', id: 'forecast-particles-layer', beforeId: FORECAST_LAYER_BEFORE_ID },
    ])
  })

  it('removes renderers that are omitted by a new profile', () => {
    const { map, operations } = createLayerMap([
      'forecast-raster-layer',
      'forecast-overlay-layer',
      'forecast-contour-layer',
      'forecast-particles-layer',
    ])
    const noOverlayProfile = {
      layerIds: ['raster', 'overlay'],
    } as const satisfies ForecastRenderProfile

    reconcileProfile(map, noOverlayProfile, DEFAULT_RENDER_SETTINGS)

    expect(operations).toEqual([
      { kind: 'remove-layer', id: 'forecast-particles-layer' },
      { kind: 'remove-layer', id: 'forecast-contour-layer' },
    ])
  })

  it('ignores duplicate renderer ids in a profile', () => {
    const { map, operations } = createLayerMap([FORECAST_LAYER_BEFORE_ID])
    const duplicateProfile = {
      layerIds: ['raster', 'raster'],
    } as const satisfies ForecastRenderProfile

    reconcileProfile(map, duplicateProfile, DEFAULT_RENDER_SETTINGS)

    expect(operations).toEqual([
      { kind: 'layer', id: 'forecast-raster-layer', beforeId: FORECAST_LAYER_BEFORE_ID },
    ])
  })

  it('falls back to top insertion when the forecast overlay anchor is missing', () => {
    const { map, operations } = createLayerMap()
    const rasterProfile = {
      layerIds: ['raster'],
    } as const satisfies ForecastRenderProfile

    reconcileProfile(map, rasterProfile, DEFAULT_RENDER_SETTINGS)

    expect(operations).toEqual([
      { kind: 'layer', id: 'forecast-raster-layer', beforeId: undefined },
    ])
  })
})

function createLayerMap(initialLayers: readonly string[] = []) {
  const operations: Array<
    | { kind: 'layer', id: string, beforeId?: string }
    | { kind: 'remove-layer', id: string }
  > = []
  const layers = new Set<string>(initialLayers)
  const map = {
    getLayer(id: string) {
      return layers.has(id) ? { id } : undefined
    },
    addLayer(layer: { id: string }, beforeId?: string) {
      layers.add(layer.id)
      operations.push({ kind: 'layer', id: layer.id, beforeId })
    },
    getSource() {
      return undefined
    },
    addSource() {
      return undefined
    },
    removeSource() {
      return undefined
    },
    removeLayer(id: string) {
      layers.delete(id)
      operations.push({ kind: 'remove-layer', id })
    },
  }

  return { map: map as unknown as MapLibreMap, operations }
}
