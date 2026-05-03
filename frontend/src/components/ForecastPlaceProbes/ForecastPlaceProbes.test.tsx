import { act, render } from '@testing-library/react'
import type { Map as MapLibreMap, MapGeoJSONFeature } from 'maplibre-gl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { basemapLayerIds, placeProbeLayerIds } from '../../map/view/constants'
import ForecastPlaceProbes from './ForecastPlaceProbes'

type MapEventName = 'idle' | 'moveend' | 'resize'
type MapEventHandler = () => void

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
    x_wrap: 'repeat',
    y_mode: 'clamp',
  }

  return {
    activeScalar: 'tmp_surface',
    forecastLoaded: true,
    testGrid,
    frame: {
      lower: {
        variableId: 'tmp_surface',
        grid: testGrid,
      },
      upper: {
        variableId: 'tmp_surface',
        grid: testGrid,
      },
      mix: 0,
    } as { lower: { variableId: string; grid: typeof testGrid }; upper: { variableId: string; grid: typeof testGrid }; mix: number } | null,
    formatProbeDisplay: vi.fn((rawValue: number | null, loading = false) => ({
      text: loading ? 'Loading' : (rawValue == null ? 'No data' : `${rawValue} F`),
      loading,
      value: rawValue,
    })),
    getForecastProbeFrame: vi.fn(),
    createScalarProbeSampler: vi.fn(),
    sampleScalarFrameWindowWithSampler: vi.fn(),
    subscribeForecastProbeFrame: vi.fn(),
    forecastProbeFrameListener: null as ((frame: unknown) => void) | null,
  }
})

vi.mock('../../forecast-selection', () => ({
  useForecastSelectionContext: () => ({
    activeScalar: mocks.forecastLoaded ? mocks.activeScalar : null,
    manifest: mocks.forecastLoaded ? {} : null,
  }),
}))

vi.mock('../../forecast-probe', async () => {
  const actual = await vi.importActual<typeof import('../../forecast-probe')>('../../forecast-probe')

  return {
    ...actual,
    forecastProbeFrameStore: {
      getCurrent: () => mocks.getForecastProbeFrame(),
      subscribe: (listener: (frame: unknown) => void) => {
        mocks.forecastProbeFrameListener = listener
        mocks.subscribeForecastProbeFrame(listener)
        return vi.fn()
      },
    },
    scalarProbe: {
      createPointSampler: mocks.createScalarProbeSampler,
      sampleFrameWindowWithSampler: mocks.sampleScalarFrameWindowWithSampler,
    },
    useForecastProbeValueFormatter: () => mocks.formatProbeDisplay,
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
  const handlers = new Map<MapEventName, Set<MapEventHandler>>()
  const sources = new Map<string, unknown>()
  const layers = new Set<string>()
  let sourceFeatures: MapGeoJSONFeature[] = []
  let zoom = 4
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
    querySourceFeatures: vi.fn(() => sourceFeatures),
    removeLayer: vi.fn((layerId: string) => {
      layers.delete(layerId)
    }),
    removeSource: vi.fn((sourceId: string) => {
      sources.delete(sourceId)
      if (sourceId === placeProbeLayerIds.source) probeSource = null
    }),
    on: vi.fn((eventName: MapEventName, handler: MapEventHandler) => {
      let eventHandlers = handlers.get(eventName)
      if (!eventHandlers) {
        eventHandlers = new Set<MapEventHandler>()
        handlers.set(eventName, eventHandlers)
      }
      eventHandlers.add(handler)
    }),
    off: vi.fn((eventName: MapEventName, handler: MapEventHandler) => {
      handlers.get(eventName)?.delete(handler)
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

describe('ForecastPlaceProbes', () => {
  let animationFrameCallbacks: FrameRequestCallback[]

  function flushAnimationFrames() {
    const callbacks = animationFrameCallbacks.splice(0)
    for (const callback of callbacks) {
      callback(0)
    }
  }

  beforeEach(() => {
    animationFrameCallbacks = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      animationFrameCallbacks.push(callback)
      return animationFrameCallbacks.length
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    mocks.activeScalar = 'tmp_surface'
    mocks.forecastLoaded = true
    mocks.frame = {
      lower: {
        variableId: 'tmp_surface',
        grid: mocks.testGrid,
      },
      upper: {
        variableId: 'tmp_surface',
        grid: mocks.testGrid,
      },
      mix: 0,
    }
    mocks.formatProbeDisplay.mockClear()
    mocks.getForecastProbeFrame.mockReset()
    mocks.getForecastProbeFrame.mockImplementation(() => mocks.frame)
    mocks.createScalarProbeSampler.mockReset()
    mocks.createScalarProbeSampler.mockImplementation((_frame, place: { id: string }) => ({ id: place.id }))
    mocks.sampleScalarFrameWindowWithSampler.mockReset()
    mocks.sampleScalarFrameWindowWithSampler.mockReturnValue(20)
    mocks.subscribeForecastProbeFrame.mockClear()
    mocks.forecastProbeFrameListener = null
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('does not install the probe source while forecast selection is unloaded', () => {
    const map = createProbeablePlacesMap()
    map.setSourceFeatures([createPlaceFeature('Chicago', -87.625, 41.875, { population: 2_700_000 })])
    mocks.forecastLoaded = false

    const { container } = render(<ForecastPlaceProbes mapRef={{ current: map }} mapReadyVersion={1} />)

    expect(container.querySelector('canvas')).toBeNull()
    expect(map.addSource).not.toHaveBeenCalled()
    expect(map.querySourceFeatures).not.toHaveBeenCalled()
  })

  it('adds one GeoJSON source/layer and renders probe text', () => {
    const map = createProbeablePlacesMap()
    map.setSourceFeatures([
      createPlaceFeature('Chicago', -87.625, 41.875, { population: 2_700_000 }),
      createPlaceFeature('Milwaukee', -87.9, 43.04, { population: 570_000 }),
    ])

    const { container } = render(<ForecastPlaceProbes mapRef={{ current: map }} mapReadyVersion={1} />)
    act(flushAnimationFrames)

    expect(container.querySelector('canvas')).toBeNull()
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
      basemapLayerIds.source,
      { sourceLayer: basemapLayerIds.placeSourceLayer },
    )
    expect(mocks.createScalarProbeSampler).toHaveBeenCalledTimes(2)
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

    render(<ForecastPlaceProbes mapRef={{ current: map }} mapReadyVersion={1} />)
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

    render(<ForecastPlaceProbes mapRef={{ current: map }} mapReadyVersion={1} />)
    act(flushAnimationFrames)
    expect(map.querySourceFeatures).toHaveBeenCalledTimes(1)

    mocks.sampleScalarFrameWindowWithSampler.mockReturnValue(25)
    act(() => {
      mocks.forecastProbeFrameListener?.({
        lower: { variableId: 'tmp_surface', grid: mocks.testGrid },
        upper: { variableId: 'tmp_surface', grid: mocks.testGrid },
        mix: 0.5,
      })
    })
    act(flushAnimationFrames)

    expect(map.querySourceFeatures).toHaveBeenCalledTimes(1)
    expect(map.probeSource?.setData).toHaveBeenCalledTimes(1)
    expect(map.probeSource?.updateData).toHaveBeenCalledTimes(1)
    expect(getLastProbeTextDiff(map)?.update?.[0]).toEqual({
      id: 'Chicago:-87.6250:41.8750',
      addOrUpdateProperties: [{ key: 'probeText', value: '25 F' }],
    })
    expect(document.querySelectorAll('.forecast-place-probe')).toHaveLength(0)
  })

  it('skips playback source updates when displayed values are unchanged', () => {
    const map = createProbeablePlacesMap()
    map.setSourceFeatures([createPlaceFeature('Chicago', -87.625, 41.875, { population: 2_700_000 })])

    render(<ForecastPlaceProbes mapRef={{ current: map }} mapReadyVersion={1} />)
    act(flushAnimationFrames)

    act(() => {
      mocks.forecastProbeFrameListener?.({
        lower: { variableId: 'tmp_surface', grid: mocks.testGrid },
        upper: { variableId: 'tmp_surface', grid: mocks.testGrid },
        mix: 0.5,
      })
    })
    act(flushAnimationFrames)

    expect(map.probeSource?.setData).toHaveBeenCalledTimes(1)
    expect(map.probeSource?.updateData).not.toHaveBeenCalled()
  })

  it('keeps the source/layer installed when the active scalar changes', () => {
    const map = createProbeablePlacesMap()
    const mapRef = { current: map }
    map.setSourceFeatures([createPlaceFeature('Chicago', -87.625, 41.875, { population: 2_700_000 })])

    const { rerender } = render(<ForecastPlaceProbes mapRef={mapRef} mapReadyVersion={1} />)
    act(flushAnimationFrames)

    mocks.activeScalar = 'dewpoint_surface'
    rerender(<ForecastPlaceProbes mapRef={mapRef} mapReadyVersion={1} />)
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

    render(<ForecastPlaceProbes mapRef={{ current: map }} mapReadyVersion={1} />)
    act(flushAnimationFrames)

    map.setSourceFeatures([createPlaceFeature('Madison', -89.4, 43.07, { population: 270_000 })])
    act(() => {
      map.emit('moveend')
    })
    act(flushAnimationFrames)

    expect(map.querySourceFeatures).toHaveBeenCalledTimes(2)
    expect(mocks.createScalarProbeSampler).toHaveBeenLastCalledWith(
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

    render(<ForecastPlaceProbes mapRef={{ current: map }} mapReadyVersion={1} />)
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

    render(<ForecastPlaceProbes mapRef={{ current: map }} mapReadyVersion={1} />)
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

    render(<ForecastPlaceProbes mapRef={{ current: map }} mapReadyVersion={1} />)
    act(flushAnimationFrames)

    act(() => {
      map.emit('idle')
    })
    act(flushAnimationFrames)
    expect(map.querySourceFeatures).toHaveBeenCalledTimes(2)

    mocks.sampleScalarFrameWindowWithSampler.mockReturnValue(25)
    act(() => {
      mocks.forecastProbeFrameListener?.({
        lower: { variableId: 'tmp_surface', grid: mocks.testGrid },
        upper: { variableId: 'tmp_surface', grid: mocks.testGrid },
        mix: 0.5,
      })
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

    const { unmount } = render(<ForecastPlaceProbes mapRef={{ current: map }} mapReadyVersion={1} />)
    act(flushAnimationFrames)

    unmount()

    expect(map.removeLayer).toHaveBeenCalledWith(placeProbeLayerIds.layer)
    expect(map.removeSource).toHaveBeenCalledWith(placeProbeLayerIds.source)
  })

  it('tolerates cleanup after MapLibre has already removed its style', () => {
    const map = createProbeablePlacesMap()
    map.setSourceFeatures([createPlaceFeature('Chicago', -87.625, 41.875, { population: 2_700_000 })])

    const { unmount } = render(<ForecastPlaceProbes mapRef={{ current: map }} mapReadyVersion={1} />)
    act(flushAnimationFrames)

    map.getLayer.mockImplementation(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'getLayer')")
    })
    map.getSource.mockImplementation(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'getSource')")
    })

    expect(() => unmount()).not.toThrow()
    expect(map.removeLayer).not.toHaveBeenCalled()
    expect(map.removeSource).not.toHaveBeenCalled()
  })
})
