import type { StyleSpecification } from 'maplibre-gl'

export const coreHydrographyLayers: NonNullable<StyleSpecification['layers']> = [
  {
    id: 'coast-shadow',
    type: 'line',
    source: 'coastline',
    'source-layer': 'coastline',
    filter: ['==', '$type', 'LineString'],
    layout: {
      'line-cap': 'butt',
      'line-join': 'miter',
      visibility: 'none',
    },
    paint: {
      'line-color': 'rgba(0,0,0,0.3)',
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.10, 9, 0.05],
      'line-width': ['interpolate', ['linear'], ['zoom'], 0, 1.0, 9, 4.0],
      'line-offset': ['interpolate', ['linear'], ['zoom'], 0, -0.5, 9, -2.0],
      'line-blur': 4.0,
    },
  },
  {
    id: 'coast-outline',
    type: 'line',
    source: 'coastline',
    'source-layer': 'coastline',
    filter: ['==', '$type', 'LineString'],
    layout: {
      'line-cap': 'butt',
      'line-join': 'miter',
      visibility: 'visible',
    },
    paint: {
      'line-color': 'rgba(0,0,0,1)',
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.25, 5, 0.50],
      'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.40, 5, 0.80, 9, 1.2],
    },
  },
  {
    id: 'lake-shadow',
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'water',
    filter: [
      'all',
      ['==', '$type', 'Polygon'],
      ['==', 'class', 'lake'],
    ],
    layout: {
      'line-cap': 'butt',
      'line-join': 'miter',
      visibility: 'none',
    },
    paint: {
      'line-color': 'rgba(0,0,0,0.3)',
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.10, 9, 0.05],
      'line-width': ['interpolate', ['linear'], ['zoom'], 0, 1.0, 9, 5.0],
      'line-offset': ['interpolate', ['linear'], ['zoom'], 0, -0.5, 9, -2.5],
      'line-blur': 4.0,
    },
  },
  {
    id: 'lake-outline',
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'water',
    filter: [
      'all',
      ['==', '$type', 'Polygon'],
      ['in', 'class', 'lake'],
    ],
    layout: {
      'line-cap': 'butt',
      'line-join': 'miter',
      visibility: 'visible',
    },
    paint: {
      'line-color': 'rgba(0,0,0,1)',
      'line-opacity': [
        'interpolate', ['linear'], ['zoom'],
        0, 0.08,
        5, 0.12,
        7, 0.10,
        9, 0.06,
      ],
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        0, 0.20,
        5, 0.35,
        7, 0.45,
        9, 0.50,
      ],
    },
  },
  {
    id: 'river-outline',
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'waterway',
    minzoom: 6,
    filter: [
      'all',
      ['==', 'class', 'river'],
      ['!=', 'brunnel', 'tunnel'],
    ],
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
      visibility: 'visible',
    },
    paint: {
      'line-color': 'rgba(0,0,0,1)',
      'line-opacity': [
        'interpolate', ['linear'], ['zoom'],
        4, 0.00,
        6, 0.08,
        8, 0.12,
        9, 0.10,
      ],
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        4, 0.00,
        6, 0.25,
        8, 0.45,
        9, 0.55,
      ],
    },
  },
]
