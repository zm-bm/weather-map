import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { BASEMAP_LAYER_IDS } from '../basemap'
import { useForecastBasemapTheme } from './useForecastBasemapTheme'

function createThemeMap(layerIds: readonly string[] = [
  BASEMAP_LAYER_IDS.background,
  BASEMAP_LAYER_IDS.water,
  BASEMAP_LAYER_IDS.coastline,
  BASEMAP_LAYER_IDS.boundary2,
]) {
  const layers = new Set(layerIds)
  return {
    getLayer: vi.fn((layerId: string) => layers.has(layerId) ? { id: layerId } : undefined),
    setPaintProperty: vi.fn(),
  }
}

describe('useForecastBasemapTheme', () => {
  it('updates the map theme when the selected layer changes', () => {
    const map = createThemeMap()
    const getMap = vi.fn(() => map)
    const { rerender } = renderHook(
      ({ selectedLayerId }) => useForecastBasemapTheme({
        getMap: getMap as never,
        mapReadyVersion: 1,
        selectedLayerId,
      }),
      { initialProps: { selectedLayerId: 'temperature' as string | null } }
    )

    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.background,
      'background-color',
      'rgb(244, 241, 235)'
    )

    map.setPaintProperty.mockClear()
    rerender({ selectedLayerId: 'cloud_layers' })
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.background,
      'background-color',
      'rgb(143, 137, 102)'
    )

    map.setPaintProperty.mockClear()
    rerender({ selectedLayerId: 'cloud_cover' })
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.background,
      'background-color',
      'rgb(244, 241, 235)'
    )
  })

  it('waits for the map style to be ready', () => {
    const map = createThemeMap()
    const getMap = vi.fn(() => map)

    renderHook(() => useForecastBasemapTheme({
      getMap: getMap as never,
      mapReadyVersion: 0,
      selectedLayerId: 'cloud_layers',
    }))

    expect(getMap).not.toHaveBeenCalled()
    expect(map.setPaintProperty).not.toHaveBeenCalled()
  })
})
