import { act } from '@testing-library/react'
import type { LayerSpecification } from 'maplibre-gl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BASEMAP_SOURCE_ID,
  BASEMAP_SOURCE_LAYER_IDS,
} from '@/map/basemap'
import type { ProbeWindow } from '@/forecast/frames'
import {
  createForecastPlaceProbeSession,
  type ForecastPlaceProbeSessionOptions,
} from './session'
import { placeProbeLayerIds } from './layer'
import {
  createPlaceFeature,
  createProbeablePlacesMap,
  getLastProbeCollection,
  type ProbeablePlacesMap,
} from './session.testFixtures'

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
        source: { layerId: 'temperature' },
        raster: { grid: testGrid },
      },
      upper: {
        source: { layerId: 'temperature' },
        raster: { grid: testGrid },
      },
      mix: 0,
    } as unknown as ProbeWindow | null,
    formatProbeValue: vi.fn((rawValue: number | null, loading = false) => ({
      text: loading ? 'Loading' : (rawValue == null ? 'No data' : `${rawValue} F`),
      loading,
      value: rawValue,
    })),
    createRasterProbeSampler: vi.fn(),
    sampleRasterWindowWithSampler: vi.fn(),
  }
})

vi.mock('./rasterSampling', async () => {
  const actual = await vi.importActual<typeof import('./rasterSampling')>('./rasterSampling')

  return {
    ...actual,
    createRasterProbeSampler: mocks.createRasterProbeSampler,
    sampleRasterWindowWithSampler: mocks.sampleRasterWindowWithSampler,
  }
})

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
        source: { layerId: 'temperature' },
        raster: { grid: mocks.testGrid },
      },
      upper: {
        source: { layerId: 'temperature' },
        raster: { grid: mocks.testGrid },
      },
      mix: 0,
    } as unknown as ProbeWindow
    mocks.formatProbeValue.mockClear()
    mocks.createRasterProbeSampler.mockReset()
    mocks.createRasterProbeSampler.mockImplementation((_frame, place: { id: string }) => ({ id: place.id }))
    mocks.sampleRasterWindowWithSampler.mockReset()
    mocks.sampleRasterWindowWithSampler.mockReturnValue(20)
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
      ...options,
    })
    session.setFrame(mocks.frame)
    session.start()
    return session
  }

  function getAddedProbeTextField(map: ProbeablePlacesMap): unknown[] {
    const layer = map.addLayer.mock.calls
      .map(([candidate]) => candidate as LayerSpecification)
      .find((candidate) => candidate.id === placeProbeLayerIds.layer)
    const textField = (layer?.layout as Record<string, unknown> | undefined)?.['text-field']
    if (!Array.isArray(textField)) {
      throw new Error('Missing place-probe text-field expression')
    }
    return textField
  }

  it('does not schedule source updates before start', () => {
    const map = createProbeablePlacesMap()
    const session = createForecastPlaceProbeSession({
      map,
      layerId: 'temperature',
      valueFormatter: mocks.formatProbeValue,
    })

    session.setFrame(mocks.frame)

    expect(window.requestAnimationFrame).not.toHaveBeenCalled()
    expect(map.addSource).not.toHaveBeenCalled()
    expect(map.addLayer).not.toHaveBeenCalled()
  })

  it('adds GeoJSON source/layers and renders probe text', () => {
    const map = createProbeablePlacesMap()
    map.setZoom(4.25)
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
    }))
    expect(map.querySourceFeatures).toHaveBeenCalledWith(
      BASEMAP_SOURCE_ID,
      { sourceLayer: BASEMAP_SOURCE_LAYER_IDS.places },
    )
    expect(mocks.createRasterProbeSampler).toHaveBeenCalledTimes(2)
    expect(getLastProbeCollection(map)?.features.map((feature) => feature.properties)).toEqual([
      { sortKey: 0, labelText: 'Chicago\n20 F' },
      { sortKey: 1, labelText: 'Milwaukee\n20 F' },
    ])
    expect(getAddedProbeTextField(map)).toEqual(['get', 'labelText'])
  })

  it('keeps non-latin local names in the rendered label text', () => {
    const map = createProbeablePlacesMap()
    map.setSourceFeatures([
      createPlaceFeature('東京', 139.69, 35.68, {
        nameEn: 'Tokyo',
        population: 14_000_000,
      }),
    ])

    startSession(map)
    act(flushAnimationFrames)

    expect(getLastProbeCollection(map)?.features[0]?.properties).toEqual(
      { sortKey: 0, labelText: 'Tokyo\n東京\n20 F' },
    )
  })

  it('updates playback frame values without querying source features or adding DOM nodes', () => {
    const map = createProbeablePlacesMap()
    map.setSourceFeatures([createPlaceFeature('Chicago', -87.625, 41.875, { population: 2_700_000 })])

    const session = startSession(map)
    act(flushAnimationFrames)
    expect(map.querySourceFeatures).toHaveBeenCalledTimes(1)

    mocks.sampleRasterWindowWithSampler.mockReturnValue(25)
    act(() => {
      session.setFrame({
        lower: { source: { layerId: 'temperature' }, raster: { grid: mocks.testGrid } },
        upper: { source: { layerId: 'temperature' }, raster: { grid: mocks.testGrid } },
        mix: 0.5,
      } as unknown as ProbeWindow)
    })
    act(flushAnimationFrames)

    expect(map.querySourceFeatures).toHaveBeenCalledTimes(1)
    expect(map.probeSource?.setData).toHaveBeenCalledTimes(2)
    expect(getLastProbeCollection(map)?.features.map((feature) => feature.properties)).toEqual([
      { sortKey: 0, labelText: 'Chicago\n25 F' },
    ])
  })

  it('uses canvas size to select more labels on large maps', () => {
    const map = createProbeablePlacesMap()
    map.setZoom(5.25)
    map.setCanvasSize(1920, 1080)
    map.setSourceFeatures(Array.from({ length: 80 }, (_entry, index) => (
      createPlaceFeature(`Rank ${index}`, index % 20, Math.floor(index / 20), {
        populationRank: index + 1,
      })
    )))

    startSession(map)
    act(flushAnimationFrames)

    expect(map.getCanvas).toHaveBeenCalled()
    expect(getLastProbeCollection(map)?.features).toHaveLength(72)
  })

  it('refreshes source features after map movement settles', () => {
    const map = createProbeablePlacesMap()
    map.setZoom(4.25)
    map.setSourceFeatures([createPlaceFeature('Chicago', -87.625, 41.875, { population: 2_700_000 })])

    startSession(map)
    act(flushAnimationFrames)

    map.setSourceFeatures([createPlaceFeature('Madison', -89.4, 43.07, { population: 270_000 })])
    act(() => {
      map.emit('moveend')
    })
    act(flushAnimationFrames)

    expect(map.querySourceFeatures).toHaveBeenCalledTimes(2)
    expect(mocks.createRasterProbeSampler).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'Madison' })
    )
    expect(getLastProbeCollection(map)?.features.map((feature) => feature.properties)).toEqual([
      { sortKey: 0, labelText: 'Madison\n20 F' },
    ])
  })

  it('keeps previous probe labels during same-tier map movement', () => {
    const map = createProbeablePlacesMap()
    map.setZoom(5.25)
    map.setBounds(0, 10, 0, 10)
    map.setSourceFeatures([
      createPlaceFeature('Sticky', 5, 5, { populationRank: 10 }),
    ])

    startSession(map)
    act(flushAnimationFrames)

    map.setSourceFeatures([
      createPlaceFeature('New Top', 5.2, 5.2, { capital: 'yes', population: 1_000_000 }),
      createPlaceFeature('Sticky', 5, 5, { populationRank: 10 }),
    ])
    act(() => {
      map.emit('moveend')
    })
    act(flushAnimationFrames)

    expect(getLastProbeCollection(map)?.features.map((feature) => feature.properties.labelText)).toEqual([
      'Sticky\n20 F',
      'New Top\n20 F',
    ])
  })

  it('resets previous probe retention after crossing zoom tiers', () => {
    const map = createProbeablePlacesMap()
    map.setZoom(4)
    map.setBounds(0, 10, 0, 10)
    map.setSourceFeatures([
      createPlaceFeature('Major', 5, 5, { population: 1_000_000 }),
    ])

    startSession(map)
    act(flushAnimationFrames)

    map.setZoom(5.25)
    map.setSourceFeatures([
      createPlaceFeature('New Top', 5.2, 5.2, { capital: 'yes', population: 1_000_000 }),
      createPlaceFeature('Major', 5, 5, { population: 1_000_000 }),
    ])
    act(() => {
      map.emit('moveend')
    })
    act(flushAnimationFrames)

    expect(getLastProbeCollection(map)?.features.map((feature) => feature.properties.labelText)).toEqual([
      'New Top\n20 F',
      'Major\n20 F',
    ])
  })

  it('uses padded bounds when refreshing probe candidates', () => {
    const map = createProbeablePlacesMap()
    map.setZoom(5.25)
    map.setBounds(0, 10, 0, 10)
    map.setSourceFeatures([
      createPlaceFeature('Inside', 5, 5, { populationRank: 1 }),
      createPlaceFeature('Padded Edge', 11.5, 5, { populationRank: 2 }),
      createPlaceFeature('Outside', 13.5, 5, { populationRank: 3 }),
    ])

    startSession(map)
    act(flushAnimationFrames)

    expect(getLastProbeCollection(map)?.features.map((feature) => feature.properties.labelText)).toEqual([
      'Inside\n20 F',
      'Padded Edge\n20 F',
    ])
  })

  it('uses visible bounds for spread grid sizing', () => {
    const map = createProbeablePlacesMap()
    map.setZoom(5.25)
    map.setBounds(0, 6, 0, 10)
    map.setSourceFeatures([
      ...Array.from({ length: 35 }, (_entry, index) => (
        createPlaceFeature(`Cluster ${index}`, 0.9 + index * 0.001, 5, {
          populationRank: index + 1,
        })
      )),
      createPlaceFeature('Visible Grid Slot', 1.1, 5, { populationRank: 60 }),
    ])

    startSession(map)
    act(flushAnimationFrames)

    expect(getLastProbeCollection(map)?.features.map((feature) => feature.properties.labelText)).toContain(
      'Visible Grid Slot\n20 F',
    )
  })

  it.each([
    {
      name: 'empty',
      nextFeatures: [],
      expectedLabels: [],
    },
    {
      name: 'partial',
      nextFeatures: [
        createPlaceFeature('Chicago', -87.625, 41.875, { population: 2_700_000 }),
      ],
      expectedLabels: ['Chicago\n20 F'],
    },
  ])('keeps current probes during a provisional $name viewport refresh until idle', ({
    nextFeatures,
    expectedLabels,
  }) => {
    const map = createProbeablePlacesMap()
    map.setZoom(4.25)
    map.setSourceFeatures([
      createPlaceFeature('Chicago', -87.625, 41.875, { population: 2_700_000 }),
      createPlaceFeature('Milwaukee', -87.9, 43.04, { population: 570_000 }),
    ])

    startSession(map)
    act(flushAnimationFrames)

    map.setSourceFeatures(nextFeatures)
    act(() => {
      map.emit('moveend')
    })
    act(flushAnimationFrames)

    expect(map.querySourceFeatures).toHaveBeenCalledTimes(2)
    expect(map.probeSource?.setData).toHaveBeenCalledTimes(1)
    expect(getLastProbeCollection(map)?.features.map((feature) => feature.properties.labelText)).toEqual([
      'Chicago\n20 F',
      'Milwaukee\n20 F',
    ])

    act(() => {
      map.emit('idle')
    })
    act(flushAnimationFrames)

    expect(map.querySourceFeatures).toHaveBeenCalledTimes(3)
    expect(map.probeSource?.setData).toHaveBeenCalledTimes(2)
    expect(getLastProbeCollection(map)?.features.map((feature) => feature.properties.labelText)).toEqual(expectedLabels)
  })

  it('uses idle as a candidate refresh follow-up but not after playback updates', () => {
    const map = createProbeablePlacesMap()
    map.setSourceFeatures([createPlaceFeature('Chicago', -87.625, 41.875, { population: 2_700_000 })])

    const session = startSession(map)
    act(flushAnimationFrames)

    act(() => {
      map.emit('idle')
    })
    act(flushAnimationFrames)
    expect(map.querySourceFeatures).toHaveBeenCalledTimes(2)

    mocks.sampleRasterWindowWithSampler.mockReturnValue(25)
    act(() => {
      session.setFrame({
        lower: { source: { layerId: 'temperature' }, raster: { grid: mocks.testGrid } },
        upper: { source: { layerId: 'temperature' }, raster: { grid: mocks.testGrid } },
        mix: 0.5,
      } as unknown as ProbeWindow)
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
