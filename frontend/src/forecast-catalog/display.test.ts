import { describe, expect, it } from 'vitest'

import { asArtifactId } from '../forecast-manifest'
import { FORECAST_LAYERS, asLayerGroupId, asLayerId, type LayerSpec } from './layer'
import {
  createActiveRunFixture,
  createSingleTimeManifestFixture,
  createScalarArtifactFixture,
  createVectorArtifactFixture,
} from '../test/fixtures'
import { getLayerMeta, getLayerStyleByPaletteId } from './display'

describe('layer metadata palettes', () => {
  it('resolves layer colortables from frontend catalog palette ids', () => {
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

    const meta = getLayerMeta('custom_pressure', { custom_pressure: layer }, createActiveRunFixture(manifest))

    expect(meta.label).toBe('Custom Pressure')
    expect(meta.paletteId).toBe('pressure.msl.pa.v1')
    expect(meta.unitBehavior).toBe('pressure')
    expect(meta.legendScale).toBe('pressure')
    expect(meta.colortable).toBe(getLayerStyleByPaletteId('pressure.msl.pa.v1').colortable)
  })

  it('resolves every catalog layer palette', () => {
    for (const layer of FORECAST_LAYERS) {
      expect(getLayerStyleByPaletteId(layer.paletteId).colortable.length).toBeGreaterThan(0)
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

    const meta = getLayerMeta('wind_speed', { wind_speed: layer }, createActiveRunFixture(manifest))

    expect(meta.label).toBe('Wind Speed')
    expect(meta.units).toBe('m/s')
    expect(meta.parameter).toBe('wind_speed')
    expect(meta.colortable).toBe(getLayerStyleByPaletteId('wind.gust.mps.v1').colortable)
  })

  it('rejects layers with unknown palette ids', () => {
    const layer: LayerSpec = {
      id: asLayerId('custom_layer'),
      label: 'Custom Layer',
      groupId: asLayerGroupId('temperature'),
      paletteId: 'missing.palette.v1',
      displayRange: { min: 0, max: 1 },
      unitBehavior: 'temperature',
      legendScale: 'temperature',
      source: { kind: 'artifact', artifactId: asArtifactId('tmp_surface') },
      overlays: [],
    }

    const manifest = createSingleTimeManifestFixture({
      artifacts: {
        tmp_surface: createScalarArtifactFixture(),
      },
    })

    expect(() => getLayerMeta('custom_layer', { custom_layer: layer }, createActiveRunFixture(manifest)))
      .toThrow('Unknown layer paletteId: missing.palette.v1')
  })
})
