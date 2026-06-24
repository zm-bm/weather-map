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
    expect(basemapStyleForForecastRasterLayer('precipitation_rate')).toBe('standard')
    expect(basemapStyleForForecastRasterLayer('composite_reflectivity')).toBe('standard')
    expect(basemapStyleForForecastRasterLayer('wind_speed')).toBe('standard')
    expect(basemapStyleForForecastRasterLayer('air_pressure')).toBe('standard')
    expect(basemapStyleForForecastRasterLayer('cloud_cover')).toBe('standard')
    expect(basemapStyleForForecastRasterLayer(null)).toBe('standard')
  })

  it('applies the Cloud Layers theme and restores standard style paints', () => {
    const map = createBasemapThemeMapFixture(Object.values(BASEMAP_LAYER_IDS))

    applyForecastBasemapStyle(map, 'cloud-layers')
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.background,
      'background-color',
      'rgb(143, 137, 102)'
    )
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.earthMask,
      'fill-color',
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
      BASEMAP_LAYER_IDS.landcoverContext,
      'fill-color',
      [
        'match', ['get', 'kind'],
        ['forest', 'grassland', 'scrub'], 'rgb(100, 111, 76)',
        ['farmland', 'barren'], 'rgb(122, 111, 75)',
        ['glacier'], 'rgb(151, 158, 151)',
        'rgb(116, 111, 80)',
      ]
    )
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.landcoverContext,
      'fill-opacity',
      0.16
    )
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.landuseContext,
      'fill-color',
      'rgb(92, 89, 65)'
    )
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.landuseContext,
      'fill-opacity',
      0.2
    )
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.coastlineShadow,
      'line-color',
      'rgb(32, 36, 31)'
    )
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.coastlineShadow,
      'line-opacity',
      0.34
    )
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.lakeFill,
      'fill-color',
      'rgb(110, 143, 137)'
    )
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.lakeFill,
      'fill-opacity',
      0.3
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
      BASEMAP_LAYER_IDS.earthMask,
      'fill-color',
      readStandardBasemapPaintValue({
        layerId: BASEMAP_LAYER_IDS.earthMask,
        property: 'fill-color',
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
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.landcoverContext,
      'fill-opacity',
      readStandardBasemapPaintValue({
        layerId: BASEMAP_LAYER_IDS.landcoverContext,
        property: 'fill-opacity',
      })
    )
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.lakeFill,
      'fill-opacity',
      readStandardBasemapPaintValue({
        layerId: BASEMAP_LAYER_IDS.lakeFill,
        property: 'fill-opacity',
      })
    )
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.coastlineShadow,
      'line-opacity',
      readStandardBasemapPaintValue({
        layerId: BASEMAP_LAYER_IDS.coastlineShadow,
        property: 'line-opacity',
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
