import { describe, expect, it } from 'vitest'

import { asArtifactId } from '../manifest'
import { asLayerId, type LayerSpec } from './layer'
import {
  createFrameManifestFixture,
  createScalarArtifactFixture,
  createVectorArtifactFixture,
} from '../test/fixtures'
import { getLayerMeta, getLayerStyleByPaletteId } from './display'

describe('layer metadata palettes', () => {
  it('resolves layer colortables from frontend catalog palette ids', () => {
    const layer: LayerSpec = {
      id: asLayerId('custom_pressure'),
      label: 'Custom Pressure',
      groupId: 'wind',
      paletteId: 'pressure.msl.pa.v1',
      displayRange: { min: 98_000, max: 103_500 },
      unitBehavior: 'pressure',
      legendScale: 'pressure',
      source: { kind: 'artifact', artifactId: asArtifactId('prmsl_surface') },
    }
    const artifact = createScalarArtifactFixture({
      id: 'prmsl_surface',
      units: 'Pa',
      parameter: 'prmsl',
    })

    const manifest = createFrameManifestFixture({ artifacts: { prmsl_surface: artifact } })

    const meta = getLayerMeta('custom_pressure', { custom_pressure: layer }, manifest)

    expect(meta.label).toBe('Custom Pressure')
    expect(meta.paletteId).toBe('pressure.msl.pa.v1')
    expect(meta.unitBehavior).toBe('pressure')
    expect(meta.legendScale).toBe('pressure')
    expect(meta.colortable).toBe(getLayerStyleByPaletteId('pressure.msl.pa.v1').colortable)
  })

  it('resolves first-pass direct-band layer palettes', () => {
    expect(getLayerStyleByPaletteId('snow.depth.m.v1').colortable.length).toBeGreaterThan(0)
    expect(getLayerStyleByPaletteId('atmosphere.visibility.m.v1').colortable.length).toBeGreaterThan(0)
    expect(getLayerStyleByPaletteId('atmosphere.freezing_level.m.v1').colortable.length).toBeGreaterThan(0)
    expect(getLayerStyleByPaletteId('atmosphere.precipitable_water.mm.v1').colortable.length).toBeGreaterThan(0)
    expect(getLayerStyleByPaletteId('severe.cape.jkg.v1').colortable.length).toBeGreaterThan(0)
  })

  it('resolves classified precipitation rate palettes with matching breakpoints', () => {
    const base = getLayerStyleByPaletteId('precip.rate.mm_hr.v1').colortable
    const snow = getLayerStyleByPaletteId('precip.rate.snow.mm_hr.v1').colortable
    const wintryMix = getLayerStyleByPaletteId('precip.rate.wintry_mix.mm_hr.v1').colortable

    expect(snow.map((stop) => stop[0])).toEqual(base.map((stop) => stop[0]))
    expect(wintryMix.map((stop) => stop[0])).toEqual(base.map((stop) => stop[0]))
    expect(snow[2]?.slice(1)).not.toEqual(base[2]?.slice(1))
  })

  it('resolves frontend-derived wind speed metadata from the vector source artifact', () => {
    const layer: LayerSpec = {
      id: asLayerId('wind_speed_surface'),
      label: 'Wind Speed',
      groupId: 'wind',
      paletteId: 'wind.gust.mps.v1',
      displayRange: { min: 0, max: 60 },
      unitBehavior: 'wind-speed',
      legendScale: 'stop-based',
      source: { kind: 'derived', artifactId: asArtifactId('wind10m_uv'), recipe: 'wind-speed' },
      parameter: 'wind_speed',
    }

    const manifest = createFrameManifestFixture({
      artifacts: {
        wind10m_uv: createVectorArtifactFixture({
          units: 'm/s',
          parameter: 'vector',
        }),
      },
    })

    const meta = getLayerMeta('wind_speed_surface', { wind_speed_surface: layer }, manifest)

    expect(meta.label).toBe('Wind Speed')
    expect(meta.units).toBe('m/s')
    expect(meta.parameter).toBe('wind_speed')
    expect(meta.colortable).toBe(getLayerStyleByPaletteId('wind.gust.mps.v1').colortable)
  })

  it('rejects layers with unknown palette ids', () => {
    const layer: LayerSpec = {
      id: asLayerId('custom_layer'),
      label: 'Custom Layer',
      groupId: 'temperature',
      paletteId: 'missing.palette.v1',
      displayRange: { min: 0, max: 1 },
      unitBehavior: 'temperature',
      legendScale: 'temperature',
      source: { kind: 'artifact', artifactId: asArtifactId('tmp_surface') },
    }

    const manifest = createFrameManifestFixture({
      artifacts: {
        tmp_surface: createScalarArtifactFixture(),
      },
    })

    expect(() => getLayerMeta('custom_layer', { custom_layer: layer }, manifest))
      .toThrow('Unknown layer paletteId: missing.palette.v1')
  })
})
