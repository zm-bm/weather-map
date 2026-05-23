import { renderHook, act, waitFor } from '@testing-library/react'
import type { StyleSpecification, VectorSourceSpecification } from 'maplibre-gl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BASEMAP_SOURCE_ID } from '../basemap'
import { createConfigFixture } from '../../test/fixtures/config'

const mocks = vi.hoisted(() => {
  let styleLoaded = false
  const listeners = new globalThis.Map<string, Set<() => void>>()
  const map = {
    on: vi.fn((event: string, handler: () => void) => {
      const handlers = listeners.get(event) ?? new Set<() => void>()
      handlers.add(handler)
      listeners.set(event, handlers)
    }),
    off: vi.fn((event: string, handler: () => void) => {
      listeners.get(event)?.delete(handler)
    }),
    isStyleLoaded: vi.fn(() => styleLoaded),
    remove: vi.fn(),
  }
  const MockMapConstructor = vi.fn(function MockMap() {
    return map
  })

  return {
    addProtocol: vi.fn(),
    Map: MockMapConstructor,
    loadStoredViewport: vi.fn(() => null),
    saveStoredViewport: vi.fn(),
    getMap: () => map,
    setStyleLoaded: (value: boolean) => {
      styleLoaded = value
    },
    emit: (event: string) => {
      for (const handler of listeners.get(event) ?? []) handler()
    },
    reset: () => {
      styleLoaded = false
      listeners.clear()
      map.on.mockClear()
      map.off.mockClear()
      map.isStyleLoaded.mockClear()
      map.remove.mockClear()
    },
  }
})

vi.mock('maplibre-gl', () => ({
  default: {
    addProtocol: mocks.addProtocol,
    Map: mocks.Map,
  },
}))

vi.mock('pmtiles', () => ({
  Protocol: class MockProtocol {
    tile = vi.fn()
  },
}))

vi.mock('../../config', () => ({
  default: createConfigFixture(),
}))

vi.mock('./viewportPersistence', () => ({
  loadStoredViewport: () => mocks.loadStoredViewport(),
  saveStoredViewport: (map: unknown) => mocks.saveStoredViewport(map),
}))

import baseStyleJson from './style.json'
import config from '../../config'
import { useMapLibre } from './useMapLibre'
import { joinUrl } from '../../url/joinUrl'

describe('useMapLibre', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.reset()
  })

  it('constructs the map with a cloned imported style', () => {
    renderHook(() => useMapLibre({
      center: [-95, 39],
      zoom: 4,
      minZoom: 2,
      maxZoom: 8,
    }))

    expect(mocks.Map).toHaveBeenCalledTimes(1)
    const calls = mocks.Map.mock.calls as unknown as Array<[{ fadeDuration: number; style: StyleSpecification }]>
    const options = calls[0][0]
    const style = options.style

    expect(options.fadeDuration).toBe(0)
    expect(style).not.toBe(baseStyleJson)
    expect(style.glyphs).toBe(joinUrl(config.artifactBaseUrl, 'glyphs/{fontstack}/{range}.pbf'))
    const basemapSource = style.sources?.[BASEMAP_SOURCE_ID] as VectorSourceSpecification | undefined
    expect(basemapSource?.type).toBe('vector')
    expect(basemapSource?.url).toBe(config.basemapUrl)
    expect(basemapSource?.promoteId).toBeUndefined()

    ;(basemapSource as VectorSourceSpecification).tiles = ['http://localhost:3000/basemap/{z}/{x}/{y}']
    expect((baseStyleJson.sources?.[BASEMAP_SOURCE_ID] as VectorSourceSpecification).tiles).toBeUndefined()

    const layerIds = (style.layers ?? []).map((layer) => layer.id)
    expect(layerIds).toContain('background')
    expect(layerIds).toContain('water')
    expect(layerIds.some((layerId) => layerId.startsWith('label_city_'))).toBe(false)
  })

  it('omits the basemap source and dependent layers when no basemap url is configured', async () => {
    vi.resetModules()
    vi.doMock('../../config', () => ({
      default: {
        ...config,
        basemapUrl: undefined,
      },
    }))

    const { useMapLibre: useMapLibreWithoutBasemap } = await import('./useMapLibre')

    renderHook(() => useMapLibreWithoutBasemap({
      center: [-95, 39],
      zoom: 4,
      minZoom: 2,
      maxZoom: 8,
    }))

    expect(mocks.addProtocol).not.toHaveBeenCalled()
    const calls = mocks.Map.mock.calls as unknown as Array<[{ style: StyleSpecification }]>
    const style = calls[0][0].style

    expect(style.sources?.[BASEMAP_SOURCE_ID]).toBeUndefined()
    expect((style.layers ?? []).some((layer) => 'source' in layer && layer.source === BASEMAP_SOURCE_ID)).toBe(false)
    expect((style.layers ?? []).map((layer) => layer.id)).toEqual(['background'])
  })

  it('bumps readiness on style load', () => {
    const { result } = renderHook(() => useMapLibre({
      center: [-95, 39],
      zoom: 4,
      minZoom: 2,
      maxZoom: 8,
    }))

    expect(result.current.mapReadyVersion).toBe(0)

    act(() => {
      mocks.emit('style.load')
    })

    expect(result.current.mapReadyVersion).toBe(1)
  })

  it('bumps readiness immediately when the style is already loaded', async () => {
    mocks.setStyleLoaded(true)

    const { result } = renderHook(() => useMapLibre({
      center: [-95, 39],
      zoom: 4,
      minZoom: 2,
      maxZoom: 8,
    }))

    await waitFor(() => {
      expect(result.current.mapReadyVersion).toBe(1)
    })
  })

  it('removes listeners and tears down the map on unmount', () => {
    const { unmount } = renderHook(() => useMapLibre({
      center: [-95, 39],
      zoom: 4,
      minZoom: 2,
      maxZoom: 8,
    }))

    unmount()

    expect(mocks.getMap().off).toHaveBeenCalledWith('moveend', expect.any(Function))
    expect(mocks.getMap().off).toHaveBeenCalledWith('style.load', expect.any(Function))
    expect(mocks.getMap().off).toHaveBeenCalledWith('error', expect.any(Function))
    expect(mocks.getMap().remove).toHaveBeenCalledTimes(1)
  })
})
