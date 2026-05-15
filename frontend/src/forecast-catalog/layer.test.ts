import { describe, expect, it } from 'vitest'

import {
  createFrameManifestFixture,
  createScalarArtifactFixture,
  createVectorArtifactFixture,
} from '../test/fixtures'
import { getLayerMeta } from './display'
import { PARTICLE_LAYERS } from './particle'
import {
  FORECAST_LAYER_GROUPS,
  FORECAST_LAYERS,
  getAvailableGroups,
  getAvailableLayers,
  type LayerSource,
} from './layer'

function sourceArtifactIds(source: LayerSource): string[] {
  if (source.kind === 'artifact' || source.kind === 'derived') {
    return [String(source.artifactId)]
  }

  return [
    ...sourceArtifactIds(source.base),
    ...source.overlays.flatMap((overlay) => sourceArtifactIds(overlay.source)),
  ]
}

describe('layer catalog', () => {
  it('defines display behavior for every layer', () => {
    expect(FORECAST_LAYERS.every((layer) => layer.unitBehavior && layer.legendScale)).toBe(true)
  })

  it('keeps layer ids and group membership internally consistent', () => {
    const layerIds = FORECAST_LAYERS.map((layer) => String(layer.id))
    const groupIds = FORECAST_LAYER_GROUPS.map((group) => String(group.id))

    expect(new Set(layerIds).size).toBe(layerIds.length)
    expect(new Set(groupIds).size).toBe(groupIds.length)

    const layersById = new Map(FORECAST_LAYERS.map((layer) => [String(layer.id), layer]))

    for (const group of FORECAST_LAYER_GROUPS) {
      expect(group.layers).toContain(group.defaultLayer)
      for (const layerId of group.layers) {
        expect(layersById.has(String(layerId))).toBe(true)
      }
    }

    for (const layer of FORECAST_LAYERS) {
      const matchingGroups = FORECAST_LAYER_GROUPS.filter((group) => group.id === layer.groupId)
      expect(matchingGroups.map((group) => String(group.id))).toEqual([String(layer.groupId)])
      expect(matchingGroups[0]!.layers).toContain(layer.id)
    }
  })

  it('does not couple layer ids to artifact ids except explicit same-name layers', () => {
    const allowedSameNameIds = ['freezing_level', 'precipitable_water']
    const sameNameLayerIds = FORECAST_LAYERS
      .filter((layer) => sourceArtifactIds(layer.source).includes(String(layer.id)))
      .map((layer) => String(layer.id))
      .sort()

    expect(sameNameLayerIds).toEqual([...allowedSameNameIds].sort())
  })

  it('keeps particle layer ids distinct from source artifact ids', () => {
    for (const layer of PARTICLE_LAYERS) {
      expect(String(layer.id)).not.toBe(String(layer.source.artifactId))
    }
  })

  it('filters layers whose artifacts are unavailable and falls back group defaults', () => {
    const manifest = createFrameManifestFixture({
      scalarArtifactIds: ['tmp_surface', 'prmsl_msl', 'tcdc', 'low_clouds'],
      vectorArtifactIds: [],
    })

    const layers = getAvailableLayers(manifest)
    const groups = getAvailableGroups(layers)

    expect(layers.visibility).toBeUndefined()
    expect(groups.map((group) => group.id)).toEqual(['temperature', 'wind_pressure', 'sky_visibility'])
    expect(groups.find((group) => group.id === 'wind_pressure')?.defaultLayer).toBe('air_pressure')
    expect(groups.find((group) => group.id === 'sky_visibility')?.layers).toEqual(['cloud_cover', 'low_cloud_cover'])
  })

  it('includes frontend-derived wind speed when vector wind is available and keeps gust as default', () => {
    const manifest = createFrameManifestFixture({
      scalarArtifactIds: ['gust_surface', 'prmsl_msl'],
      vectorArtifactIds: ['wind10m_uv'],
    })

    const layers = getAvailableLayers(manifest)
    const windGroup = getAvailableGroups(layers).find((group) => group.id === 'wind_pressure')

    expect(layers.wind_speed?.source).toMatchObject({
      kind: 'derived',
      artifactId: 'wind10m_uv',
      recipe: 'wind-speed',
    })
    expect(windGroup?.defaultLayer).toBe('wind_gust')
    expect(windGroup?.layers).toEqual(['wind_speed', 'wind_gust', 'air_pressure'])
  })

  it('hides frontend-derived wind speed when vector wind components are unavailable', () => {
    const manifest = createFrameManifestFixture({
      artifacts: {
        wind10m_uv: createVectorArtifactFixture({
          components: ['speed'],
        }),
        gust_surface: createScalarArtifactFixture({
          id: 'gust_surface',
        }),
      },
      scalarArtifactIds: ['gust_surface'],
      vectorArtifactIds: ['wind10m_uv'],
    })

    const layers = getAvailableLayers(manifest)

    expect(layers.wind_speed).toBeUndefined()
    expect(getAvailableGroups(layers).find((group) => group.id === 'wind_pressure')?.layers).toEqual(['wind_gust'])
  })

  it('rejects catalog layers backed by non-scalar artifacts', () => {
    const manifest = createFrameManifestFixture({
      artifacts: {
        tmp_surface: {
          ...createFrameManifestFixture().artifacts.wind10m_uv,
          id: 'tmp_surface',
        },
      },
      scalarArtifactIds: ['tmp_surface'],
      vectorArtifactIds: [],
    })

    expect(() => getAvailableLayers(manifest)).toThrow(
      'Layer temperature requires scalar artifact tmp_surface, got vector'
    )
  })

  it('keeps composite precipitation rate available when optional overlays are missing', () => {
    const manifest = createFrameManifestFixture({
      artifacts: {
        prate_surface: createScalarArtifactFixture({
          id: 'prate_surface',
          units: 'kg m^-2 s^-1',
          parameter: 'prate',
        }),
      },
    })

    const layers = getAvailableLayers(manifest)
    const precipLayer = layers.precipitation_rate

    expect(precipLayer?.source).toMatchObject({
      kind: 'composite',
      base: { kind: 'artifact', artifactId: 'prate_surface' },
    })
    expect(getAvailableGroups(layers).find((group) => group.id === 'precipitation')?.defaultLayer)
      .toBe('precipitation_rate')
    expect(getLayerMeta('precipitation_rate', layers, manifest)).toMatchObject({
      units: 'kg m^-2 s^-1',
      parameter: 'prate',
    })
  })

  it('declares classified precipitation coloring from precip type to palette rows', () => {
    const prateLayer = FORECAST_LAYERS.find((entry) => entry.id === 'precipitation_rate')

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
      scalarArtifactIds: ['prate_surface', 'precip_type_surface'],
      vectorArtifactIds: [],
    })

    expect(getAvailableLayers(manifest).precipitation_rate).toBeDefined()
  })

  it('rejects optional composite overlays backed by non-scalar artifacts', () => {
    const manifest = createFrameManifestFixture({
      artifacts: {
        prate_surface: createScalarArtifactFixture({
          id: 'prate_surface',
        }),
        precip_type_surface: createVectorArtifactFixture({
          id: 'precip_type_surface',
        }),
      },
    })

    expect(() => getAvailableLayers(manifest)).toThrow(
      'Layer precipitation_rate overlay precip-type requires scalar artifact precip_type_surface, got vector'
    )
  })
})
