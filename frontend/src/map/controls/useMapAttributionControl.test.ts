import { renderHook } from '@testing-library/react'
import maplibregl, { type IControl, type Map as MapLibreMap } from 'maplibre-gl'
import { describe, expect, it } from 'vitest'

import { createMapFixture } from '@/test/fixtures'
import { useMapAttributionControl } from './useMapAttributionControl'

type AddedControl = [IControl, string?]

describe('useMapAttributionControl', () => {
  it('adds and removes native attribution control', () => {
    const map = createMapFixture()
    const mapRef = { current: null as MapLibreMap | null }

    const { rerender, unmount } = renderHook(
      ({ version }) => useMapAttributionControl(mapRef, version),
      { initialProps: { version: 0 } },
    )

    expect(map.addControl).not.toHaveBeenCalled()

    mapRef.current = map
    rerender({ version: 1 })

    expect(map.addControl).toHaveBeenCalledTimes(1)

    const addedControls = map.addControl.mock.calls as unknown as AddedControl[]
    expect(addedControls[0]?.[1]).toBe('bottom-right')
    expect(addedControls[0]?.[0]).toBeInstanceOf(maplibregl.AttributionControl)

    unmount()

    expect(map.removeControl).toHaveBeenCalledTimes(1)
    expect(map.removeControl).toHaveBeenCalledWith(addedControls[0]?.[0])
  })

  it('skips removeControl when the map already dropped attribution', () => {
    const map = createMapFixture()
    const mapRef = { current: map as MapLibreMap | null }

    const { unmount } = renderHook(() => useMapAttributionControl(mapRef, 1))

    expect(map.addControl).toHaveBeenCalledTimes(1)

    const addedControls = map.addControl.mock.calls as unknown as AddedControl[]
    addedControls.forEach(([control]) => {
      map.removeControl(control)
    })
    map.removeControl.mockClear()
    map.hasControl.mockClear()

    unmount()

    expect(map.hasControl).toHaveBeenCalledTimes(1)
    expect(map.removeControl).not.toHaveBeenCalled()
  })
})
