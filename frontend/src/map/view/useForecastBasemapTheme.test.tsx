import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { createBasemapThemeMapFixture } from '@/test/fixtures'
import { BASEMAP_LAYER_IDS } from '../basemap'
import { useForecastBasemapTheme } from './useForecastBasemapTheme'

describe('useForecastBasemapTheme', () => {
  it('updates the map theme when the selected layer changes', () => {
    const map = createBasemapThemeMapFixture(Object.values(BASEMAP_LAYER_IDS))
    const { rerender } = renderHook(
      ({ selectedLayerId }) => useForecastBasemapTheme({
        map,
        selectedLayerId,
      }),
      { initialProps: { selectedLayerId: 'temperature' as string | null } }
    )

    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.satelliteBasemap,
      'visibility',
      'none'
    )

    map.setPaintProperty.mockClear()
    map.setLayoutProperty.mockClear()
    rerender({ selectedLayerId: 'cloud_layers' })
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.satelliteBasemap,
      'visibility',
      'visible'
    )

    map.setPaintProperty.mockClear()
    map.setLayoutProperty.mockClear()
    rerender({ selectedLayerId: 'temperature' })
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.satelliteBasemap,
      'visibility',
      'none'
    )
  })

  it('waits for the map style to be ready', () => {
    const map = createBasemapThemeMapFixture()

    renderHook(() => useForecastBasemapTheme({
      map: null,
      selectedLayerId: 'cloud_layers',
    }))

    expect(map.setPaintProperty).not.toHaveBeenCalled()
  })
})
