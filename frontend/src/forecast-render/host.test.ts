import { describe, expect, it } from 'vitest'

import {
  DEFAULT_FORECAST_RENDER_PROFILE,
  FORECAST_LAYER_BEFORE_ID,
  type ForecastRenderProfile,
} from './types'
import { reconcileForecastRenderers } from './host'

describe('reconcileForecastRenderers', () => {
  it('installs default profile renderers in deterministic order', () => {
    const { map, operations } = createLayerMap()

    reconcileForecastRenderers(map as never, DEFAULT_FORECAST_RENDER_PROFILE)

    expect(operations).toEqual([
      { kind: 'layer', id: 'field-renderer-layer-id', beforeId: FORECAST_LAYER_BEFORE_ID },
      { kind: 'layer', id: 'field-overlay-renderer-layer-id', beforeId: FORECAST_LAYER_BEFORE_ID },
      { kind: 'layer', id: 'particle-renderer-layer-id', beforeId: FORECAST_LAYER_BEFORE_ID },
    ])
  })

  it('removes renderers that are omitted by a new profile', () => {
    const { map, operations } = createLayerMap([
      'field-renderer-layer-id',
      'field-overlay-renderer-layer-id',
      'particle-renderer-layer-id',
    ])
    const fieldOnlyProfile = {
      key: 'field-only',
      rendererIds: ['field', 'field-overlay'],
    } as const satisfies ForecastRenderProfile

    reconcileForecastRenderers(map as never, fieldOnlyProfile)

    expect(operations).toEqual([
      { kind: 'remove-layer', id: 'particle-renderer-layer-id' },
    ])
  })

  it('ignores duplicate renderer ids in a profile', () => {
    const { map, operations } = createLayerMap()
    const duplicateProfile = {
      key: 'duplicate-field',
      rendererIds: ['field', 'field'],
    } as const satisfies ForecastRenderProfile

    reconcileForecastRenderers(map as never, duplicateProfile)

    expect(operations).toEqual([
      { kind: 'layer', id: 'field-renderer-layer-id', beforeId: FORECAST_LAYER_BEFORE_ID },
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
    removeLayer(id: string) {
      layers.delete(id)
      operations.push({ kind: 'remove-layer', id })
    },
  }

  return { map, operations }
}
