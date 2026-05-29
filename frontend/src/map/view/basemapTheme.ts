import type { Map as MapLibreMap } from 'maplibre-gl'

import { BASEMAP_LAYER_IDS } from '../basemap'
import {
  readStandardBasemapPaints,
  type BasemapPaint,
  type BasemapPaintKey,
  type BasemapPaintValue,
} from './basemapStyle'

export type ForecastBasemapStyleId = 'standard' | 'cloud-layers'

type ForecastBasemapStyle = {
  id: ForecastBasemapStyleId
  paints: readonly BasemapPaint[]
}

export const BASEMAP_THEME_PAINT_KEYS: readonly BasemapPaintKey[] = [
  { layerId: BASEMAP_LAYER_IDS.background, property: 'background-color' },
  { layerId: BASEMAP_LAYER_IDS.water, property: 'fill-color' },
  { layerId: BASEMAP_LAYER_IDS.water, property: 'fill-opacity' },
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
  { layerId: BASEMAP_LAYER_IDS.water, property: 'fill-color', value: 'rgb(150, 156, 149)' },
  { layerId: BASEMAP_LAYER_IDS.water, property: 'fill-opacity', value: 0.74 },
  { layerId: BASEMAP_LAYER_IDS.coastline, property: 'line-color', value: 'rgb(41, 45, 40)' },
  { layerId: BASEMAP_LAYER_IDS.coastline, property: 'line-opacity', value: 0.92 },
  {
    layerId: BASEMAP_LAYER_IDS.coastline,
    property: 'line-width',
    value: ['interpolate', ['linear'], ['zoom'], 0, 0.85, 4, 1.25, 6, 1.45],
  },
  { layerId: BASEMAP_LAYER_IDS.lakeOutline, property: 'line-color', value: 'rgb(41, 45, 40)' },
  { layerId: BASEMAP_LAYER_IDS.lakeOutline, property: 'line-opacity', value: 0.74 },
  { layerId: BASEMAP_LAYER_IDS.riverOutline, property: 'line-color', value: 'rgb(74, 76, 63)' },
  { layerId: BASEMAP_LAYER_IDS.riverOutline, property: 'line-opacity', value: 0.48 },
  { layerId: BASEMAP_LAYER_IDS.roadMajor, property: 'line-color', value: 'rgb(86, 80, 54)' },
  { layerId: BASEMAP_LAYER_IDS.roadMajor, property: 'line-opacity', value: 0.14 },
  { layerId: BASEMAP_LAYER_IDS.boundary4, property: 'line-color', value: 'rgb(74, 76, 63)' },
  {
    layerId: BASEMAP_LAYER_IDS.boundary4,
    property: 'line-opacity',
    value: ['interpolate', ['linear'], ['zoom'], 4, 0.36, 7, 0.5, 11, 0.58, 20, 0.64],
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
    map.setPaintProperty(paint.layerId, paint.property, paintValueForMap(paint.value))
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

function paintValueForMap(value: BasemapPaintValue): BasemapPaintValue {
  return Array.isArray(value)
    ? JSON.parse(JSON.stringify(value)) as BasemapPaintValue
    : value
}
