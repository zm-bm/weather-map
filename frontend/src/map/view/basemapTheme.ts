import type { Map as MapLibreMap } from 'maplibre-gl'

import { BASEMAP_LAYER_IDS } from '../basemap'
import {
  cloneStyleValue,
  readStandardBasemapPaints,
  type BasemapPaint,
  type BasemapPaintKey,
} from './basemapStyle'

export type ForecastBasemapStyleId = 'standard' | 'satellite-context'

type ForecastBasemapStyle = {
  id: ForecastBasemapStyleId
  paints: readonly BasemapPaint[]
  satelliteVisibility: 'visible' | 'none'
}

export const BASEMAP_THEME_PAINT_KEYS: readonly BasemapPaintKey[] = [
  { layerId: BASEMAP_LAYER_IDS.background, property: 'background-color' },
  { layerId: BASEMAP_LAYER_IDS.earthMask, property: 'fill-color' },
  { layerId: BASEMAP_LAYER_IDS.water, property: 'fill-color' },
  { layerId: BASEMAP_LAYER_IDS.water, property: 'fill-opacity' },
  { layerId: BASEMAP_LAYER_IDS.satelliteBasemap, property: 'raster-opacity' },
  { layerId: BASEMAP_LAYER_IDS.satelliteBasemap, property: 'raster-brightness-min' },
  { layerId: BASEMAP_LAYER_IDS.satelliteBasemap, property: 'raster-brightness-max' },
  { layerId: BASEMAP_LAYER_IDS.satelliteBasemap, property: 'raster-saturation' },
  { layerId: BASEMAP_LAYER_IDS.satelliteBasemap, property: 'raster-contrast' },
  { layerId: BASEMAP_LAYER_IDS.urbanAreaContext, property: 'fill-color' },
  { layerId: BASEMAP_LAYER_IDS.urbanAreaContext, property: 'fill-opacity' },
  { layerId: BASEMAP_LAYER_IDS.urbanAreaContext, property: 'fill-outline-color' },
  { layerId: BASEMAP_LAYER_IDS.cityContext, property: 'fill-color' },
  { layerId: BASEMAP_LAYER_IDS.cityContext, property: 'fill-opacity' },
  { layerId: BASEMAP_LAYER_IDS.cityContext, property: 'fill-outline-color' },
  { layerId: BASEMAP_LAYER_IDS.urbanAreaOutline, property: 'line-color' },
  { layerId: BASEMAP_LAYER_IDS.urbanAreaOutline, property: 'line-opacity' },
  { layerId: BASEMAP_LAYER_IDS.coastlineShadow, property: 'line-color' },
  { layerId: BASEMAP_LAYER_IDS.coastlineShadow, property: 'line-opacity' },
  { layerId: BASEMAP_LAYER_IDS.lakeFill, property: 'fill-color' },
  { layerId: BASEMAP_LAYER_IDS.lakeFill, property: 'fill-opacity' },
  { layerId: BASEMAP_LAYER_IDS.coastline, property: 'line-color' },
  { layerId: BASEMAP_LAYER_IDS.coastline, property: 'line-opacity' },
  { layerId: BASEMAP_LAYER_IDS.coastline, property: 'line-width' },
  { layerId: BASEMAP_LAYER_IDS.lakeOutline, property: 'line-color' },
  { layerId: BASEMAP_LAYER_IDS.lakeOutline, property: 'line-opacity' },
  { layerId: BASEMAP_LAYER_IDS.riverOutline, property: 'line-color' },
  { layerId: BASEMAP_LAYER_IDS.riverOutline, property: 'line-opacity' },
  { layerId: BASEMAP_LAYER_IDS.roadMajor, property: 'line-color' },
  { layerId: BASEMAP_LAYER_IDS.roadMajor, property: 'line-opacity' },
  { layerId: BASEMAP_LAYER_IDS.boundary4, property: 'line-color' },
  { layerId: BASEMAP_LAYER_IDS.boundary4, property: 'line-opacity' },
  { layerId: BASEMAP_LAYER_IDS.boundary2, property: 'line-color' },
  { layerId: BASEMAP_LAYER_IDS.boundary2, property: 'line-opacity' },
]

const STANDARD_BASEMAP_PAINTS = readStandardBasemapPaints(BASEMAP_THEME_PAINT_KEYS)

const SATELLITE_CONTEXT_LAYER_IDS = new Set([
  'precipitation_rate',
  'accumulated_precipitation',
  'cloud_layers',
  'cloud_cover',
  'observed_radar_composite_reflectivity',
  'composite_reflectivity',
])

const SATELLITE_CONTEXT_BASEMAP_PAINT_OVERRIDES: readonly BasemapPaint[] = [
  { layerId: BASEMAP_LAYER_IDS.background, property: 'background-color', value: 'rgb(10, 16, 23)' },
  { layerId: BASEMAP_LAYER_IDS.earthMask, property: 'fill-color', value: 'rgb(18, 25, 24)' },
  { layerId: BASEMAP_LAYER_IDS.water, property: 'fill-color', value: 'rgb(21, 36, 45)' },
  { layerId: BASEMAP_LAYER_IDS.water, property: 'fill-opacity', value: 0.08 },
  { layerId: BASEMAP_LAYER_IDS.satelliteBasemap, property: 'raster-opacity', value: 0.78 },
  { layerId: BASEMAP_LAYER_IDS.satelliteBasemap, property: 'raster-brightness-min', value: 0.02 },
  { layerId: BASEMAP_LAYER_IDS.satelliteBasemap, property: 'raster-brightness-max', value: 0.58 },
  { layerId: BASEMAP_LAYER_IDS.satelliteBasemap, property: 'raster-saturation', value: -0.48 },
  { layerId: BASEMAP_LAYER_IDS.satelliteBasemap, property: 'raster-contrast', value: -0.14 },
  { layerId: BASEMAP_LAYER_IDS.urbanAreaContext, property: 'fill-color', value: 'rgb(62, 70, 58)' },
  { layerId: BASEMAP_LAYER_IDS.urbanAreaContext, property: 'fill-opacity', value: 0.08 },
  { layerId: BASEMAP_LAYER_IDS.urbanAreaContext, property: 'fill-outline-color', value: 'rgba(230, 216, 171, 0.24)' },
  {
    layerId: BASEMAP_LAYER_IDS.cityContext,
    property: 'fill-color',
    value: [
      'match', ['get', 'kind'],
      ['commercial', 'industrial'], 'rgb(68, 70, 55)',
      'rgb(73, 80, 63)',
    ],
  },
  { layerId: BASEMAP_LAYER_IDS.cityContext, property: 'fill-opacity', value: 0.1 },
  { layerId: BASEMAP_LAYER_IDS.cityContext, property: 'fill-outline-color', value: 'rgba(230, 216, 171, 0.2)' },
  { layerId: BASEMAP_LAYER_IDS.urbanAreaOutline, property: 'line-color', value: 'rgb(213, 204, 158)' },
  { layerId: BASEMAP_LAYER_IDS.urbanAreaOutline, property: 'line-opacity', value: 0.2 },
  { layerId: BASEMAP_LAYER_IDS.coastlineShadow, property: 'line-color', value: 'rgb(6, 12, 16)' },
  { layerId: BASEMAP_LAYER_IDS.coastlineShadow, property: 'line-opacity', value: 0.28 },
  { layerId: BASEMAP_LAYER_IDS.lakeFill, property: 'fill-color', value: 'rgb(68, 108, 118)' },
  { layerId: BASEMAP_LAYER_IDS.lakeFill, property: 'fill-opacity', value: 0.12 },
  { layerId: BASEMAP_LAYER_IDS.coastline, property: 'line-color', value: 'rgb(222, 218, 180)' },
  { layerId: BASEMAP_LAYER_IDS.coastline, property: 'line-opacity', value: 0.5 },
  {
    layerId: BASEMAP_LAYER_IDS.coastline,
    property: 'line-width',
    value: ['interpolate', ['linear'], ['zoom'], 0, 0.85, 4, 1.15, 6, 1.35],
  },
  { layerId: BASEMAP_LAYER_IDS.lakeOutline, property: 'line-color', value: 'rgb(161, 215, 219)' },
  { layerId: BASEMAP_LAYER_IDS.lakeOutline, property: 'line-opacity', value: 0.36 },
  { layerId: BASEMAP_LAYER_IDS.riverOutline, property: 'line-color', value: 'rgb(134, 200, 207)' },
  { layerId: BASEMAP_LAYER_IDS.riverOutline, property: 'line-opacity', value: 0.38 },
  { layerId: BASEMAP_LAYER_IDS.roadMajor, property: 'line-color', value: 'rgb(219, 199, 149)' },
  {
    layerId: BASEMAP_LAYER_IDS.roadMajor,
    property: 'line-opacity',
    value: ['interpolate', ['linear'], ['zoom'], 4, 0.04, 5, 0.07, 6.25, 0.1, 7.25, 0.13, 8.25, 0.16, 9, 0.19, 10, 0.22],
  },
  { layerId: BASEMAP_LAYER_IDS.boundary4, property: 'line-color', value: 'rgb(231, 222, 179)' },
  {
    layerId: BASEMAP_LAYER_IDS.boundary4,
    property: 'line-opacity',
    value: ['interpolate', ['linear'], ['zoom'], 4, 0.22, 7, 0.34, 11, 0.42, 20, 0.48],
  },
  { layerId: BASEMAP_LAYER_IDS.boundary2, property: 'line-color', value: 'rgb(237, 229, 190)' },
  {
    layerId: BASEMAP_LAYER_IDS.boundary2,
    property: 'line-opacity',
    value: ['interpolate', ['linear'], ['zoom'], 0, 0.18, 4, 0.4, 10, 0.52],
  },
]

const BASEMAP_STYLES: Record<ForecastBasemapStyleId, ForecastBasemapStyle> = {
  standard: {
    id: 'standard',
    paints: STANDARD_BASEMAP_PAINTS,
    satelliteVisibility: 'none',
  },
  'satellite-context': {
    id: 'satellite-context',
    paints: mergePaintOverrides(
      STANDARD_BASEMAP_PAINTS,
      SATELLITE_CONTEXT_BASEMAP_PAINT_OVERRIDES,
    ),
    satelliteVisibility: 'visible',
  },
}

export function basemapStyleForForecastRasterLayer(selectedLayerId: string | null): ForecastBasemapStyleId {
  if (selectedLayerId && SATELLITE_CONTEXT_LAYER_IDS.has(selectedLayerId)) {
    return 'satellite-context'
  }
  return 'standard'
}

export function applyForecastBasemapStyle(map: MapLibreMap, styleId: ForecastBasemapStyleId): void {
  const style = BASEMAP_STYLES[styleId]

  for (const paint of style.paints) {
    if (!map.getLayer(paint.layerId)) continue
    map.setPaintProperty(paint.layerId, paint.property, cloneStyleValue(paint.value))
  }

  if (map.getLayer(BASEMAP_LAYER_IDS.satelliteBasemap)) {
    map.setLayoutProperty(
      BASEMAP_LAYER_IDS.satelliteBasemap,
      'visibility',
      style.satelliteVisibility,
    )
  }
}

function mergePaintOverrides(
  basePaints: readonly BasemapPaint[],
  overrides: readonly BasemapPaint[],
): BasemapPaint[] {
  const baseKeys = new Set(basePaints.map(paintKey))
  const overridesByKey = new Map<string, BasemapPaint>()

  for (const override of overrides) {
    const key = paintKey(override)
    if (!baseKeys.has(key)) {
      throw new Error(`Unknown basemap theme paint override ${key}`)
    }
    overridesByKey.set(key, override)
  }

  return basePaints.map((paint) => overridesByKey.get(paintKey(paint)) ?? paint)
}

function paintKey(paint: BasemapPaintKey): string {
  return `${paint.layerId}.${paint.property}`
}
