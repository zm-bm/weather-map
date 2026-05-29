import { describe, expect, it } from 'vitest'

import { createBasemapThemeMapFixture } from '@/test/fixtures'
import { readStandardBasemapPaintValue } from './basemapStyle'
import { BASEMAP_LAYER_IDS } from '../basemap'
import {
  applyForecastBasemapStyle,
  basemapStyleForForecastRasterLayer,
} from './basemapTheme'

describe('basemap theme', () => {
  it('maps forecast layers to basemap styles', () => {
    expect(basemapStyleForForecastRasterLayer('cloud_layers')).toBe('cloud-layers')
    expect(basemapStyleForForecastRasterLayer('snow_depth')).toBe('standard')
    expect(basemapStyleForForecastRasterLayer('cloud_cover')).toBe('standard')
    expect(basemapStyleForForecastRasterLayer(null)).toBe('standard')
  })

  it('applies the Cloud Layers theme and restores standard style paints', () => {
    const map = createBasemapThemeMapFixture()

    applyForecastBasemapStyle(map, 'cloud-layers')
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
    applyForecastBasemapStyle(map, 'standard')

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

    expect(() => applyForecastBasemapStyle(map, 'cloud-layers')).not.toThrow()
    expect(map.setPaintProperty).toHaveBeenCalledTimes(1)
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.background,
      'background-color',
      'rgb(143, 137, 102)'
    )
  })
})
