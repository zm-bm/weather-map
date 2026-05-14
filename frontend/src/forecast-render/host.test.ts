import { describe, expect, it } from 'vitest'

import { FORECAST_LAYER_BEFORE_ID } from './types'
import { installForecastRenderers } from './host'

describe('installForecastRenderers', () => {
  it('installs field renderer first, then particles', () => {
    const operations: Array<{ kind: 'layer', id: string, beforeId?: string }> = []
    const layers = new Set<string>()
    const map = {
      getLayer(id: string) {
        return layers.has(id) ? { id } : undefined
      },
      addLayer(layer: { id: string }, beforeId?: string) {
        layers.add(layer.id)
        operations.push({ kind: 'layer', id: layer.id, beforeId })
      },
    }

    installForecastRenderers(map as never)

    expect(operations).toEqual([
      { kind: 'layer', id: 'field-renderer-layer-id', beforeId: FORECAST_LAYER_BEFORE_ID },
      { kind: 'layer', id: 'particle-renderer-layer-id', beforeId: FORECAST_LAYER_BEFORE_ID },
    ])
  })
})
