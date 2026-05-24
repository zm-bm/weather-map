import type { Map as MapLibreMap, MapGeoJSONFeature } from 'maplibre-gl'
import { vi } from 'vitest'

import { placeProbeLayerIds } from './layer'

export type MapEventName =
  | 'idle'
  | 'load'
  | 'mousemove'
  | 'mouseleave'
  | 'moveend'
  | 'resize'
  | 'styledata'

type MapEventHandler = (...args: unknown[]) => void

export type ProbeablePlacesMap = MapLibreMap & {
  emit: (eventName: MapEventName) => void
  setSourceFeatures: (features: MapGeoJSONFeature[]) => void
  setZoom: (zoom: number) => void
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  addLayer: ReturnType<typeof vi.fn>
  addSource: ReturnType<typeof vi.fn>
  getBounds: ReturnType<typeof vi.fn>
  getLayer: ReturnType<typeof vi.fn>
  getSource: ReturnType<typeof vi.fn>
  getZoom: ReturnType<typeof vi.fn>
  querySourceFeatures: ReturnType<typeof vi.fn>
  removeLayer: ReturnType<typeof vi.fn>
  removeSource: ReturnType<typeof vi.fn>
  getCanvas: ReturnType<typeof vi.fn>
  setFeatureState: ReturnType<typeof vi.fn>
  probeSource: {
    setData: ReturnType<typeof vi.fn>
    updateData: ReturnType<typeof vi.fn>
  } | null
}

export function createPlaceFeature(
  name: string,
  lon: number,
  lat: number,
  options: {
    capital?: 'yes'
    nameEn?: string
    population?: number
    populationRank?: number
  } = {}
): MapGeoJSONFeature {
  return {
    id: name,
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [lon, lat],
    },
    properties: {
      name,
      'name:en': options.nameEn,
      kind: 'locality',
      capital: options.capital,
      population: options.population,
      population_rank: options.populationRank,
    },
  } as unknown as MapGeoJSONFeature
}

export function createProbeablePlacesMap(): ProbeablePlacesMap {
  const handlers = new Map<string, Set<MapEventHandler>>()
  const sources = new Map<string, unknown>()
  const layers = new Set<string>()
  let sourceFeatures: MapGeoJSONFeature[] = []
  let zoom = 4
  const canvas = { style: { cursor: '' } }
  let probeSource: {
    setData: ReturnType<typeof vi.fn>
    updateData: ReturnType<typeof vi.fn>
  } | null = null

  const map = {
    addLayer: vi.fn((layer: { id: string }) => {
      layers.add(layer.id)
    }),
    addSource: vi.fn((sourceId: string) => {
      if (sourceId === placeProbeLayerIds.source) {
        probeSource = {
          setData: vi.fn(),
          updateData: vi.fn(),
        }
        sources.set(sourceId, probeSource)
      }
    }),
    getBounds: vi.fn(() => ({
      contains: vi.fn(() => true),
    })),
    getLayer: vi.fn((layerId: string) => (
      layers.has(layerId) ? { id: layerId } : undefined
    )),
    getSource: vi.fn((sourceId: string) => sources.get(sourceId)),
    getZoom: vi.fn(() => zoom),
    getCanvas: vi.fn(() => canvas),
    querySourceFeatures: vi.fn(() => sourceFeatures),
    removeLayer: vi.fn((layerId: string) => {
      layers.delete(layerId)
    }),
    removeSource: vi.fn((sourceId: string) => {
      sources.delete(sourceId)
      if (sourceId === placeProbeLayerIds.source) probeSource = null
    }),
    setFeatureState: vi.fn(),
    on: vi.fn((eventName: MapEventName, layerOrHandler: string | MapEventHandler, maybeHandler?: MapEventHandler) => {
      const key = getMapEventKey(eventName, layerOrHandler)
      const handler = getMapEventHandler(layerOrHandler, maybeHandler)
      let eventHandlers = handlers.get(key)
      if (!eventHandlers) {
        eventHandlers = new Set<MapEventHandler>()
        handlers.set(key, eventHandlers)
      }
      eventHandlers.add(handler)
    }),
    off: vi.fn((eventName: MapEventName, layerOrHandler: string | MapEventHandler, maybeHandler?: MapEventHandler) => {
      const key = getMapEventKey(eventName, layerOrHandler)
      handlers.get(key)?.delete(getMapEventHandler(layerOrHandler, maybeHandler))
    }),
    emit(eventName: MapEventName) {
      handlers.get(eventName)?.forEach((handler) => handler())
    },
    setSourceFeatures(features: MapGeoJSONFeature[]) {
      sourceFeatures = features
    },
    setZoom(nextZoom: number) {
      zoom = nextZoom
    },
    get probeSource() {
      return probeSource
    },
  }

  return map as ProbeablePlacesMap
}

export function getLastProbeCollection(map: ProbeablePlacesMap) {
  return map.probeSource?.setData.mock.lastCall?.[0] as
    | { features: Array<{ properties: { name: string; localName: string; probeText: string; sortKey: number } }> }
    | undefined
}

export function getLastProbeTextDiff(map: ProbeablePlacesMap) {
  return map.probeSource?.updateData.mock.lastCall?.[0] as
    | {
      add?: Array<{ properties: { name: string; probeText: string; sortKey: number } }>
      remove?: string[]
      update?: Array<{ id: string; addOrUpdateProperties: Array<{ key: string; value: string }> }>
    }
    | undefined
}

function getMapEventKey(eventName: MapEventName, layerOrHandler: string | MapEventHandler): string {
  return typeof layerOrHandler === 'string'
    ? `${eventName}:${layerOrHandler}`
    : eventName
}

function getMapEventHandler(
  layerOrHandler: string | MapEventHandler,
  maybeHandler?: MapEventHandler,
): MapEventHandler {
  return typeof layerOrHandler === 'string'
    ? maybeHandler!
    : layerOrHandler
}
