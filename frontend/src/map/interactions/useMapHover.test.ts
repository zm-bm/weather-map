import { renderHook } from '@testing-library/react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { describe, expect, it, vi } from 'vitest'

import { PLACE_LABEL_LAYER_IDS } from "../view/constants"
import { BASEMAP_SOURCE_ID, PLACE_SOURCE_LAYER_ID } from "../view/constants"
import { useMapHover } from './useMapHover'

type LayerHandler = (...args: unknown[]) => void

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
    getLayer: vi.fn((id: string) => (PLACE_LABEL_LAYER_IDS.includes(id as typeof PLACE_LABEL_LAYER_IDS[number]) ? { id } : undefined)),
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

    for (const layerId of PLACE_LABEL_LAYER_IDS) {
      expect(map.on).toHaveBeenCalledWith('mousemove', layerId, expect.any(Function))
      expect(map.on).toHaveBeenCalledWith('mouseleave', layerId, expect.any(Function))
    }

    const onMove = handlers.get(`mousemove:${PLACE_LABEL_LAYER_IDS[0]}`)
    const onLeave = handlers.get(`mouseleave:${PLACE_LABEL_LAYER_IDS[0]}`)

    onMove?.({
      features: [{ properties: { name: 'Chicago' } }],
    })

    expect(canvas.style.cursor).toBe('pointer')
    expect(map.setFeatureState).toHaveBeenLastCalledWith(
      { source: BASEMAP_SOURCE_ID, sourceLayer: PLACE_SOURCE_LAYER_ID, id: 'Chicago' },
      { hover: true }
    )

    onMove?.({
      features: [{ properties: { name: 'Milwaukee' } }],
    })

    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: BASEMAP_SOURCE_ID, sourceLayer: PLACE_SOURCE_LAYER_ID, id: 'Chicago' },
      { hover: false }
    )
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: BASEMAP_SOURCE_ID, sourceLayer: PLACE_SOURCE_LAYER_ID, id: 'Milwaukee' },
      { hover: true }
    )

    onLeave?.()

    expect(canvas.style.cursor).toBe('')
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: BASEMAP_SOURCE_ID, sourceLayer: PLACE_SOURCE_LAYER_ID, id: 'Milwaukee' },
      { hover: false }
    )
  })

  it('ignores rendered features that do not expose a name', () => {
    const { map, handlers } = createHoverableMap()
    const mapRef = { current: map as MapLibreMap | null }

    renderHook(() => useMapHover(mapRef))
    handlers.get('load')?.()

    const onMove = handlers.get(`mousemove:${PLACE_LABEL_LAYER_IDS[0]}`)
    onMove?.({
      features: [{ properties: { osm_id: 4242 } }],
    })

    expect(map.setFeatureState).not.toHaveBeenCalled()
  })

  it('detaches listeners on unmount after they were attached', () => {
    const { map, handlers } = createHoverableMap()
    const mapRef = { current: map as MapLibreMap | null }

    const { unmount } = renderHook(() => useMapHover(mapRef))
    handlers.get('load')?.()

    const onLoad = handlers.get('load')

    unmount()

    expect(map.off).toHaveBeenCalledWith('load', onLoad)
    for (const layerId of PLACE_LABEL_LAYER_IDS) {
      const onMove = handlers.get(`mousemove:${layerId}`)
      const onLeave = handlers.get(`mouseleave:${layerId}`)
      expect(map.off).toHaveBeenCalledWith('mousemove', layerId, onMove)
      expect(map.off).toHaveBeenCalledWith('mouseleave', layerId, onLeave)
    }
  })
})
