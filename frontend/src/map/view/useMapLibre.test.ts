import { renderHook, act, waitFor } from '@testing-library/react'
import type { StyleSpecification, VectorSourceSpecification } from 'maplibre-gl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    Map: MockMapConstructor,
    installForecastLayers: vi.fn(),
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
    Map: mocks.Map,
  },
}))

vi.mock('../../forecast-layers', () => ({
  installForecastLayers: (map: unknown) => mocks.installForecastLayers(map),
}))

vi.mock('./viewportPersistence', () => ({
  loadStoredViewport: () => mocks.loadStoredViewport(),
  saveStoredViewport: (map: unknown) => mocks.saveStoredViewport(map),
}))

import baseStyleJson from '../styles/style.json'
import { useMapLibre } from './useMapLibre'

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
    const calls = mocks.Map.mock.calls as unknown as Array<[{ style: StyleSpecification }]>
    const options = calls[0][0]
    const style = options.style

    expect(style).not.toBe(baseStyleJson)
    expect(style.glyphs).toBe('/font/{fontstack}/{range}')
    const openMapTilesSource = style.sources?.openmaptiles as VectorSourceSpecification | undefined
    expect(openMapTilesSource?.type).toBe('vector')
    expect(openMapTilesSource?.url).toBe('https://tiles.openfreemap.org/planet')
    expect(openMapTilesSource?.promoteId).toEqual({ place: 'name' })

    ;(openMapTilesSource as VectorSourceSpecification).tiles = ['http://localhost:8081/basemap/{z}/{x}/{y}']
    expect((baseStyleJson.sources?.openmaptiles as VectorSourceSpecification).tiles).toBeUndefined()

    const layerIds = (style.layers ?? []).map((layer) => layer.id)
    expect(layerIds).toContain('background')
    expect(layerIds).toContain('water')
    expect(layerIds).toContain('label_city_capital')
  })

  it('installs forecast layers on style load and bumps readiness', () => {
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

    expect(mocks.installForecastLayers).toHaveBeenCalledTimes(1)
    expect(mocks.installForecastLayers).toHaveBeenCalledWith(mocks.getMap())
    expect(result.current.mapReadyVersion).toBe(1)
  })

  it('installs forecast layers immediately when the style is already loaded', async () => {
    mocks.setStyleLoaded(true)

    const { result } = renderHook(() => useMapLibre({
      center: [-95, 39],
      zoom: 4,
      minZoom: 2,
      maxZoom: 8,
    }))

    await waitFor(() => {
      expect(mocks.installForecastLayers).toHaveBeenCalledTimes(1)
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
