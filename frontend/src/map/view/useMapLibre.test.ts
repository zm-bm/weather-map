import { renderHook, act, waitFor } from '@testing-library/react'
import type { StyleSpecification, VectorSourceSpecification } from 'maplibre-gl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BASEMAP_SOURCE_ID } from '../basemap'

const mocks = vi.hoisted(() => {
  let styleLoaded = false
  const listeners = new globalThis.Map<string, Set<(event?: unknown) => void>>()
  const controls = new Set<unknown>()
  const map = {
    on: vi.fn((event: string, handler: (event?: unknown) => void) => {
      const handlers = listeners.get(event) ?? new Set<(event?: unknown) => void>()
      handlers.add(handler)
      listeners.set(event, handlers)
    }),
    off: vi.fn((event: string, handler: (event?: unknown) => void) => {
      listeners.get(event)?.delete(handler)
    }),
    isStyleLoaded: vi.fn(() => styleLoaded),
    addControl: vi.fn((control: unknown) => {
      controls.add(control)
    }),
    removeControl: vi.fn((control: unknown) => {
      controls.delete(control)
    }),
    hasControl: vi.fn((control: unknown) => controls.has(control)),
    remove: vi.fn(),
  }
  const AttributionControl = vi.fn(function MockAttributionControl(this: { options: unknown }, options: unknown) {
    this.options = options
  })
  const MockMapConstructor = vi.fn(function MockMap() {
    return map
  })

  return {
    addProtocol: vi.fn(),
    AttributionControl,
    Map: MockMapConstructor,
    loadStoredViewport: vi.fn(() => null),
    saveStoredViewport: vi.fn(),
    mapFixture: () => map,
    setStyleLoaded: (value: boolean) => {
      styleLoaded = value
    },
    emit: (event: string, payload?: unknown) => {
      for (const handler of listeners.get(event) ?? []) handler(payload)
    },
    reset: () => {
      styleLoaded = false
      listeners.clear()
      controls.clear()
      map.on.mockClear()
      map.off.mockClear()
      map.isStyleLoaded.mockClear()
      map.addControl.mockClear()
      map.removeControl.mockClear()
      map.hasControl.mockClear()
      map.remove.mockClear()
      AttributionControl.mockClear()
    },
  }
})

vi.mock('maplibre-gl', () => ({
  default: {
    addProtocol: mocks.addProtocol,
    AttributionControl: mocks.AttributionControl,
    Map: mocks.Map,
  },
}))

vi.mock('pmtiles', () => ({
  Protocol: class MockProtocol {
    tile = vi.fn()
  },
}))

vi.mock('@/core/config', () => ({
  default: {
    frontendBaseUrl: 'http://localhost:5173',
    artifactBaseUrl: 'http://localhost:3000',
    basemapUrl: 'pmtiles://http://localhost:3000/pmtiles/20260424.z6.pmtiles',
  },
}))

vi.mock('./viewportPersistence', () => ({
  loadStoredViewport: () => mocks.loadStoredViewport(),
  saveStoredViewport: (map: unknown) => mocks.saveStoredViewport(map),
}))

import baseStyleJson from './style.json'
import config from '@/core/config'
import { useMapLibre } from './useMapLibre'

const MAP_OPTIONS = {
  center: [-95, 39] as [number, number],
  zoom: 4,
  minZoom: 2,
  maxZoom: 8,
}

type MapConstructorOptions = {
  dragRotate: boolean
  fadeDuration: number
  localIdeographFontFamily: string
  style: StyleSpecification
}

function renderMapLibre(hook = useMapLibre) {
  return renderHook(() => hook(MAP_OPTIONS))
}

function latestMapOptions(): MapConstructorOptions {
  const calls = mocks.Map.mock.calls as unknown as Array<[MapConstructorOptions]>
  return calls.at(-1)?.[0] as MapConstructorOptions
}

function latestStyle(): StyleSpecification {
  return latestMapOptions().style
}

describe('useMapLibre', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.reset()
  })

  it('constructs the map with a cloned imported style', () => {
    renderMapLibre()

    expect(mocks.Map).toHaveBeenCalledTimes(1)
    expect(mocks.AttributionControl).toHaveBeenCalledWith({ compact: false })
    expect(mocks.mapFixture().addControl).toHaveBeenCalledWith(
      expect.any(mocks.AttributionControl),
      'bottom-left',
    )
    const options = latestMapOptions()
    const style = latestStyle()

    expect(options.dragRotate).toBe(true)
    expect(options.fadeDuration).toBe(0)
    expect(options.localIdeographFontFamily).toBe('sans-serif')
    expect(style).not.toBe(baseStyleJson)
    expect(style.glyphs).toBeUndefined()
    const basemapSource = style.sources?.[BASEMAP_SOURCE_ID] as VectorSourceSpecification | undefined
    expect(basemapSource?.type).toBe('vector')
    expect(basemapSource?.url).toBe(config.basemapUrl)
    expect(basemapSource?.promoteId).toBeUndefined()

    ;(basemapSource as VectorSourceSpecification).tiles = ['http://localhost:3000/basemap/{z}/{x}/{y}']
    expect((baseStyleJson.sources?.[BASEMAP_SOURCE_ID] as VectorSourceSpecification).tiles).toBeUndefined()

    expect((style.layers ?? []).map((layer) => layer.id)).toEqual(expect.arrayContaining([
      'background',
      'water',
    ]))
  })

  it('omits the basemap source and dependent layers when no basemap url is configured', async () => {
    vi.resetModules()
    vi.doMock('@/core/config', () => ({
      default: {
        ...config,
        basemapUrl: undefined,
      },
    }))

    const { useMapLibre: useMapLibreWithoutBasemap } = await import('./useMapLibre')

    renderMapLibre(useMapLibreWithoutBasemap)

    expect(mocks.addProtocol).not.toHaveBeenCalled()
    const style = latestStyle()

    expect(style.sources?.[BASEMAP_SOURCE_ID]).toBeUndefined()
    expect((style.layers ?? []).some((layer) => 'source' in layer && layer.source === BASEMAP_SOURCE_ID)).toBe(false)
  })

  it('exposes the map after style load', () => {
    const { result } = renderMapLibre()

    expect(result.current.map).toBeNull()

    act(() => {
      mocks.emit('style.load')
    })

    expect(result.current.map).toBe(mocks.mapFixture())
  })

  it('exposes the map immediately when the style is already loaded', async () => {
    mocks.setStyleLoaded(true)

    const { result } = renderMapLibre()

    await waitFor(() => {
      expect(result.current.map).toBe(mocks.mapFixture())
    })
  })

  it('reports map construction errors', async () => {
    mocks.Map.mockImplementationOnce(function MockMap() {
      throw new Error('WebGL unavailable')
    })

    const { result } = renderMapLibre()

    await waitFor(() => {
      expect(result.current.mapError?.message).toBe('WebGL unavailable')
    })
    expect(result.current.map).toBeNull()
  })

  it('reports renderer startup errors before the first style load', async () => {
    const { result } = renderMapLibre()

    act(() => {
      mocks.emit('error', {
        error: {
          message: 'Failed to initialize WebGL',
          type: 'webglcontextcreationerror',
        },
      })
    })

    await waitFor(() => {
      expect(result.current.mapError?.message).toBe('Failed to initialize WebGL')
    })
  })

  it('normalizes JSON-encoded renderer startup errors', async () => {
    const { result } = renderMapLibre()

    act(() => {
      mocks.emit('error', {
        error: JSON.stringify({
          type: 'webglcontextcreationerror',
          message: 'Failed to initialize WebGL',
        }),
      })
    })

    await waitFor(() => {
      expect(result.current.mapError?.message).toBe('Failed to initialize WebGL')
    })
  })

  it('can retry map construction after a startup error', async () => {
    mocks.Map.mockImplementationOnce(function MockMap() {
      throw new Error('WebGL unavailable')
    })
    const { result } = renderMapLibre()

    await waitFor(() => {
      expect(result.current.mapError?.message).toBe('WebGL unavailable')
    })

    act(() => {
      result.current.retryMap()
    })

    await waitFor(() => {
      expect(mocks.Map).toHaveBeenCalledTimes(2)
    })
    expect(result.current.mapError).toBeNull()
    expect(result.current.map).toBeNull()

    act(() => {
      mocks.emit('style.load')
    })

    expect(result.current.map).toBe(mocks.mapFixture())
  })

  it('removes listeners and tears down the map on unmount', () => {
    const { unmount } = renderMapLibre()

    unmount()

    expect(mocks.mapFixture().off).toHaveBeenCalledWith('moveend', expect.any(Function))
    expect(mocks.mapFixture().off).toHaveBeenCalledWith('style.load', expect.any(Function))
    expect(mocks.mapFixture().off).toHaveBeenCalledWith('error', expect.any(Function))
    expect(mocks.mapFixture().removeControl).toHaveBeenCalledWith(expect.any(mocks.AttributionControl))
    expect(mocks.mapFixture().remove).toHaveBeenCalledTimes(1)
  })
})
