import { renderHook } from '@testing-library/react'
import maplibregl, { type IControl, type Map as MapLibreMap } from 'maplibre-gl'
import { describe, expect, it, vi } from 'vitest'

import { MusicControl } from '../components/controls/MusicControl'
import { OptionsControl } from '../components/controls/OptionsControl'
import { useMapControls } from './useMapControls'

type AddedControl = [IControl, string?]

type ControllableMap = MapLibreMap & {
  addControl: ReturnType<typeof vi.fn>
  hasControl: ReturnType<typeof vi.fn>
  removeControl: ReturnType<typeof vi.fn>
}

function createControllableMap(): ControllableMap {
  const controls = new Set<IControl>()

  return {
    addControl: vi.fn((control: IControl) => {
      controls.add(control)
    }),
    hasControl: vi.fn((control: IControl) => controls.has(control)),
    removeControl: vi.fn((control: IControl) => {
      controls.delete(control)
    }),
  } as unknown as ControllableMap
}

describe('useMapControls', () => {
  it('adds and removes navigation, music, and options controls', () => {
    const map = createControllableMap()
    const mapRef = { current: null as MapLibreMap | null }

    const { rerender, unmount } = renderHook(
      ({ version }) => useMapControls(mapRef, version),
      { initialProps: { version: 0 } },
    )

    expect(map.addControl).not.toHaveBeenCalled()

    mapRef.current = map
    rerender({ version: 1 })

    expect(map.addControl).toHaveBeenCalledTimes(3)

    const addedControls = map.addControl.mock.calls as unknown as AddedControl[]
    expect(addedControls.every(([, position]) => position === 'top-right')).toBe(true)
    expect(addedControls[0]?.[0]).toBeInstanceOf(maplibregl.NavigationControl)
    expect(addedControls[1]?.[0]).toBeInstanceOf(MusicControl)
    expect(addedControls[2]?.[0]).toBeInstanceOf(OptionsControl)

    unmount()

    expect(map.removeControl).toHaveBeenCalledTimes(3)
    expect(map.removeControl).toHaveBeenNthCalledWith(1, addedControls[2]?.[0])
    expect(map.removeControl).toHaveBeenNthCalledWith(2, addedControls[1]?.[0])
    expect(map.removeControl).toHaveBeenNthCalledWith(3, addedControls[0]?.[0])
  })

  it('skips removeControl when the map already dropped the controls', () => {
    const map = createControllableMap()
    const mapRef = { current: map as MapLibreMap | null }

    const { unmount } = renderHook(() => useMapControls(mapRef, 1))

    expect(map.addControl).toHaveBeenCalledTimes(3)

    const addedControls = map.addControl.mock.calls as unknown as AddedControl[]
    addedControls.forEach(([control]) => {
      map.removeControl(control)
    })
    map.removeControl.mockClear()
    map.hasControl.mockClear()

    unmount()

    expect(map.hasControl).toHaveBeenCalledTimes(3)
    expect(map.removeControl).not.toHaveBeenCalled()
  })
})
