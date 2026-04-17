import type { StyleSpecification } from 'maplibre-gl'

import { joinUrl } from '../../../url/joinUrl'

const BASEMAP_SOURCE_ID = 'basemap' as const
const COASTLINE_SOURCE_ID = 'coastline' as const
const LAKE_SHORELINE_SOURCE_ID = 'lake-shoreline' as const
const BASEMAP_SOURCE_MAXZOOM = 6
const COASTLINE_SOURCE_MAXZOOM = 4
const LAKE_SHORELINE_SOURCE_MAXZOOM = 9

export const coreSources: NonNullable<StyleSpecification['sources']> = {
  [BASEMAP_SOURCE_ID]: {
    type: 'vector',
    // hydrated by builder
    tiles: [],
  },
  [COASTLINE_SOURCE_ID]: {
    type: 'vector',
    // hydrated by builder
    tiles: [],
    maxzoom: COASTLINE_SOURCE_MAXZOOM,
  },
  [LAKE_SHORELINE_SOURCE_ID]: {
    type: 'vector',
    // hydrated by builder
    tiles: [],
  },
  'esri-hillshade': {
    type: 'raster',
    tiles: [
      'https://services.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    attribution: 'esri',
  },
}

export function hydrateCoreSources(style: StyleSpecification, serverUrl: string): void {
  const basemapSource = style.sources?.[BASEMAP_SOURCE_ID]
  if (basemapSource?.type === 'vector') {
    basemapSource.tiles = [joinUrl(serverUrl, 'basemap-vector/{z}/{x}/{y}')]
    basemapSource.maxzoom = BASEMAP_SOURCE_MAXZOOM
  }

  const coastlineSource = style.sources?.[COASTLINE_SOURCE_ID]
  if (coastlineSource?.type === 'vector') {
    coastlineSource.tiles = [joinUrl(serverUrl, 'coastline-simplified/{z}/{x}/{y}')]
    coastlineSource.maxzoom = COASTLINE_SOURCE_MAXZOOM
  }

  const lakeShorelineSource = style.sources?.[LAKE_SHORELINE_SOURCE_ID]
  if (lakeShorelineSource?.type === 'vector') {
    lakeShorelineSource.tiles = [joinUrl(serverUrl, 'lake-shoreline/{z}/{x}/{y}')]
    lakeShorelineSource.maxzoom = LAKE_SHORELINE_SOURCE_MAXZOOM
  }
}
