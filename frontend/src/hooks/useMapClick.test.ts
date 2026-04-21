import { act, renderHook } from '@testing-library/react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useMapClick } from './useMapClick'
import { clearScalarProbeFrame, setScalarProbeFrame } from '../map/scalar'
import type { ScalarFrameData } from '../map/scalar/engine/types'
import MapProbeProvider from '../state/MapProbeProvider'
import { useMapProbe } from '../state/MapProbeContext'

type EventHandler = (event: { lngLat: { lng: number; lat: number } }) => void

type ClickableMap = MapLibreMap & {
  emit: (name: string, event: { lngLat: { lng: number; lat: number } }) => void
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
}

function createClickableMap(): ClickableMap {
  const handlers = new Map<string, Set<EventHandler>>()

  const map = {
    on: vi.fn((name: string, handler: EventHandler) => {
      let entry = handlers.get(name)
      if (!entry) {
        entry = new Set<EventHandler>()
        handlers.set(name, entry)
      }
      entry.add(handler)
    }),
    off: vi.fn((name: string, handler: EventHandler) => {
      handlers.get(name)?.delete(handler)
    }),
    emit(name: string, event: { lngLat: { lng: number; lat: number } }) {
      handlers.get(name)?.forEach((handler) => handler(event))
    },
  }

  return map as ClickableMap
}

function createFrame(): ScalarFrameData {
  return {
    variableId: 'tmp_surface',
    grid: {
      crs: 'EPSG:4326',
      nx: 2,
      ny: 2,
      lon0: 0,
      lat0: 1,
      dx: 1,
      dy: -1,
      origin: 'cell_center',
      layout: 'row_major',
      x_wrap: 'repeat',
      y_mode: 'clamp',
    },
    encoding: {
      format: 'scalar-i16-linear-v1',
      dtype: 'int16',
      byte_order: 'little',
      nodata: -32768,
      scale: 1,
      offset: 0,
      decode_formula: 'value = stored * scale + offset',
    },
    values: Int16Array.from([10, 20, 30, 40]),
    displayRange: [0, 100],
    colortable: [[0, 0, 0, 0]],
  }
}

function Wrapper({ children }: { children: ReactNode }) {
  return createElement(MapProbeProvider, null, children)
}

describe('useMapClick', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stores the probed scalar value at the clicked coordinate', () => {
    const map = createClickableMap()
    setScalarProbeFrame(map, createFrame())

    const { result, unmount } = renderHook(() => {
      useMapClick({ current: map })
      return useMapProbe()
    }, { wrapper: Wrapper })

    act(() => {
      map.emit('click', {
        lngLat: { lng: 0.5, lat: 0.5 },
      })
    })

    expect(result.current.lastProbe).toEqual({
      variableId: 'tmp_surface',
      lon: 0.5,
      lat: 0.5,
      value: 25,
    })

    unmount()

    expect(map.on).toHaveBeenCalledWith('click', expect.any(Function))
    expect(map.off).toHaveBeenCalledWith('click', expect.any(Function))
    clearScalarProbeFrame(map)
  })
})
