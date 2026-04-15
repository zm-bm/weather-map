import type { StyleSpecification } from 'maplibre-gl'

export const coreSources: NonNullable<StyleSpecification['sources']> = {
  openmaptiles: {
    type: 'vector',
    // hydrated by builder
    tiles: [],
  },
  coastline: {
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
