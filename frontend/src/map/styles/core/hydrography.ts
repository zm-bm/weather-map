import type { StyleSpecification } from 'maplibre-gl'

export const coreHydrographyLayers: NonNullable<StyleSpecification['layers']> = [
  // Coastline high-zoom tuning note:
  // The z9 stops below are the current "locked" look that we like.
  // If z8 feels too smeary, prefer adjusting the z8 stops or the source
  // simplification before changing the z9 values.
  {
    id: 'coast-shadow-inner',
    type: 'line',
    source: 'coastline',
    'source-layer': 'coastline',
    filter: ['==', '$type', 'LineString'],
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
      visibility: 'visible',
    },
    paint: {
      // Keep the z9 stop values here as the reference target while tuning z8.
      'line-color': 'rgba(36, 48, 64, 0.72)',
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.34, 3, 0.42, 6, 0.34, 8, 0.22, 9, 0.22],
      'line-width': ['interpolate', ['linear'], ['zoom'], 0, 1.2, 3, 1.6, 6, 2.2, 8, 2.25, 9, 2.65],
      'line-offset': ['interpolate', ['linear'], ['zoom'], 0, -0.55, 3, -0.8, 6, -1.15, 8, -0.95, 9, -1.15],
      'line-blur': 0.35,
    },
  },
  {
    id: 'coast-shadow-mid',
    type: 'line',
    source: 'coastline',
    'source-layer': 'coastline',
    filter: ['==', '$type', 'LineString'],
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
      visibility: 'visible',
    },
    paint: {
      // Keep the z9 stop values here as the reference target while tuning z8.
      'line-color': 'rgba(44, 58, 76, 0.44)',
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.22, 3, 0.28, 6, 0.22, 8, 0.11, 9, 0.1],
      'line-width': ['interpolate', ['linear'], ['zoom'], 0, 2.8, 3, 3.6, 6, 5.0, 8, 4.7, 9, 5.9],
      'line-offset': ['interpolate', ['linear'], ['zoom'], 0, -1.3, 3, -1.8, 6, -2.7, 8, -2.1, 9, -2.8],
      'line-blur': 0.75,
    },
  },
  {
    id: 'coast-shadow-outer',
    type: 'line',
    source: 'coastline',
    'source-layer': 'coastline',
    filter: ['==', '$type', 'LineString'],
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
      visibility: 'visible',
    },
    paint: {
      // Keep the z9 stop values here as the reference target while tuning z8.
      'line-color': 'rgba(60, 74, 92, 0.22)',
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.14, 3, 0.18, 6, 0.14, 8, 0.05, 9, 0.06],
      'line-width': ['interpolate', ['linear'], ['zoom'], 0, 4.8, 3, 6.2, 6, 8.6, 8, 7.2, 9, 9.6],
      'line-offset': ['interpolate', ['linear'], ['zoom'], 0, -2.5, 3, -3.4, 6, -4.8, 8, -3.2, 9, -4.8],
      'line-blur': 1.1,
    },
  },
  {
    id: 'coast-outline',
    type: 'line',
    source: 'coastline',
    'source-layer': 'coastline',
    filter: ['==', '$type', 'LineString'],
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
      visibility: 'visible',
    },
    paint: {
      // Keep the z9 stop values here as the reference target while tuning z8.
      'line-color': 'rgba(58,58,58,1)',
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.42, 2, 0.5, 5, 0.65, 8, 0.64, 9, 0.68],
      'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.3, 2, 0.42, 5, 0.75, 8, 0.78, 9, 0.9],
    },
  },
  {
    id: 'lake-shadow-inner',
    type: 'line',
    source: 'lake-shoreline',
    'source-layer': 'lake_shoreline',
    filter: ['==', '$type', 'LineString'],
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
      visibility: 'visible',
    },
    paint: {
      'line-color': 'rgba(36, 48, 64, 0.56)',
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.18, 3, 0.22, 6, 0.2, 8, 0.16, 9, 0.14],
      'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.9, 3, 1.2, 6, 1.6, 8, 1.9, 9, 2.1],
      'line-offset': ['interpolate', ['linear'], ['zoom'], 0, -0.35, 3, -0.5, 6, -0.7, 8, -0.82, 9, -0.95],
      'line-blur': 0.28,
    },
  },
  {
    id: 'lake-shadow-mid',
    type: 'line',
    source: 'lake-shoreline',
    'source-layer': 'lake_shoreline',
    filter: ['==', '$type', 'LineString'],
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
      visibility: 'visible',
    },
    paint: {
      'line-color': 'rgba(44, 58, 76, 0.32)',
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.12, 3, 0.16, 6, 0.14, 8, 0.1, 9, 0.08],
      'line-width': ['interpolate', ['linear'], ['zoom'], 0, 1.9, 3, 2.5, 6, 3.4, 8, 3.7, 9, 4.0],
      'line-offset': ['interpolate', ['linear'], ['zoom'], 0, -0.8, 3, -1.05, 6, -1.55, 8, -1.75, 9, -1.95],
      'line-blur': 0.65,
    },
  },
  {
    id: 'lake-shadow-outer',
    type: 'line',
    source: 'lake-shoreline',
    'source-layer': 'lake_shoreline',
    filter: ['==', '$type', 'LineString'],
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
      visibility: 'visible',
    },
    paint: {
      'line-color': 'rgba(60, 74, 92, 0.18)',
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.08, 3, 0.11, 6, 0.1, 8, 0.07, 9, 0.05],
      'line-width': ['interpolate', ['linear'], ['zoom'], 0, 3.2, 3, 4.2, 6, 5.5, 8, 5.9, 9, 6.4],
      'line-offset': ['interpolate', ['linear'], ['zoom'], 0, -1.55, 3, -2.05, 6, -2.9, 8, -3.15, 9, -3.45],
      'line-blur': 1.0,
    },
  },
  {
    id: 'lake-outline',
    type: 'line',
    source: 'lake-shoreline',
    'source-layer': 'lake_shoreline',
    minzoom: 5,
    filter: ['==', '$type', 'LineString'],
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
      visibility: 'visible',
    },
    paint: {
      'line-color': 'rgba(58,58,58,1)',
      'line-opacity': [
        'interpolate', ['linear'], ['zoom'],
        0, 0.1,
        5, 0.14,
        7, 0.16,
        8, 0.18,
        9, 0.16,
      ],
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        0, 0.18,
        5, 0.28,
        7, 0.34,
        8, 0.4,
        9, 0.44,
      ],
    },
  },
  {
    id: 'river-outline',
    type: 'line',
    source: 'basemap',
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
      'line-color': 'rgba(82,82,82,1)',
      'line-opacity': [
        'interpolate', ['linear'], ['zoom'],
        0, 0.28,
        2, 0.34,
        5, 0.48,
        9, 0.62,
      ],
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        0, 0.22,
        2, 0.28,
        5, 0.55,
        10, 1.1,
      ],
    },
  },
]
