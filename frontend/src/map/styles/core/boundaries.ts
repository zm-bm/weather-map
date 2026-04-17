import type { StyleSpecification } from 'maplibre-gl'

export const coreBoundaryLayers: NonNullable<StyleSpecification['layers']> = [
  {
    id: 'boundary-land-level-2',
    type: 'line',
    source: 'basemap',
    'source-layer': 'boundary',
    filter: [
      'all',
      ['==', 'admin_level', 2],
      [
        'none',
        ['==', 'maritime', 1],
        ['==', 'maritime', true],
        ['==', 'maritime', '1'],
        ['==', 'maritime', 'true'],
        ['==', 'maritime', 'yes'],
        ['==', 'border_type', 'territorial'],
      ],
    ],
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
      visibility: 'visible',
    },
    paint: {
      'line-color': 'rgba(82,82,82,1)',
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.28, 2, 0.34, 5, 0.48, 9, 0.62],
      'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.22, 2, 0.28, 5, 0.55, 10, 1.1],
    },
  },
  {
    id: 'boundary-land-level-4',
    type: 'line',
    source: 'basemap',
    'source-layer': 'boundary',
    minzoom: 5,
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
      'line-color': 'rgba(90,90,90,1)',
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.14, 6, 0.22, 9, 0.36],
      'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.18, 6, 0.3, 10, 0.65],
      'line-dasharray': [3, 1, 1, 1],
    },
  },
]
