import { describe, expect, it } from 'vitest'

import { createBasemapThemeMapFixture } from '@/test/fixtures'
import { BASEMAP_LAYER_IDS } from '../basemap'
import { readStandardBasemapPaintValue } from './basemapStyle'
import {
  applyForecastBasemapStyle,
  basemapStyleForForecastRasterLayer,
} from './basemapTheme'

describe('basemap theme', () => {
  it('maps forecast layers to basemap styles', () => {
    expect(basemapStyleForForecastRasterLayer('cloud_layers')).toBe('cloud-layers')
    expect(basemapStyleForForecastRasterLayer('temperature')).toBe('standard')
    expect(basemapStyleForForecastRasterLayer(null)).toBe('standard')
  })

  it('applies the cloud theme and restores standard paints', () => {
    const map = createBasemapThemeMapFixture(Object.values(BASEMAP_LAYER_IDS))

    applyForecastBasemapStyle(map, 'cloud-layers')
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.background,
      'background-color',
      'rgb(143, 137, 102)'
    )
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.water,
      'fill-opacity',
      0.74
    )
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.cityContext,
      'fill-opacity',
      0.16
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
      BASEMAP_LAYER_IDS.cityContext,
      'fill-opacity',
      readStandardBasemapPaintValue({
        layerId: BASEMAP_LAYER_IDS.cityContext,
        property: 'fill-opacity',
      })
    )
  })

  it('clones array paint values before applying them', () => {
    const map = createBasemapThemeMapFixture(Object.values(BASEMAP_LAYER_IDS))

    applyForecastBasemapStyle(map, 'standard')

    const appliedPaintValue = map.setPaintProperty.mock.calls.find(([layerId, property]) => (
      layerId === BASEMAP_LAYER_IDS.cityContext && property === 'fill-opacity'
    ))?.[2]
    const standardPaintValue = readStandardBasemapPaintValue({
      layerId: BASEMAP_LAYER_IDS.cityContext,
      property: 'fill-opacity',
    })

    expect(appliedPaintValue).toEqual(standardPaintValue)
    expect(appliedPaintValue).not.toBe(standardPaintValue)
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
