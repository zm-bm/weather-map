import { describe, expect, it } from 'vitest'

import { createBasemapThemeMapFixture } from '@/test/fixtures'
import { readStandardBasemapPaintValue } from './basemapStyle'
import {
  BASEMAP_LAYER_IDS,
} from '../basemap'
import {
  applyBasemapTheme,
  basemapThemeForForecastLayer,
} from './basemapTheme'

describe('basemap theme', () => {
  it('uses the cloud basemap theme only for Cloud Layers', () => {
    expect(basemapThemeForForecastLayer('cloud_layers')).toBe('cloud-layers')
    expect(basemapThemeForForecastLayer('cloud_cover')).toBe('standard')
    expect(basemapThemeForForecastLayer(null)).toBe('standard')
  })

  it('applies the Cloud Layers theme and restores standard style paints', () => {
    const map = createBasemapThemeMapFixture()

    applyBasemapTheme(map, 'cloud-layers')
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.background,
      'background-color',
      'rgb(143, 137, 102)'
    )
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.water,
      'fill-color',
      'rgb(150, 156, 149)'
    )
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.water,
      'fill-opacity',
      0.74
    )
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.coastline,
      'line-color',
      'rgb(41, 45, 40)'
    )

    map.setPaintProperty.mockClear()
    applyBasemapTheme(map, 'standard')

    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.background,
      'background-color',
      readStandardBasemapPaintValue({
        layerId: BASEMAP_LAYER_IDS.background,
        property: 'background-color',
      })
    )
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.water,
      'fill-opacity',
      readStandardBasemapPaintValue({
        layerId: BASEMAP_LAYER_IDS.water,
        property: 'fill-opacity',
      })
    )
  })

  it('ignores missing basemap layers', () => {
    const map = createBasemapThemeMapFixture([BASEMAP_LAYER_IDS.background])

    expect(() => applyBasemapTheme(map, 'cloud-layers')).not.toThrow()
    expect(map.setPaintProperty).toHaveBeenCalledTimes(1)
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.background,
      'background-color',
      'rgb(143, 137, 102)'
    )
  })
})
