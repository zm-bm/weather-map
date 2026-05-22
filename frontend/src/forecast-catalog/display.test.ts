import { describe, expect, it } from 'vitest'

import { asArtifactId } from '../forecast-manifest'
import { FORECAST_LAYERS, asLayerGroupId, asLayerId, type LayerSpec } from './layer'
import {
  createActiveRunFixture,
  createSingleTimeManifestFixture,
  createScalarArtifactFixture,
  createVectorArtifactFixture,
} from '../test/fixtures'
import { getLayerPalette } from '../forecast-palette'
import { getLayerDisplay } from './display'

describe('layer metadata palettes', () => {
  it('resolves layer color stops from frontend catalog palette ids', () => {
    const layer: LayerSpec = {
      id: asLayerId('custom_pressure'),
      label: 'Custom Pressure',
      groupId: asLayerGroupId('wind_pressure'),
      paletteId: 'pressure.msl.pa.v1',
      displayRange: { min: 98_000, max: 103_600 },
      unitBehavior: 'pressure',
      legendScale: 'pressure',
      source: { kind: 'artifact', artifactId: asArtifactId('prmsl_msl') },
      overlays: [],
    }
    const artifact = createScalarArtifactFixture({
      id: 'prmsl_msl',
      units: 'Pa',
      parameter: 'prmsl',
    })

    const manifest = createSingleTimeManifestFixture({ artifacts: { prmsl_msl: artifact } })

    const display = getLayerDisplay('custom_pressure', { custom_pressure: layer }, createActiveRunFixture(manifest))

    expect(display.label).toBe('Custom Pressure')
    expect(display.paletteId).toBe('pressure.msl.pa.v1')
    expect(display.unitBehavior).toBe('pressure')
    expect(display.legendScale).toBe('pressure')
    expect(display.colorStops).toBe(getLayerPalette('pressure.msl.pa.v1').colorStops)
  })

  it('resolves every catalog layer palette', () => {
    for (const layer of FORECAST_LAYERS) {
      expect(getLayerPalette(layer.paletteId).colorStops.length).toBeGreaterThan(0)
    }
  })

  it('resolves frontend-derived wind speed metadata from the vector source artifact', () => {
    const layer: LayerSpec = {
      id: asLayerId('wind_speed'),
      label: 'Wind Speed',
      groupId: asLayerGroupId('wind_pressure'),
      paletteId: 'wind.gust.mps.v1',
      displayRange: { min: 0, max: 60 },
      unitBehavior: 'wind-speed',
      legendScale: 'stop-based',
      source: { kind: 'derived', artifactId: asArtifactId('wind10m_uv'), recipe: 'wind-speed' },
      overlays: [],
      parameter: 'wind_speed',
    }

    const manifest = createSingleTimeManifestFixture({
      artifacts: {
        wind10m_uv: createVectorArtifactFixture({
          units: 'm/s',
          parameter: 'vector',
        }),
      },
    })

    const display = getLayerDisplay('wind_speed', { wind_speed: layer }, createActiveRunFixture(manifest))

    expect(display.label).toBe('Wind Speed')
    expect(display.units).toBe('m/s')
    expect(display.parameter).toBe('wind_speed')
    expect(display.colorStops).toBe(getLayerPalette('wind.gust.mps.v1').colorStops)
  })

})
