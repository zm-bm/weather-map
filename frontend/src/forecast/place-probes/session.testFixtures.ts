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
  setBounds: (west: number, east: number, south: number, north: number) => void
  setCanvasSize: (width: number, height: number) => void
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
  let bounds = {
    west: -180,
    east: 180,
    south: -85,
    north: 85,
  }
  const canvas = {
    clientWidth: 1024,
    clientHeight: 768,
    style: { cursor: '' },
  }
  let probeSource: {
    setData: ReturnType<typeof vi.fn>
  } | null = null

  const map = {
    addLayer: vi.fn((layer: { id: string }) => {
      layers.add(layer.id)
    }),
    addSource: vi.fn((sourceId: string) => {
      if (sourceId === placeProbeLayerIds.source) {
        probeSource = {
          setData: vi.fn(),
        }
        sources.set(sourceId, probeSource)
      }
    }),
    getBounds: vi.fn(() => ({
      contains: vi.fn(([lon, lat]: [number, number]) => (
        lon >= bounds.west &&
        lon <= bounds.east &&
        lat >= bounds.south &&
        lat <= bounds.north
      )),
      getWest: vi.fn(() => bounds.west),
      getEast: vi.fn(() => bounds.east),
      getSouth: vi.fn(() => bounds.south),
      getNorth: vi.fn(() => bounds.north),
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
      const key = mapEventKey(eventName, layerOrHandler)
      const handler = mapEventHandler(layerOrHandler, maybeHandler)
      let eventHandlers = handlers.get(key)
      if (!eventHandlers) {
        eventHandlers = new Set<MapEventHandler>()
        handlers.set(key, eventHandlers)
      }
      eventHandlers.add(handler)
    }),
    off: vi.fn((eventName: MapEventName, layerOrHandler: string | MapEventHandler, maybeHandler?: MapEventHandler) => {
      const key = mapEventKey(eventName, layerOrHandler)
      handlers.get(key)?.delete(mapEventHandler(layerOrHandler, maybeHandler))
    }),
    emit(eventName: MapEventName) {
      handlers.get(eventName)?.forEach((handler) => handler())
    },
    setBounds(west: number, east: number, south: number, north: number) {
      bounds = { west, east, south, north }
    },
    setSourceFeatures(features: MapGeoJSONFeature[]) {
      sourceFeatures = features
    },
    setCanvasSize(width: number, height: number) {
      canvas.clientWidth = width
      canvas.clientHeight = height
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
    | { features: Array<{ properties: { labelText: string; sortKey: number } }> }
    | undefined
}

function mapEventKey(eventName: MapEventName, layerOrHandler: string | MapEventHandler): string {
  return typeof layerOrHandler === 'string'
    ? `${eventName}:${layerOrHandler}`
    : eventName
}

function mapEventHandler(
  layerOrHandler: string | MapEventHandler,
  maybeHandler?: MapEventHandler,
): MapEventHandler {
  return typeof layerOrHandler === 'string'
    ? maybeHandler!
    : layerOrHandler
}
