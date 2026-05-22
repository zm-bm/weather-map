import { describe, expect, it } from 'vitest'

import {
  DEFAULT_FIELD_RENDER_SETTINGS,
  DEFAULT_PARTICLE_RENDER_SETTINGS,
} from '../forecast-settings/settings'
import {
  type ForecastRenderProfile,
} from './types'
import { reconcileForecastRenderers } from './host'
import { FORECAST_LAYER_BEFORE_ID } from './placement'

const DEFAULT_RENDER_SETTINGS = {
  field: DEFAULT_FIELD_RENDER_SETTINGS,
  particles: DEFAULT_PARTICLE_RENDER_SETTINGS,
}
const DEFAULT_RENDER_PROFILE = {
  rendererIds: ['field', 'cloud-layers', 'field-overlay', 'particles'],
} as const satisfies ForecastRenderProfile

describe('reconcileForecastRenderers', () => {
  it('installs requested profile renderers in deterministic order', () => {
    const { map, operations } = createLayerMap([FORECAST_LAYER_BEFORE_ID])

    reconcileForecastRenderers(map as never, DEFAULT_RENDER_PROFILE, DEFAULT_RENDER_SETTINGS)

    expect(operations).toEqual([
      { kind: 'layer', id: 'field-renderer-layer-id', beforeId: FORECAST_LAYER_BEFORE_ID },
      { kind: 'layer', id: 'cloud-layers-renderer-layer-id', beforeId: FORECAST_LAYER_BEFORE_ID },
      { kind: 'layer', id: 'field-overlay-renderer-layer-id', beforeId: FORECAST_LAYER_BEFORE_ID },
      { kind: 'layer', id: 'particle-renderer-layer-id', beforeId: FORECAST_LAYER_BEFORE_ID },
    ])
  })

  it('removes renderers that are omitted by a new profile', () => {
    const { map, operations } = createLayerMap([
      'field-renderer-layer-id',
      'cloud-layers-renderer-layer-id',
      'field-overlay-renderer-layer-id',
      'contour-overlay-renderer-layer-id',
      'particle-renderer-layer-id',
    ])
    const noOverlayProfile = {
      rendererIds: ['field', 'cloud-layers', 'field-overlay'],
    } as const satisfies ForecastRenderProfile

    reconcileForecastRenderers(map as never, noOverlayProfile, DEFAULT_RENDER_SETTINGS)

    expect(operations).toEqual([
      { kind: 'remove-layer', id: 'particle-renderer-layer-id' },
      { kind: 'remove-layer', id: 'contour-overlay-renderer-layer-id' },
    ])
  })

  it('ignores duplicate renderer ids in a profile', () => {
    const { map, operations } = createLayerMap([FORECAST_LAYER_BEFORE_ID])
    const duplicateProfile = {
      rendererIds: ['field', 'cloud-layers', 'field'],
    } as const satisfies ForecastRenderProfile

    reconcileForecastRenderers(map as never, duplicateProfile, DEFAULT_RENDER_SETTINGS)

    expect(operations).toEqual([
      { kind: 'layer', id: 'field-renderer-layer-id', beforeId: FORECAST_LAYER_BEFORE_ID },
      { kind: 'layer', id: 'cloud-layers-renderer-layer-id', beforeId: FORECAST_LAYER_BEFORE_ID },
    ])
  })

  it('falls back to top insertion when the forecast overlay anchor is missing', () => {
    const { map, operations } = createLayerMap()
    const fieldProfile = {
      rendererIds: ['field'],
    } as const satisfies ForecastRenderProfile

    reconcileForecastRenderers(map as never, fieldProfile, DEFAULT_RENDER_SETTINGS)

    expect(operations).toEqual([
      { kind: 'layer', id: 'field-renderer-layer-id', beforeId: undefined },
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

  return { map, operations }
}
