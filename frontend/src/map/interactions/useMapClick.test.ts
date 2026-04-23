import { act, renderHook } from '@testing-library/react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import MapProbeProvider from '../../map-probe/MapProbeProvider'
import { useMapProbe } from '../../map-probe/context'
import { useMapClick } from './useMapClick'
import { PLACE_LABEL_LAYER_IDS } from './placeLayers'

type ClickEvent = {
  lngLat: { lng: number; lat: number }
  point: { x: number; y: number }
}

type EventHandler = (event: ClickEvent) => void

type ClickableMap = MapLibreMap & {
  emit: (name: string, event: ClickEvent) => void
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  queryRenderedFeatures: ReturnType<typeof vi.fn>
  setPlaceFeatures: (features: unknown[]) => void
}

function createClickableMap(): ClickableMap {
  const handlers = new Map<string, Set<EventHandler>>()
  let placeFeatures: unknown[] = []

  const map = {
    on: vi.fn((name: string, handler: EventHandler) => {
      let entry = handlers.get(name)
      if (!entry) {
        entry = new Set<EventHandler>()
        handlers.set(name, entry)
      }
      entry.add(handler)
    }),
    off: vi.fn((name: string, handler: EventHandler) => {
      handlers.get(name)?.delete(handler)
    }),
    queryRenderedFeatures: vi.fn((_point: { x: number; y: number }, options?: { layers?: string[] }) => {
      if (!options?.layers?.every((layerId) => PLACE_LABEL_LAYER_IDS.includes(layerId as typeof PLACE_LABEL_LAYER_IDS[number]))) {
        return []
      }
      return placeFeatures
    }),
    emit(name: string, event: ClickEvent) {
      handlers.get(name)?.forEach((handler) => handler(event))
    },
    setPlaceFeatures(features: unknown[]) {
      placeFeatures = features
    },
  }

  return map as ClickableMap
}

function Wrapper({ children }: { children: ReactNode }) {
  return createElement(MapProbeProvider, null, children)
}

describe('useMapClick', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stores the clicked coordinate', () => {
    const map = createClickableMap()

    const { result, unmount } = renderHook(() => {
      useMapClick({ current: map })
      return useMapProbe()
    }, { wrapper: Wrapper })

    act(() => {
      map.emit('click', {
        lngLat: { lng: 0.5, lat: 0.5 },
        point: { x: 10, y: 10 },
      })
    })

    expect(result.current.lastProbe).toEqual({
      lon: 0.5,
      lat: 0.5,
    })

    unmount()

    expect(map.on).toHaveBeenCalledWith('click', expect.any(Function))
    expect(map.off).toHaveBeenCalledWith('click', expect.any(Function))
  })

  it('uses the clicked place feature coordinates when a place label is clicked', () => {
    const map = createClickableMap()
    map.setPlaceFeatures([
      {
        geometry: {
          type: 'Point',
          coordinates: [1, 0],
        },
      },
    ])

    const { result } = renderHook(() => {
      useMapClick({ current: map })
      return useMapProbe()
    }, { wrapper: Wrapper })

    act(() => {
      map.emit('click', {
        lngLat: { lng: 0.1, lat: 0.1 },
        point: { x: 12, y: 34 },
      })
    })

    expect(result.current.lastProbe).toEqual({
      lon: 1,
      lat: 0,
    })

    expect(map.queryRenderedFeatures).toHaveBeenCalledWith(
      { x: 12, y: 34 },
      { layers: [...PLACE_LABEL_LAYER_IDS] },
    )
  })
})
