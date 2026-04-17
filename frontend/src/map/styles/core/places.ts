import type { StyleSpecification } from 'maplibre-gl'

export const corePlaceLayers: NonNullable<StyleSpecification['layers']> = [
  {
    id: 'place-country',
    type: 'symbol',
    source: 'basemap',
    'source-layer': 'place',
    minzoom: 3,
    filter: ['==', 'class', 'country'],
    layout: {
      // hydrated by builder (language)
      'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
      'text-font': ['Open Sans Bold'],
      'text-max-width': 6.25,
      'text-size': ['interpolate', ['linear'], ['zoom'], 0, 9, 2, 10, 7, 14],
      'text-transform': 'uppercase',
      'text-allow-overlap': false,
      'symbol-sort-key': ['coalesce', ['get', 'rank'], 1000],
      visibility: 'visible',
    },
    paint: {
      'text-color': 'rgba(132,132,132,1)',
      'text-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.58, 2, 0.64, 7, 0.78],
      'text-halo-width': ['interpolate', ['linear'], ['zoom'], 0, 0.75, 6, 0.95, 9, 1.2],
      'text-halo-color': 'rgba(247,247,247,0.9)',
      'text-halo-blur': 0,
    },
  },
  {
    id: 'place-city',
    type: 'symbol',
    source: 'basemap',
    'source-layer': 'place',
    minzoom: 4,
    filter: ['in', 'class', 'city', 'town'],
    layout: {
      'text-anchor': 'center',
      // hydrated by builder (language)
      'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
      'text-font': ['Open Sans Regular'],
      'text-max-width': 8,
      'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 9, 16],
      'text-allow-overlap': false,
      'symbol-sort-key': ['coalesce', ['get', 'rank'], 1000],
      visibility: 'visible',
    },
    paint: {
      'text-color': 'rgba(135,135,135,1)',
      'text-halo-width': [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        1.3,
        1.0,
      ],
      'text-halo-color': [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        'rgba(250,250,250,1.0)',
        'rgba(248,248,248,0.92)',
      ],
      'text-halo-blur': 0,
    },
  },
]
