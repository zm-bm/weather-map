import { act } from '@testing-library/react'
import type { Map as MapLibreMap, MapGeoJSONFeature } from 'maplibre-gl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BASEMAP_SOURCE_ID,
  BASEMAP_SOURCE_LAYER_IDS,
} from '../map/basemap'
import {
  createForecastPlaceProbeSession,
  type ForecastPlaceProbeSessionOptions,
} from './session'
import { placeProbeLayerIds } from './layer'
import type { FieldInterpolationWindowData } from '../forecast-data'

type MapEventName = 'idle' | 'load' | 'mousemove' | 'mouseleave' | 'moveend' | 'resize' | 'styledata'
type MapEventHandler = (...args: unknown[]) => void

type ProbeablePlacesMap = MapLibreMap & {
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

const mocks = vi.hoisted(() => {
  const testGrid = {
    nx: 2,
    ny: 2,
    lon0: 0,
    lat0: 1,
    dx: 1,
    dy: -1,
    xWrap: 'repeat',
    yMode: 'clamp',
  }

  return {
    testGrid,
    frame: {
      lower: {
        layerId: 'temperature',
        grid: testGrid,
      },
      upper: {
        layerId: 'temperature',
        grid: testGrid,
      },
      mix: 0,
    } as FieldInterpolationWindowData | null,
    formatProbeValue: vi.fn((rawValue: number | null, loading = false) => ({
      text: loading ? 'Loading' : (rawValue == null ? 'No data' : `${rawValue} F`),
      loading,
      value: rawValue,
    })),
    createFieldProbeSampler: vi.fn(),
    sampleFieldWindowWithSampler: vi.fn(),
  }
})

vi.mock('./fieldSampling', async () => {
  const actual = await vi.importActual<typeof import('./fieldSampling')>('./fieldSampling')

  return {
    ...actual,
    createFieldProbeSampler: mocks.createFieldProbeSampler,
    sampleFieldWindowWithSampler: mocks.sampleFieldWindowWithSampler,
  }
})

function createPlaceFeature(
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

function createProbeablePlacesMap(): ProbeablePlacesMap {
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

function getLastProbeCollection(map: ProbeablePlacesMap) {
  return map.probeSource?.setData.mock.lastCall?.[0] as
    | { features: Array<{ properties: { name: string; localName: string; probeText: string; sortKey: number } }> }
    | undefined
}

function getLastProbeTextDiff(map: ProbeablePlacesMap) {
  return map.probeSource?.updateData.mock.lastCall?.[0] as
    | {
      add?: Array<{ properties: { name: string; probeText: string; sortKey: number } }>
      remove?: string[]
      update?: Array<{ id: string; addOrUpdateProperties: Array<{ key: string; value: string }> }>
    }
    | undefined
}

describe('createForecastPlaceProbeSession', () => {
  let animationFrameCallbacks: FrameRequestCallback[]

  function flushAnimationFrames() {
    const callbacks = animationFrameCallbacks.splice(0)
    for (const callback of callbacks) {
      callback(0)
    }
  }

  beforeEach(() => {
    animationFrameCallbacks = []
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      animationFrameCallbacks.push(callback)
      return animationFrameCallbacks.length
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    mocks.frame = {
      lower: {
        layerId: 'temperature',
        grid: mocks.testGrid,
      },
      upper: {
        layerId: 'temperature',
        grid: mocks.testGrid,
      },
      mix: 0,
    } as FieldInterpolationWindowData
    mocks.formatProbeValue.mockClear()
    mocks.createFieldProbeSampler.mockReset()
    mocks.createFieldProbeSampler.mockImplementation((_frame, place: { id: string }) => ({ id: place.id }))
    mocks.sampleFieldWindowWithSampler.mockReset()
    mocks.sampleFieldWindowWithSampler.mockReturnValue(20)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function startSession(
    map: ProbeablePlacesMap,
    options: Partial<Omit<ForecastPlaceProbeSessionOptions, 'map'>> = {},
  ) {
    const session = createForecastPlaceProbeSession({
      map,
      layerId: 'temperature',
      valueFormatter: mocks.formatProbeValue,
      initialFrame: mocks.frame,
      ...options,
    })
    session.start()
    return session
  }

  it('does not schedule source updates before start', () => {
    const map = createProbeablePlacesMap()
    const session = createForecastPlaceProbeSession({
      map,
      layerId: 'temperature',
      valueFormatter: mocks.formatProbeValue,
      initialFrame: null,
    })

    session.setFrame(mocks.frame)
    session.setLayerId('dew_point')
    session.setValueFormatter(vi.fn())

    expect(window.requestAnimationFrame).not.toHaveBeenCalled()
    expect(map.addSource).not.toHaveBeenCalled()
    expect(map.addLayer).not.toHaveBeenCalled()
  })

  it('adds one GeoJSON source/layer and renders probe text', () => {
    const map = createProbeablePlacesMap()
    map.setSourceFeatures([
      createPlaceFeature('Chicago', -87.625, 41.875, { population: 2_700_000 }),
      createPlaceFeature('Milwaukee', -87.9, 43.04, { population: 570_000 }),
    ])

    startSession(map)
    act(flushAnimationFrames)

    expect(map.addSource).toHaveBeenCalledWith(
      placeProbeLayerIds.source,
      expect.objectContaining({ type: 'geojson' }),
    )
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: placeProbeLayerIds.layer,
      layout: expect.objectContaining({
        'symbol-sort-key': ['get', 'sortKey'],
        'text-justify': 'auto',
        'text-padding': 1,
        'text-radial-offset': 0.5,
        'text-variable-anchor': [
          'center',
          'bottom',
          'top',
          'right',
          'left',
          'bottom-right',
          'bottom-left',
          'top-right',
          'top-left',
        ],
      }),
    }))
    expect(map.querySourceFeatures).toHaveBeenCalledWith(
      BASEMAP_SOURCE_ID,
      { sourceLayer: BASEMAP_SOURCE_LAYER_IDS.places },
    )
    expect(mocks.createFieldProbeSampler).toHaveBeenCalledTimes(2)
    expect(getLastProbeCollection(map)?.features.map((feature) => feature.properties)).toEqual([
      expect.objectContaining({ name: 'Chicago', sortKey: 0, probeText: '20 F' }),
      expect.objectContaining({ name: 'Milwaukee', sortKey: 1, probeText: '20 F' }),
    ])
  })

  it('renders non-latin local names under English display names', () => {
    const map = createProbeablePlacesMap()
    map.setSourceFeatures([
      createPlaceFeature('東京', 139.69, 35.68, {
        nameEn: 'Tokyo',
        population: 14_000_000,
      }),
    ])

    startSession(map)
    act(flushAnimationFrames)

    const addedLayer = map.addLayer.mock.calls[0]?.[0] as
      | { layout?: Record<string, unknown> }
      | undefined

    expect(addedLayer?.layout?.['text-font']).toEqual(['NotoSansMonoCJKjpRegular'])
    expect(JSON.stringify(addedLayer?.layout?.['text-field'])).toContain('localName')
    expect(getLastProbeCollection(map)?.features[0]?.properties).toEqual(
      expect.objectContaining({
        name: 'Tokyo',
        localName: '東京',
        probeText: '20 F',
      }),
    )
  })

  it('updates playback frame values without querying source features or adding DOM nodes', () => {
    const map = createProbeablePlacesMap()
    map.setSourceFeatures([createPlaceFeature('Chicago', -87.625, 41.875, { population: 2_700_000 })])

    const session = startSession(map)
    act(flushAnimationFrames)
    expect(map.querySourceFeatures).toHaveBeenCalledTimes(1)

    mocks.sampleFieldWindowWithSampler.mockReturnValue(25)
    act(() => {
      session.setFrame({
        lower: { layerId: 'temperature', grid: mocks.testGrid },
        upper: { layerId: 'temperature', grid: mocks.testGrid },
        mix: 0.5,
      } as FieldInterpolationWindowData)
    })
    act(flushAnimationFrames)

    expect(map.querySourceFeatures).toHaveBeenCalledTimes(1)
    expect(map.probeSource?.setData).toHaveBeenCalledTimes(1)
    expect(map.probeSource?.updateData).toHaveBeenCalledTimes(1)
    expect(getLastProbeTextDiff(map)?.update?.[0]).toEqual({
      id: 'Chicago:-87.6250:41.8750',
      addOrUpdateProperties: [{ key: 'probeText', value: '25 F' }],
    })
  })

  it('skips playback source updates when displayed values are unchanged', () => {
    const map = createProbeablePlacesMap()
    map.setSourceFeatures([createPlaceFeature('Chicago', -87.625, 41.875, { population: 2_700_000 })])

    const session = startSession(map)
    act(flushAnimationFrames)

    act(() => {
      session.setFrame({
        lower: { layerId: 'temperature', grid: mocks.testGrid },
        upper: { layerId: 'temperature', grid: mocks.testGrid },
        mix: 0.5,
      } as FieldInterpolationWindowData)
    })
    act(flushAnimationFrames)

    expect(map.probeSource?.setData).toHaveBeenCalledTimes(1)
    expect(map.probeSource?.updateData).not.toHaveBeenCalled()
  })

  it('keeps the source/layer installed when the selected layer changes', () => {
    const map = createProbeablePlacesMap()
    map.setSourceFeatures([createPlaceFeature('Chicago', -87.625, 41.875, { population: 2_700_000 })])

    const session = startSession(map)
    act(flushAnimationFrames)

    session.setLayerId('dew_point')
    act(flushAnimationFrames)

    expect(map.addLayer).toHaveBeenCalledTimes(1)
    expect(map.removeLayer).not.toHaveBeenCalled()
    expect(map.removeSource).not.toHaveBeenCalled()
    expect(getLastProbeTextDiff(map)?.update?.[0]).toEqual({
      id: 'Chicago:-87.6250:41.8750',
      addOrUpdateProperties: [{ key: 'probeText', value: 'Loading' }],
    })
  })

  it('refreshes source features after map movement settles', () => {
    const map = createProbeablePlacesMap()
    map.setSourceFeatures([createPlaceFeature('Chicago', -87.625, 41.875, { population: 2_700_000 })])

    startSession(map)
    act(flushAnimationFrames)

    map.setSourceFeatures([createPlaceFeature('Madison', -89.4, 43.07, { population: 270_000 })])
    act(() => {
      map.emit('moveend')
    })
    act(flushAnimationFrames)

    expect(map.querySourceFeatures).toHaveBeenCalledTimes(2)
    expect(mocks.createFieldProbeSampler).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'Madison' })
    )
    expect(getLastProbeTextDiff(map)).toEqual({
      add: [
        expect.objectContaining({
          properties: expect.objectContaining({ name: 'Madison', sortKey: 0, probeText: '20 F' }),
        }),
      ],
      remove: ['Chicago:-87.6250:41.8750'],
    })
  })

  it('keeps current probes during a provisional empty viewport refresh until idle', () => {
    const map = createProbeablePlacesMap()
    map.setSourceFeatures([createPlaceFeature('Chicago', -87.625, 41.875, { population: 2_700_000 })])

    startSession(map)
    act(flushAnimationFrames)

    map.setSourceFeatures([])
    act(() => {
      map.emit('moveend')
    })
    act(flushAnimationFrames)

    expect(map.querySourceFeatures).toHaveBeenCalledTimes(2)
    expect(map.probeSource?.setData).toHaveBeenCalledTimes(1)
    expect(getLastProbeCollection(map)?.features.map((feature) => feature.properties.name)).toEqual(['Chicago'])

    act(() => {
      map.emit('idle')
    })
    act(flushAnimationFrames)

    expect(map.querySourceFeatures).toHaveBeenCalledTimes(3)
    expect(map.probeSource?.setData).toHaveBeenCalledTimes(1)
    expect(getLastProbeTextDiff(map)).toEqual({
      remove: ['Chicago:-87.6250:41.8750'],
    })
  })

  it('keeps current probes during a provisional partial viewport refresh until idle', () => {
    const map = createProbeablePlacesMap()
    map.setSourceFeatures([
      createPlaceFeature('Chicago', -87.625, 41.875, { population: 2_700_000 }),
      createPlaceFeature('Milwaukee', -87.9, 43.04, { population: 570_000 }),
    ])

    startSession(map)
    act(flushAnimationFrames)

    map.setSourceFeatures([createPlaceFeature('Chicago', -87.625, 41.875, { population: 2_700_000 })])
    act(() => {
      map.emit('moveend')
    })
    act(flushAnimationFrames)

    expect(map.querySourceFeatures).toHaveBeenCalledTimes(2)
    expect(map.probeSource?.setData).toHaveBeenCalledTimes(1)
    expect(map.probeSource?.updateData).not.toHaveBeenCalled()
    expect(getLastProbeCollection(map)?.features.map((feature) => feature.properties.name)).toEqual([
      'Chicago',
      'Milwaukee',
    ])

    act(() => {
      map.emit('idle')
    })
    act(flushAnimationFrames)

    expect(map.querySourceFeatures).toHaveBeenCalledTimes(3)
    expect(map.probeSource?.setData).toHaveBeenCalledTimes(1)
    expect(getLastProbeTextDiff(map)).toEqual({
      remove: ['Milwaukee:-87.9000:43.0400'],
    })
  })

  it('uses idle as a candidate refresh follow-up but not after playback text diffs', () => {
    const map = createProbeablePlacesMap()
    map.setSourceFeatures([createPlaceFeature('Chicago', -87.625, 41.875, { population: 2_700_000 })])

    const session = startSession(map)
    act(flushAnimationFrames)

    act(() => {
      map.emit('idle')
    })
    act(flushAnimationFrames)
    expect(map.querySourceFeatures).toHaveBeenCalledTimes(2)

    mocks.sampleFieldWindowWithSampler.mockReturnValue(25)
    act(() => {
      session.setFrame({
        lower: { layerId: 'temperature', grid: mocks.testGrid },
        upper: { layerId: 'temperature', grid: mocks.testGrid },
        mix: 0.5,
      } as FieldInterpolationWindowData)
    })
    act(flushAnimationFrames)

    act(() => {
      map.emit('idle')
    })

    expect(map.querySourceFeatures).toHaveBeenCalledTimes(2)
  })

  it('removes the custom layer/source on unmount', () => {
    const map = createProbeablePlacesMap()
    map.setSourceFeatures([createPlaceFeature('Chicago', -87.625, 41.875, { population: 2_700_000 })])

    const session = startSession(map)
    act(flushAnimationFrames)

    session.destroy()

    expect(map.removeLayer).toHaveBeenCalledWith(placeProbeLayerIds.layer)
    expect(map.removeSource).toHaveBeenCalledWith(placeProbeLayerIds.source)
  })

  it('cancels pending source updates and removes viewport listeners on unmount', () => {
    const map = createProbeablePlacesMap()
    map.setSourceFeatures([createPlaceFeature('Chicago', -87.625, 41.875, { population: 2_700_000 })])

    const session = startSession(map)

    session.destroy()

    expect(window.cancelAnimationFrame).toHaveBeenCalled()
    expect(map.off).toHaveBeenCalledWith('moveend', expect.any(Function))
    expect(map.off).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(map.off).toHaveBeenCalledWith('idle', expect.any(Function))
    expect(map.off).toHaveBeenCalledWith('mousemove', placeProbeLayerIds.layer, expect.any(Function))
    expect(map.off).toHaveBeenCalledWith('mouseleave', placeProbeLayerIds.layer, expect.any(Function))
  })

  it('tolerates cleanup after MapLibre has already removed its style', () => {
    const map = createProbeablePlacesMap()
    map.setSourceFeatures([createPlaceFeature('Chicago', -87.625, 41.875, { population: 2_700_000 })])

    const session = startSession(map)
    act(flushAnimationFrames)

    map.getLayer.mockImplementation(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'getLayer')")
    })
    map.getSource.mockImplementation(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'getSource')")
    })

    expect(() => session.destroy()).not.toThrow()
    expect(map.removeLayer).not.toHaveBeenCalled()
    expect(map.removeSource).not.toHaveBeenCalled()
  })
})
