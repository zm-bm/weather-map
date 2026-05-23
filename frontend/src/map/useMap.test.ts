import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useMapLibre: vi.fn(),
  useMapAttributionControl: vi.fn(),
}))

vi.mock('./view/useMapLibre', () => ({
  useMapLibre: (args: unknown) => mocks.useMapLibre(args),
}))

vi.mock('./controls/useMapAttributionControl', () => ({
  useMapAttributionControl: (mapRef: unknown, mapReadyVersion: unknown) => {
    mocks.useMapAttributionControl(mapRef, mapReadyVersion)
  },
}))

import { useMap } from './useMap'

describe('useMap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useMapLibre.mockReturnValue({
      mapRef: { current: null },
      getMap: () => null,
      mapReadyVersion: 1,
    })
  })

  it('composes the map host hooks and returns the map-libre result', () => {
    const { result } = renderHook(() => useMap())

    expect(mocks.useMapLibre).toHaveBeenCalledWith({
      containerId: 'map',
      center: [-100, 35],
      zoom: 3,
      minZoom: 2,
      maxZoom: 6.99,
    })

    const map = mocks.useMapLibre.mock.results[0]?.value as {
      mapRef: { current: null }
      getMap: () => null
      mapReadyVersion: number
    }

    expect(mocks.useMapAttributionControl).toHaveBeenCalledWith(map.mapRef, map.mapReadyVersion)
    expect(result.current).toBe(map)
  })

  it('passes a custom container id through to map initialization', () => {
    renderHook(() => useMap({ containerId: 'forecast-map' }))

    expect(mocks.useMapLibre).toHaveBeenCalledWith(expect.objectContaining({
      containerId: 'forecast-map',
    }))
  })
})
