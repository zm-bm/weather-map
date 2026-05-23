import type { Map as MapLibreMap } from 'maplibre-gl'
import { describe, expect, it, vi } from 'vitest'

import { createForecastPlaceProbeHoverSession } from './hover'
import { forecastPlaceProbeLayerIds } from './layer'

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
    getLayer: vi.fn((id: string) => (id === forecastPlaceProbeLayerIds.layer && probeLayerAvailable ? { id } : undefined)),
    getCanvas: vi.fn(() => canvas),
    setFeatureState: vi.fn(),
  } as unknown as HoverableMap

  return { map, handlers, canvas }
}

describe('createForecastPlaceProbeHoverSession', () => {
  it('attaches hover listeners and updates GeoJSON hover state', () => {
    const { map, handlers, canvas } = createHoverableMap()

    createForecastPlaceProbeHoverSession(map).start()

    expect(map.on).toHaveBeenCalledWith('load', expect.any(Function))
    expect(map.on).toHaveBeenCalledWith('styledata', expect.any(Function))
    expect(map.on).toHaveBeenCalledWith('mousemove', forecastPlaceProbeLayerIds.layer, expect.any(Function))
    expect(map.on).toHaveBeenCalledWith('mouseleave', forecastPlaceProbeLayerIds.layer, expect.any(Function))

    const onMove = handlers.get(`mousemove:${forecastPlaceProbeLayerIds.layer}`)
    const onLeave = handlers.get(`mouseleave:${forecastPlaceProbeLayerIds.layer}`)

    onMove?.({
      features: [{ id: 'Chicago:-87.6250:41.8750' }],
    })

    expect(canvas.style.cursor).toBe('pointer')
    expect(map.setFeatureState).toHaveBeenLastCalledWith(
      { source: forecastPlaceProbeLayerIds.source, id: 'Chicago:-87.6250:41.8750' },
      { hover: true }
    )

    onMove?.({
      features: [{ properties: { id: 'Milwaukee:-87.9000:43.0400' } }],
    })

    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: forecastPlaceProbeLayerIds.source, id: 'Chicago:-87.6250:41.8750' },
      { hover: false }
    )
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: forecastPlaceProbeLayerIds.source, id: 'Milwaukee:-87.9000:43.0400' },
      { hover: true }
    )

    onLeave?.()

    expect(canvas.style.cursor).toBe('')
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: forecastPlaceProbeLayerIds.source, id: 'Milwaukee:-87.9000:43.0400' },
      { hover: false }
    )
  })

  it('can attach after the probe layer is added later', () => {
    const { map, handlers } = createHoverableMap(false)

    createForecastPlaceProbeHoverSession(map).start()

    expect(map.on).not.toHaveBeenCalledWith('mousemove', forecastPlaceProbeLayerIds.layer, expect.any(Function))

    map.setProbeLayerAvailable(true)
    handlers.get('styledata')?.()

    expect(map.on).toHaveBeenCalledWith('mousemove', forecastPlaceProbeLayerIds.layer, expect.any(Function))
    expect(map.on).toHaveBeenCalledWith('mouseleave', forecastPlaceProbeLayerIds.layer, expect.any(Function))
  })

  it('ignores rendered features that do not expose a name', () => {
    const { map, handlers } = createHoverableMap()

    createForecastPlaceProbeHoverSession(map).start()

    const onMove = handlers.get(`mousemove:${forecastPlaceProbeLayerIds.layer}`)
    onMove?.({
      features: [{ properties: { osm_id: 4242 } }],
    })

    expect(map.setFeatureState).not.toHaveBeenCalled()
  })

  it('detaches listeners on unmount after they were attached', () => {
    const { map, handlers } = createHoverableMap()

    const session = createForecastPlaceProbeHoverSession(map)
    session.start()

    const onLoad = handlers.get('load')
    const onStyleData = handlers.get('styledata')

    session.destroy()

    expect(map.off).toHaveBeenCalledWith('load', onLoad)
    expect(map.off).toHaveBeenCalledWith('styledata', onStyleData)
    expect(map.off).toHaveBeenCalledWith('mousemove', forecastPlaceProbeLayerIds.layer, handlers.get(`mousemove:${forecastPlaceProbeLayerIds.layer}`))
    expect(map.off).toHaveBeenCalledWith('mouseleave', forecastPlaceProbeLayerIds.layer, handlers.get(`mouseleave:${forecastPlaceProbeLayerIds.layer}`))
  })
})
