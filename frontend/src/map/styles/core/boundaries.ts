import type { StyleSpecification } from 'maplibre-gl'

export const coreBoundaryLayers: NonNullable<StyleSpecification['layers']> = [
  {
    id: 'boundary-land-level-2',
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'boundary',
    filter: [
      'all',
      ['==', 'admin_level', 2],
      ['!=', 'maritime', 1],
    ],
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
      visibility: 'visible',
    },
    paint: {
      'line-color': '#000000',
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 9, 0.8],
      'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.6, 5, 1.2, 10, 1.8],
    },
  },
  {
    id: 'boundary-land-level-4',
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'boundary',
    minzoom: 2,
    filter: [
      'all',
      ['>=', 'admin_level', 3],
      ['<=', 'admin_level', 4],
      ['!=', 'maritime', 1],
    ],
    layout: {
      'line-join': 'round',
      visibility: 'visible',
    },
    paint: {
      'line-color': '#000000',
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 9, 0.8],
      'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 5, 1.0, 10, 1.5],
      'line-dasharray': [3, 1, 1, 1],
    },
  },
]
