import type { Map as MapLibreMap } from 'maplibre-gl'
import { describe, expect, it, vi } from 'vitest'

import { createPlaceProbeHoverSession } from './hover'
import { placeProbeLayerIds } from './layer'

type LayerHandler = (...args: unknown[]) => void

type HoverableMap = MapLibreMap & {
  setProbeLayerAvailable: (available: boolean) => void
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  getLayer: ReturnType<typeof vi.fn>
  getCanvas: ReturnType<typeof vi.fn>
  setFeatureState: ReturnType<typeof vi.fn>
}

function createHoverableMap(initialProbeLayerAvailable = true) {
  const handlers = new Map<string, LayerHandler>()
  const canvas = { style: { cursor: '' } }
  let probeLayerAvailable = initialProbeLayerAvailable

  const map = {
    setProbeLayerAvailable(available: boolean) {
      probeLayerAvailable = available
    },
    on: vi.fn((event: string, layerOrHandler: string | LayerHandler, maybeHandler?: LayerHandler) => {
      if (typeof layerOrHandler === 'function') {
        handlers.set(event, layerOrHandler)
        return
      }
      if (maybeHandler) handlers.set(`${event}:${layerOrHandler}`, maybeHandler)
    }),
    off: vi.fn(),
    getLayer: vi.fn((id: string) => (id === placeProbeLayerIds.layer && probeLayerAvailable ? { id } : undefined)),
    getCanvas: vi.fn(() => canvas),
    setFeatureState: vi.fn(),
  } as unknown as HoverableMap

  return { map, handlers, canvas }
}

describe('createPlaceProbeHoverSession', () => {
  it('attaches hover listeners and updates GeoJSON hover state', () => {
    const { map, handlers, canvas } = createHoverableMap()

    createPlaceProbeHoverSession(map).start()

    expect(map.on).toHaveBeenCalledWith('load', expect.any(Function))
    expect(map.on).toHaveBeenCalledWith('styledata', expect.any(Function))
    expect(map.on).toHaveBeenCalledWith('mousemove', placeProbeLayerIds.layer, expect.any(Function))
    expect(map.on).toHaveBeenCalledWith('mouseleave', placeProbeLayerIds.layer, expect.any(Function))

    const onMove = handlers.get(`mousemove:${placeProbeLayerIds.layer}`)
    const onLeave = handlers.get(`mouseleave:${placeProbeLayerIds.layer}`)

    onMove?.({
      features: [{ id: 'Chicago:-87.6250:41.8750' }],
    })

    expect(canvas.style.cursor).toBe('')
    expect(map.setFeatureState).toHaveBeenLastCalledWith(
      { source: placeProbeLayerIds.source, id: 'Chicago:-87.6250:41.8750' },
      { hover: true }
    )

    onMove?.({
      features: [{ properties: { id: 'Milwaukee:-87.9000:43.0400' } }],
    })

    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: placeProbeLayerIds.source, id: 'Chicago:-87.6250:41.8750' },
      { hover: false }
    )
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: placeProbeLayerIds.source, id: 'Milwaukee:-87.9000:43.0400' },
      { hover: true }
    )

    onLeave?.()

    expect(canvas.style.cursor).toBe('')
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: placeProbeLayerIds.source, id: 'Milwaukee:-87.9000:43.0400' },
      { hover: false }
    )
  })

  it('can attach after the probe layer is added later', () => {
    const { map, handlers } = createHoverableMap(false)

    createPlaceProbeHoverSession(map).start()

    expect(map.on).not.toHaveBeenCalledWith('mousemove', placeProbeLayerIds.layer, expect.any(Function))

    map.setProbeLayerAvailable(true)
    handlers.get('styledata')?.()

    expect(map.on).toHaveBeenCalledWith('mousemove', placeProbeLayerIds.layer, expect.any(Function))
    expect(map.on).toHaveBeenCalledWith('mouseleave', placeProbeLayerIds.layer, expect.any(Function))
  })

  it('ignores rendered features that do not expose a probe id', () => {
    const { map, handlers } = createHoverableMap()

    createPlaceProbeHoverSession(map).start()

    const onMove = handlers.get(`mousemove:${placeProbeLayerIds.layer}`)
    onMove?.({
      features: [{ properties: { osm_id: 4242 } }],
    })

    expect(map.setFeatureState).not.toHaveBeenCalled()
  })

  it('clears the previous hover when the hovered feature has no probe id', () => {
    const { map, handlers, canvas } = createHoverableMap()

    createPlaceProbeHoverSession(map).start()

    const onMove = handlers.get(`mousemove:${placeProbeLayerIds.layer}`)
    onMove?.({
      features: [{ id: 'Chicago:-87.6250:41.8750' }],
    })
    map.setFeatureState.mockClear()

    onMove?.({
      features: [{ properties: { osm_id: 4242 } }],
    })

    expect(canvas.style.cursor).toBe('')
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: placeProbeLayerIds.source, id: 'Chicago:-87.6250:41.8750' },
      { hover: false }
    )
  })

  it('detaches listeners on unmount after they were attached', () => {
    const { map, handlers } = createHoverableMap()

    const session = createPlaceProbeHoverSession(map)
    session.start()

    const onLoad = handlers.get('load')
    const onStyleData = handlers.get('styledata')

    session.destroy()

    expect(map.off).toHaveBeenCalledWith('load', onLoad)
    expect(map.off).toHaveBeenCalledWith('styledata', onStyleData)
    expect(map.off).toHaveBeenCalledWith('mousemove', placeProbeLayerIds.layer, handlers.get(`mousemove:${placeProbeLayerIds.layer}`))
    expect(map.off).toHaveBeenCalledWith('mouseleave', placeProbeLayerIds.layer, handlers.get(`mouseleave:${placeProbeLayerIds.layer}`))
  })

  it('tolerates hover cleanup after MapLibre has already removed its style', () => {
    const { map, handlers, canvas } = createHoverableMap()
    const session = createPlaceProbeHoverSession(map)
    session.start()

    handlers.get(`mousemove:${placeProbeLayerIds.layer}`)?.({
      features: [{ id: 'Chicago:-87.6250:41.8750' }],
    })
    map.setFeatureState.mockImplementation(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'setFeatureState')")
    })

    expect(() => session.destroy()).not.toThrow()
    expect(canvas.style.cursor).toBe('')
  })
})
