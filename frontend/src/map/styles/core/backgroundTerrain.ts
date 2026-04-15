import type { StyleSpecification } from 'maplibre-gl'

export const coreBackgroundTerrainLayers: NonNullable<StyleSpecification['layers']> = [
  {
    id: 'background',
    type: 'background',
    paint: { 'background-color': '#ffffff' },
  },
  {
    id: 'esri-hillshade',
    type: 'raster',
    source: 'esri-hillshade',
    minzoom: 0,
    maxzoom: 10,
    paint: {
      'raster-opacity': 1.0,
      'raster-saturation': -1,
      'raster-contrast': 0.05,
      'raster-brightness-min': 0.0,
      'raster-brightness-max': 1.0,
    },
  },
  {
    id: 'water-fill',
    type: 'fill',
    source: 'openmaptiles',
    'source-layer': 'water',
    filter: ['==', '$type', 'Polygon'],
    paint: { 'fill-color': '#d8d8d8' },
  },
]
