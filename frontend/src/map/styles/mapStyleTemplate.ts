import type { StyleSpecification } from 'maplibre-gl'

import { coreSources } from './core/sources'
import { coreBackgroundTerrainLayers } from './core/backgroundTerrain'
import { coreBoundaryLayers } from './core/boundaries'
import { coreHydrographyLayers } from './core/hydrography'
import { corePlaceLayers } from './core/places'
import { coreTransportLayers } from './core/transport'

export const mapStyleTemplate: StyleSpecification = {
  version: 8,
  name: 'ZMBM - Weather Map',
  metadata: {
    'mapbox:type': 'template',
    'mapbox:groups': {},
    'mapbox:autocomposite': true,
    'openmaptiles:version': '3.x',
  },
  // "projection": { "type": "globe" },
  sources: coreSources,
  // hydrated by builder
  glyphs: '',
  layers: [
    ...coreBackgroundTerrainLayers,
    ...coreBoundaryLayers,
    ...coreTransportLayers,
    ...coreHydrographyLayers,
    ...corePlaceLayers,
  ],
}
