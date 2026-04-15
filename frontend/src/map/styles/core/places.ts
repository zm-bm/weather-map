import type { StyleSpecification } from 'maplibre-gl'

export const corePlaceLayers: NonNullable<StyleSpecification['layers']> = [
  {
    id: 'place-country',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'place',
    filter: ['==', 'class', 'country'],
    layout: {
      // hydrated by builder (language)
      'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
      'text-font': ['Open Sans Bold'],
      'text-max-width': 6.25,
      'text-size': ['interpolate', ['linear'], ['zoom'], 0, 12, 7, 16],
      'text-transform': 'uppercase',
      'text-allow-overlap': false,
      'symbol-sort-key': ['coalesce', ['get', 'rank'], 1000],
      visibility: 'visible',
    },
    paint: {
      'text-color': '#ffffff',
      'text-opacity': 0.75,
      'text-halo-width': ['interpolate', ['linear'], ['zoom'], 0, 1.2, 6, 1.4, 9, 1.8],
      'text-halo-color': 'rgba(0,0,0,0.85)',
      'text-halo-blur': 0,
    },
  },
  {
    id: 'place-city',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'place',
    filter: ['in', 'class', 'city', 'town'],
    layout: {
      'text-anchor': 'center',
      // hydrated by builder (language)
      'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
      'text-font': ['Open Sans Regular'],
      'text-max-width': 8,
      'text-size': ['interpolate', ['linear'], ['zoom'], 0, 12, 9, 18],
      'text-allow-overlap': false,
      'symbol-sort-key': ['coalesce', ['get', 'rank'], 1000],
      visibility: 'visible',
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-width': [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        1.6,
        1.4,
      ],
      'text-halo-color': [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        'rgba(0,0,0,1.0)',
        'rgba(0,0,0,0.75)',
      ],
      'text-halo-blur': 0,
    },
  },
]
