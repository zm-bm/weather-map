import { describe, expect, it } from 'vitest'

import { FORECAST_LAYER_BEFORE_ID } from './types'
import { installForecastLayers } from './host'

describe('installForecastLayers', () => {
  it('installs scalar first, then vector', () => {
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

    installForecastLayers(map as never)

    expect(operations).toEqual([
      { kind: 'layer', id: 'scalar-layer-id', beforeId: FORECAST_LAYER_BEFORE_ID },
      { kind: 'layer', id: 'vector-layer-id', beforeId: FORECAST_LAYER_BEFORE_ID },
    ])
  })
})
