import type { StyleSpecification } from 'maplibre-gl'

export const coreTransportLayers: NonNullable<StyleSpecification['layers']> = [
  {
    id: 'highway-casing',
    type: 'line',
    source: 'basemap',
    'source-layer': 'transportation',
    minzoom: 5,
    filter: [
      'all',
      ['==', '$type', 'LineString'],
      ['!in', 'brunnel', 'tunnel'],
      ['!=', 'ramp', 1],
      ['in', 'class', 'motorway', 'trunk', 'primary'],
    ],
    layout: {
      'line-cap': 'butt',
      'line-join': 'round',
      visibility: 'none',
    },
    paint: {
      'line-color': 'rgba(64,64,64,0.22)',
      'line-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        4, 0,
        5, 0.1,
        9, 0.2,
      ],
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        4, 0,
        5, ['match', ['get', 'class'], 'motorway', 0.7, 0],
        6, ['match', ['get', 'class'], 'motorway', 1.1, 'trunk', 0.95, 'primary', 0.8, 0],
        7, ['match', ['get', 'class'], 'motorway', 1.6, 'trunk', 1.35, 'primary', 1.15, 0],
        9, ['match', ['get', 'class'], 'motorway', 2.4, 'trunk', 2.0, 'primary', 1.65, 0],
      ],
    },
  },
  {
    id: 'highway',
    type: 'line',
    source: 'basemap',
    'source-layer': 'transportation',
    minzoom: 5,
    filter: [
      'all',
      ['==', '$type', 'LineString'],
      ['!in', 'brunnel', 'tunnel'],
      ['!=', 'ramp', 1],
      ['in', 'class', 'motorway', 'trunk', 'primary'],
    ],
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
      visibility: 'visible',
    },
    paint: {
      'line-color': 'rgba(32,32,32,0.75)',
      'line-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        4, 0,
        5, 0.2,
        9, 0.30,
      ],
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        4, 0,
        5, ['match', ['get', 'class'], 'motorway', 0.4, 0],
        6, ['match', ['get', 'class'], 'motorway', 0.7, 'trunk', 0.6, 'primary', 0.5, 0],
        7, ['match', ['get', 'class'], 'motorway', 0.95, 'trunk', 0.82, 'primary', 0.7, 0],
        9, ['match', ['get', 'class'], 'motorway', 1.4, 'trunk', 1.2, 'primary', 1.0, 0],
      ],
    },
  },
]
