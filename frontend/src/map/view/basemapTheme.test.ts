import { describe, expect, it, vi } from 'vitest'

import { readStandardBasemapPaintValue } from './basemapStyle'
import {
  BASEMAP_LAYER_IDS,
} from './constants'
import {
  applyBasemapTheme,
  basemapThemeForForecastLayer,
} from './basemapTheme'

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

describe('basemap theme', () => {
  it('uses the cloud basemap theme only for Cloud Layers', () => {
    expect(basemapThemeForForecastLayer('cloud_layers')).toBe('cloud-layers')
    expect(basemapThemeForForecastLayer('cloud_cover')).toBe('standard')
    expect(basemapThemeForForecastLayer(null)).toBe('standard')
  })

  it('applies the Cloud Layers theme and restores standard style paints', () => {
    const map = createThemeMap()

    applyBasemapTheme(map as never, 'cloud-layers')
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
    applyBasemapTheme(map as never, 'standard')

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
    const map = createThemeMap([BASEMAP_LAYER_IDS.background])

    expect(() => applyBasemapTheme(map as never, 'cloud-layers')).not.toThrow()
    expect(map.setPaintProperty).toHaveBeenCalledTimes(1)
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      BASEMAP_LAYER_IDS.background,
      'background-color',
      'rgb(143, 137, 102)'
    )
  })
})
