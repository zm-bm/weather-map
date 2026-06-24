import type { Map as MapLibreMap } from 'maplibre-gl'

import { BASEMAP_LAYER_IDS } from '../basemap'
import {
  cloneStyleValue,
  readStandardBasemapPaints,
  type BasemapPaint,
  type BasemapPaintKey,
} from './basemapStyle'

export type ForecastBasemapStyleId = 'standard' | 'cloud-layers'

type ForecastBasemapStyle = {
  id: ForecastBasemapStyleId
  paints: readonly BasemapPaint[]
}

export const BASEMAP_THEME_PAINT_KEYS: readonly BasemapPaintKey[] = [
  { layerId: BASEMAP_LAYER_IDS.background, property: 'background-color' },
  { layerId: BASEMAP_LAYER_IDS.earthMask, property: 'fill-color' },
  { layerId: BASEMAP_LAYER_IDS.water, property: 'fill-color' },
  { layerId: BASEMAP_LAYER_IDS.water, property: 'fill-opacity' },
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

const CLOUD_LAYERS_BASEMAP_PAINT_OVERRIDES: readonly BasemapPaint[] = [
  { layerId: BASEMAP_LAYER_IDS.background, property: 'background-color', value: 'rgb(143, 137, 102)' },
  { layerId: BASEMAP_LAYER_IDS.earthMask, property: 'fill-color', value: 'rgb(143, 137, 102)' },
  { layerId: BASEMAP_LAYER_IDS.water, property: 'fill-color', value: 'rgb(150, 156, 149)' },
  { layerId: BASEMAP_LAYER_IDS.water, property: 'fill-opacity', value: 0.74 },
  { layerId: BASEMAP_LAYER_IDS.urbanAreaContext, property: 'fill-color', value: 'rgb(91, 86, 65)' },
  { layerId: BASEMAP_LAYER_IDS.urbanAreaContext, property: 'fill-opacity', value: 0.13 },
  { layerId: BASEMAP_LAYER_IDS.urbanAreaContext, property: 'fill-outline-color', value: 'rgba(47, 49, 39, 0.34)' },
  {
    layerId: BASEMAP_LAYER_IDS.cityContext,
    property: 'fill-color',
    value: [
      'match', ['get', 'kind'],
      ['commercial', 'industrial'], 'rgb(84, 78, 58)',
      'rgb(91, 86, 64)',
    ],
  },
  { layerId: BASEMAP_LAYER_IDS.cityContext, property: 'fill-opacity', value: 0.16 },
  { layerId: BASEMAP_LAYER_IDS.cityContext, property: 'fill-outline-color', value: 'rgba(45, 47, 38, 0.32)' },
  { layerId: BASEMAP_LAYER_IDS.urbanAreaOutline, property: 'line-color', value: 'rgb(46, 48, 39)' },
  { layerId: BASEMAP_LAYER_IDS.urbanAreaOutline, property: 'line-opacity', value: 0.24 },
  { layerId: BASEMAP_LAYER_IDS.coastlineShadow, property: 'line-color', value: 'rgb(32, 36, 31)' },
  { layerId: BASEMAP_LAYER_IDS.coastlineShadow, property: 'line-opacity', value: 0.34 },
  { layerId: BASEMAP_LAYER_IDS.lakeFill, property: 'fill-color', value: 'rgb(110, 143, 137)' },
  { layerId: BASEMAP_LAYER_IDS.lakeFill, property: 'fill-opacity', value: 0.3 },
  { layerId: BASEMAP_LAYER_IDS.coastline, property: 'line-color', value: 'rgb(41, 45, 40)' },
  { layerId: BASEMAP_LAYER_IDS.coastline, property: 'line-opacity', value: 0.92 },
  {
    layerId: BASEMAP_LAYER_IDS.coastline,
    property: 'line-width',
    value: ['interpolate', ['linear'], ['zoom'], 0, 0.85, 4, 1.25, 6, 1.45],
  },
  { layerId: BASEMAP_LAYER_IDS.lakeOutline, property: 'line-color', value: 'rgb(41, 45, 40)' },
  { layerId: BASEMAP_LAYER_IDS.lakeOutline, property: 'line-opacity', value: 0.58 },
  { layerId: BASEMAP_LAYER_IDS.riverOutline, property: 'line-color', value: 'rgb(55, 83, 80)' },
  { layerId: BASEMAP_LAYER_IDS.riverOutline, property: 'line-opacity', value: 0.6 },
  { layerId: BASEMAP_LAYER_IDS.roadMajor, property: 'line-color', value: 'rgb(70, 64, 46)' },
  {
    layerId: BASEMAP_LAYER_IDS.roadMajor,
    property: 'line-opacity',
    value: ['interpolate', ['linear'], ['zoom'], 4, 0.07, 5, 0.12, 6.25, 0.16, 7.25, 0.21, 8.25, 0.26, 9, 0.30, 10, 0.34],
  },
  { layerId: BASEMAP_LAYER_IDS.boundary4, property: 'line-color', value: 'rgb(74, 76, 63)' },
  {
    layerId: BASEMAP_LAYER_IDS.boundary4,
    property: 'line-opacity',
    value: ['interpolate', ['linear'], ['zoom'], 4, 0.40, 7, 0.54, 11, 0.60, 20, 0.64],
  },
  { layerId: BASEMAP_LAYER_IDS.boundary2, property: 'line-color', value: 'rgb(41, 45, 40)' },
  {
    layerId: BASEMAP_LAYER_IDS.boundary2,
    property: 'line-opacity',
    value: ['interpolate', ['linear'], ['zoom'], 0, 0.34, 4, 0.64, 10, 0.74],
  },
]

const BASEMAP_STYLES: Record<ForecastBasemapStyleId, ForecastBasemapStyle> = {
  standard: {
    id: 'standard',
    paints: STANDARD_BASEMAP_PAINTS,
  },
  'cloud-layers': {
    id: 'cloud-layers',
    paints: mergePaintOverrides(
      STANDARD_BASEMAP_PAINTS,
      CLOUD_LAYERS_BASEMAP_PAINT_OVERRIDES,
    ),
  },
}

export function basemapStyleForForecastRasterLayer(selectedLayerId: string | null): ForecastBasemapStyleId {
  if (selectedLayerId === 'cloud_layers') return 'cloud-layers'
  return 'standard'
}

export function applyForecastBasemapStyle(map: MapLibreMap, styleId: ForecastBasemapStyleId): void {
  const style = BASEMAP_STYLES[styleId]

  for (const paint of style.paints) {
    if (!map.getLayer(paint.layerId)) continue
    map.setPaintProperty(paint.layerId, paint.property, cloneStyleValue(paint.value))
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
