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
    expect(basemapStyleForForecastRasterLayer('precipitation_rate')).toBe('satellite-context')
    expect(basemapStyleForForecastRasterLayer('accumulated_precipitation')).toBe('satellite-context')
    expect(basemapStyleForForecastRasterLayer('cloud_layers')).toBe('satellite-context')
    expect(basemapStyleForForecastRasterLayer('cloud_cover')).toBe('satellite-context')
    expect(basemapStyleForForecastRasterLayer('observed_radar_composite_reflectivity')).toBe('satellite-context')
    expect(basemapStyleForForecastRasterLayer('composite_reflectivity')).toBe('satellite-context')
    expect(basemapStyleForForecastRasterLayer('temperature')).toBe('standard')
    expect(basemapStyleForForecastRasterLayer(null)).toBe('standard')
  })

  it('keeps satellite-context lake styling subtle over weather layers', () => {
    const map = createBasemapThemeMapFixture(Object.values(BASEMAP_LAYER_IDS))

    applyForecastBasemapStyle(map, 'satellite-context')

    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.lakeFill,
      'fill-opacity',
      0.1
    )
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.lakeOutline,
      'line-opacity',
      0.32
    )
  })

  it('shows the satellite layer for satellite context and hides it for standard context', () => {
    const map = createBasemapThemeMapFixture(Object.values(BASEMAP_LAYER_IDS))

    applyForecastBasemapStyle(map, 'satellite-context')
    const satelliteOpacity = map.setPaintProperty.mock.calls.find(([layerId, property]) => (
      layerId === BASEMAP_LAYER_IDS.satelliteBasemap && property === 'raster-opacity'
    ))?.[2]
    expect(typeof satelliteOpacity).toBe('number')
    expect(satelliteOpacity).toBeGreaterThan(0)
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.satelliteBasemap,
      'visibility',
      'visible'
    )

    map.setPaintProperty.mockClear()
    map.setLayoutProperty.mockClear()
    applyForecastBasemapStyle(map, 'standard')

    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.satelliteBasemap,
      'raster-opacity',
      readStandardBasemapPaintValue({
        layerId: BASEMAP_LAYER_IDS.satelliteBasemap,
        property: 'raster-opacity',
      })
    )
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.satelliteBasemap,
      'visibility',
      'none'
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

    expect(() => applyForecastBasemapStyle(map, 'satellite-context')).not.toThrow()
    expect(map.setPaintProperty).toHaveBeenCalledTimes(1)
    expect(map.setPaintProperty.mock.calls[0]?.[0]).toBe(BASEMAP_LAYER_IDS.background)
    expect(map.setLayoutProperty).not.toHaveBeenCalled()
  })
})
