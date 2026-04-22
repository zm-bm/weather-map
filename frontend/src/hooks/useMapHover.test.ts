import { renderHook } from '@testing-library/react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { describe, expect, it, vi } from 'vitest'

import { useMapHover } from './useMapHover'

type LayerHandler = (...args: any[]) => void

type HoverableMap = MapLibreMap & {
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  getLayer: ReturnType<typeof vi.fn>
  getCanvas: ReturnType<typeof vi.fn>
  setFeatureState: ReturnType<typeof vi.fn>
}

function createHoverableMap() {
  const handlers = new Map<string, LayerHandler>()
  const canvas = { style: { cursor: '' } }

  const map = {
    on: vi.fn((event: string, layerOrHandler: string | LayerHandler, maybeHandler?: LayerHandler) => {
      if (typeof layerOrHandler === 'function') {
        handlers.set(event, layerOrHandler)
        return
      }
      if (maybeHandler) handlers.set(`${event}:${layerOrHandler}`, maybeHandler)
    }),
    off: vi.fn(),
    getLayer: vi.fn((id: string) => (id === 'place-city' ? { id } : undefined)),
    getCanvas: vi.fn(() => canvas),
    setFeatureState: vi.fn(),
  } as unknown as HoverableMap

  return { map, handlers, canvas }
}

describe('useMapHover', () => {
  it('attaches hover listeners after map load and updates hover state', () => {
    const { map, handlers, canvas } = createHoverableMap()
    const mapRef = { current: map as MapLibreMap | null }

    renderHook(() => useMapHover(mapRef))

    expect(map.on).toHaveBeenCalledWith('load', expect.any(Function))

    const onLoad = handlers.get('load')
    expect(onLoad).toBeTypeOf('function')
    onLoad?.()

    expect(map.on).toHaveBeenCalledWith('mousemove', 'place-city', expect.any(Function))
    expect(map.on).toHaveBeenCalledWith('mouseleave', 'place-city', expect.any(Function))

    const onMove = handlers.get('mousemove:place-city')
    const onLeave = handlers.get('mouseleave:place-city')

    onMove?.({
      features: [{ id: 'city-1', properties: { id: 'city-1' } }],
    })

    expect(canvas.style.cursor).toBe('pointer')
    expect(map.setFeatureState).toHaveBeenLastCalledWith(
      { source: 'basemap', sourceLayer: 'place', id: 'city-1' },
      { hover: true }
    )

    onMove?.({
      features: [{ id: 'city-2', properties: { id: 'city-2' } }],
    })

    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: 'basemap', sourceLayer: 'place', id: 'city-1' },
      { hover: false }
    )
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: 'basemap', sourceLayer: 'place', id: 'city-2' },
      { hover: true }
    )

    onLeave?.()

    expect(canvas.style.cursor).toBe('')
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: 'basemap', sourceLayer: 'place', id: 'city-2' },
      { hover: false }
    )
  })

  it('detaches listeners on unmount after they were attached', () => {
    const { map, handlers } = createHoverableMap()
    const mapRef = { current: map as MapLibreMap | null }

    const { unmount } = renderHook(() => useMapHover(mapRef))
    handlers.get('load')?.()

    const onMove = handlers.get('mousemove:place-city')
    const onLeave = handlers.get('mouseleave:place-city')
    const onLoad = handlers.get('load')

    unmount()

    expect(map.off).toHaveBeenCalledWith('load', onLoad)
    expect(map.off).toHaveBeenCalledWith('mousemove', 'place-city', onMove)
    expect(map.off).toHaveBeenCalledWith('mouseleave', 'place-city', onLeave)
  })
})
