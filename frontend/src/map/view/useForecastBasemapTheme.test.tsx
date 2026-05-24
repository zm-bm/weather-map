import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { createBasemapThemeMapFixture } from '@/test/fixtures'
import { BASEMAP_LAYER_IDS } from '../basemap'
import { useForecastBasemapTheme } from './useForecastBasemapTheme'

describe('useForecastBasemapTheme', () => {
  it('updates the map theme when the selected layer changes', () => {
    const map = createBasemapThemeMapFixture()
    const getMap = vi.fn(() => map)
    const { rerender } = renderHook(
      ({ selectedLayerId }) => useForecastBasemapTheme({
        getMap,
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
    const map = createBasemapThemeMapFixture()
    const getMap = vi.fn(() => map)

    renderHook(() => useForecastBasemapTheme({
      getMap,
      mapReadyVersion: 0,
      selectedLayerId: 'cloud_layers',
    }))

    expect(getMap).not.toHaveBeenCalled()
    expect(map.setPaintProperty).not.toHaveBeenCalled()
  })
})
