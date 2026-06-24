import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { createBasemapThemeMapFixture } from '@/test/fixtures'
import { BASEMAP_LAYER_IDS } from '../basemap'
import { readStandardBasemapPaintValue } from './basemapStyle'
import { useForecastBasemapTheme } from './useForecastBasemapTheme'

describe('useForecastBasemapTheme', () => {
  it('updates the map theme when the selected layer changes', () => {
    const map = createBasemapThemeMapFixture()
    const standardBackgroundColor = readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.background,
      property: 'background-color',
    })
    const { rerender } = renderHook(
      ({ selectedLayerId }) => useForecastBasemapTheme({
        map,
        selectedLayerId,
      }),
      { initialProps: { selectedLayerId: 'temperature' as string | null } }
    )

    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.background,
      'background-color',
      standardBackgroundColor
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
      standardBackgroundColor
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
