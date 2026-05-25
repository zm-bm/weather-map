import type { RefObject } from 'react'
import type { IControl, Map as MapLibreMap } from 'maplibre-gl'
import { vi } from 'vitest'

export type ControllableMapFixture = MapLibreMap & {
  addControl: ReturnType<typeof vi.fn>
  getMaxZoom: ReturnType<typeof vi.fn>
  getMinZoom: ReturnType<typeof vi.fn>
  getZoom: ReturnType<typeof vi.fn>
  hasControl: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  removeControl: ReturnType<typeof vi.fn>
  zoomIn: ReturnType<typeof vi.fn>
  zoomOut: ReturnType<typeof vi.fn>
}

export function createMapFixture(): ControllableMapFixture {
  const controls = new Set<IControl>()
  let zoom = 3
  const minZoom = 2
  const maxZoom = 6.99
  const listeners = new Map<string, Set<() => void>>()

  const emit = (eventName: string) => {
    listeners.get(eventName)?.forEach((listener) => {
      listener()
    })
  }

  return {
    addControl: vi.fn((control: IControl) => {
      controls.add(control)
      return undefined
    }),
    getMaxZoom: vi.fn(() => maxZoom),
    getMinZoom: vi.fn(() => minZoom),
    getZoom: vi.fn(() => zoom),
    hasControl: vi.fn((control: IControl) => controls.has(control)),
    off: vi.fn((eventName: string, listener: () => void) => {
      listeners.get(eventName)?.delete(listener)
      return undefined
    }),
    on: vi.fn((eventName: string, listener: () => void) => {
      let eventListeners = listeners.get(eventName)
      if (!eventListeners) {
        eventListeners = new Set()
        listeners.set(eventName, eventListeners)
      }
      eventListeners.add(listener)
      return undefined
    }),
    removeControl: vi.fn((control: IControl) => {
      controls.delete(control)
      return undefined
    }),
    zoomIn: vi.fn(() => {
      zoom = Math.min(maxZoom, zoom + 1)
      emit('zoom')
      emit('zoomend')
      return undefined
    }),
    zoomOut: vi.fn(() => {
      zoom = Math.max(minZoom, zoom - 1)
      emit('zoom')
      emit('zoomend')
      return undefined
    }),
  } as unknown as ControllableMapFixture
}

export function createMapRefFixture(
  map: unknown = {}
): RefObject<MapLibreMap | null> {
  return {
    current: map == null ? null : map as MapLibreMap,
  }
}

export type BasemapThemeMapFixture = MapLibreMap & {
  addLayer: ReturnType<typeof vi.fn>
  getLayer: ReturnType<typeof vi.fn>
  getSource: ReturnType<typeof vi.fn>
  getStyle: ReturnType<typeof vi.fn>
  moveLayer: ReturnType<typeof vi.fn>
  removeLayer: ReturnType<typeof vi.fn>
  setPaintProperty: ReturnType<typeof vi.fn>
}

export function createBasemapThemeMapFixture(
  layerIds: readonly string[] = [
    'background',
    'water',
    'coastline',
    'boundary_2',
  ]
): BasemapThemeMapFixture {
  const layers = [...layerIds]

  const hasLayer = (layerId: string) => layers.includes(layerId)
  const removeLayerId = (layerId: string) => {
    const layerIndex = layers.indexOf(layerId)
    if (layerIndex >= 0) layers.splice(layerIndex, 1)
  }
  const insertLayerId = (layerId: string, beforeId?: string) => {
    removeLayerId(layerId)
    const beforeIndex = beforeId ? layers.indexOf(beforeId) : -1
    if (beforeIndex >= 0) {
      layers.splice(beforeIndex, 0, layerId)
      return
    }
    layers.push(layerId)
  }

  return {
    addLayer: vi.fn((layer: { id: string }, beforeId?: string) => {
      insertLayerId(layer.id, beforeId)
      return undefined
    }),
    getLayer: vi.fn((layerId: string) => (
      hasLayer(layerId) ? { id: layerId } : undefined
    )),
    getSource: vi.fn((sourceId: string) => (
      sourceId === 'basemap' ? { id: sourceId } : undefined
    )),
    getStyle: vi.fn(() => ({
      layers: layers.map((id) => ({ id })),
    })),
    moveLayer: vi.fn((layerId: string, beforeId?: string) => {
      insertLayerId(layerId, beforeId)
      return undefined
    }),
    removeLayer: vi.fn((layerId: string) => {
      removeLayerId(layerId)
      return undefined
    }),
    setPaintProperty: vi.fn(),
  } as unknown as BasemapThemeMapFixture
}
