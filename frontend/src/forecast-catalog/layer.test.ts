import { describe, expect, it } from 'vitest'

import {
  createFrameManifestFixture,
  createScalarProductFixture,
  createVectorProductFixture,
} from '../test/fixtures'
import { getLayerMeta } from './display'
import { FORECAST_LAYERS, getAvailableGroups, getAvailableLayers } from './layer'

describe('forecast layer catalog', () => {
  it('defines display behavior for every layer', () => {
    expect(FORECAST_LAYERS.every((layer) => layer.unitBehavior && layer.legendScale)).toBe(true)
  })

  it('filters layers whose artifacts are unavailable and falls back group defaults', () => {
    const manifest = createFrameManifestFixture({
      scalarProducts: ['tmp_surface', 'prmsl_surface', 'tcdc', 'low_clouds'],
      vectorProducts: [],
    })

    const layers = getAvailableLayers(manifest)
    const groups = getAvailableGroups(layers)

    expect(layers.visibility_surface).toBeUndefined()
    expect(groups.map((group) => group.id)).toEqual(['temperature', 'wind', 'atmosphere'])
    expect(groups.find((group) => group.id === 'wind')?.defaultLayer).toBe('prmsl_surface')
    expect(groups.find((group) => group.id === 'atmosphere')?.layers).toEqual(['tcdc', 'low_clouds'])
  })

  it('includes frontend-derived wind speed when vector wind is available and keeps gust as default', () => {
    const manifest = createFrameManifestFixture({
      scalarProducts: ['gust_surface', 'prmsl_surface'],
      vectorProducts: ['wind10m_uv'],
    })

    const layers = getAvailableLayers(manifest)
    const windGroup = getAvailableGroups(layers).find((group) => group.id === 'wind')

    expect(layers.wind_speed_surface?.source).toMatchObject({
      kind: 'derived',
      artifactId: 'wind10m_uv',
      recipe: 'wind-speed',
    })
    expect(windGroup?.defaultLayer).toBe('gust_surface')
    expect(windGroup?.layers).toEqual(['wind_speed_surface', 'gust_surface', 'prmsl_surface'])
  })

  it('hides frontend-derived wind speed when vector wind components are unavailable', () => {
    const manifest = createFrameManifestFixture({
      products: {
        wind10m_uv: createVectorProductFixture({
          components: ['speed'],
        }),
        gust_surface: createScalarProductFixture({
          id: 'gust_surface',
        }),
      },
      scalarProducts: ['gust_surface'],
      vectorProducts: ['wind10m_uv'],
    })

    const layers = getAvailableLayers(manifest)

    expect(layers.wind_speed_surface).toBeUndefined()
    expect(getAvailableGroups(layers).find((group) => group.id === 'wind')?.layers).toEqual(['gust_surface'])
  })

  it('rejects catalog layers backed by non-scalar artifacts', () => {
    const manifest = createFrameManifestFixture({
      products: {
        tmp_surface: {
          ...createFrameManifestFixture().products.wind10m_uv,
          id: 'tmp_surface',
        },
      },
      scalarProducts: ['tmp_surface'],
      vectorProducts: [],
    })

    expect(() => getAvailableLayers(manifest)).toThrow(
      'Layer tmp_surface requires scalar artifact tmp_surface, got vector'
    )
  })

  it('keeps composite precipitation rate available when optional overlays are missing', () => {
    const manifest = createFrameManifestFixture({
      products: {
        prate_surface: createScalarProductFixture({
          id: 'prate_surface',
          units: 'kg m^-2 s^-1',
          parameter: 'prate',
        }),
      },
    })

    const layers = getAvailableLayers(manifest)
    const precipLayer = layers.prate_surface

    expect(precipLayer?.source).toMatchObject({
      kind: 'composite',
      base: { kind: 'artifact', artifactId: 'prate_surface' },
    })
    expect(getAvailableGroups(layers).find((group) => group.id === 'precipitation')?.defaultLayer)
      .toBe('prate_surface')
    expect(getLayerMeta('prate_surface', layers, manifest)).toMatchObject({
      units: 'kg m^-2 s^-1',
      parameter: 'prate',
    })
  })

  it('declares classified precipitation coloring from precip type to palette rows', () => {
    const prateLayer = FORECAST_LAYERS.find((entry) => entry.id === 'prate_surface')

    expect(prateLayer?.classifiedColoring).toEqual({
      classifierOverlayId: 'precip-type',
      classes: [
        { values: [1], paletteId: 'precip.rate.mm_hr.v1' },
        { values: [4], paletteId: 'precip.rate.snow.mm_hr.v1' },
        { values: [2, 3, 5], paletteId: 'precip.rate.wintry_mix.mm_hr.v1' },
      ],
    })
  })

  it('accepts optional composite overlays when scalar artifacts are present', () => {
    const manifest = createFrameManifestFixture({
      scalarProducts: ['prate_surface', 'precip_type_surface'],
      vectorProducts: [],
    })

    expect(getAvailableLayers(manifest).prate_surface).toBeDefined()
  })

  it('rejects optional composite overlays backed by non-scalar artifacts', () => {
    const manifest = createFrameManifestFixture({
      products: {
        prate_surface: createScalarProductFixture({
          id: 'prate_surface',
        }),
        precip_type_surface: createVectorProductFixture({
          id: 'precip_type_surface',
        }),
      },
    })

    expect(() => getAvailableLayers(manifest)).toThrow(
      'Layer prate_surface overlay precip-type requires scalar artifact precip_type_surface, got vector'
    )
  })
})
