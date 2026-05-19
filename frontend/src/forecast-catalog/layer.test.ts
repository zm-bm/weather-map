import { describe, expect, it } from 'vitest'

import {
  getActiveRunArtifact,
  type ActiveForecastRun,
  type ManifestArtifactSpec,
} from '../forecast-manifest'
import {
  createActiveRunFixture,
  createSingleTimeManifestFixture,
  createScalarArtifactFixture,
  createVectorArtifactFixture,
} from '../test/fixtures'
import { getLayerMeta } from './display'
import { PARTICLE_LAYERS } from './particle'
import {
  FORECAST_LAYER_GROUPS,
  FORECAST_LAYERS,
  FORECAST_LAYERS_BY_ID,
  layerSourceExpectedArtifactKind,
  type CompositeLayerOverlaySource,
  type LayerSpec,
  type LayerSource,
} from './layer'

function isLayerAvailableForActiveRun(
  activeRun: ActiveForecastRun,
  layer: LayerSpec
): boolean {
  return isLayerSourceAvailable(activeRun, layer.source, `Layer ${layer.id}`)
}

function isLayerSourceAvailable(
  activeRun: ActiveForecastRun,
  source: LayerSource,
  owner: string
): boolean {
  if (source.kind === 'composite') {
    return isLayerSourceAvailable(activeRun, source.base, owner) &&
      source.overlays.every((overlay) => isCompositeOverlayAvailable(activeRun, overlay, owner))
  }

  const expectedKind = layerSourceExpectedArtifactKind(source)
  const artifact = getActiveRunArtifact(activeRun, String(source.artifactId))
  if (!artifact) return false
  if (artifact.kind !== expectedKind) {
    throw new Error(`${owner} requires ${expectedKind} artifact ${source.artifactId}, got ${artifact.kind}`)
  }

  if (source.kind === 'derived' && source.recipe === 'wind-speed') {
    return hasOrderedComponents(artifact, ['u', 'v'])
  }

  return true
}

function isCompositeOverlayAvailable(
  activeRun: ActiveForecastRun,
  overlay: CompositeLayerOverlaySource,
  owner: string
): boolean {
  const artifact = getActiveRunArtifact(activeRun, String(overlay.source.artifactId))
  if (!artifact) return overlay.optional
  if (artifact.kind !== 'scalar') {
    throw new Error(`${owner} overlay ${overlay.id} requires scalar artifact ${overlay.source.artifactId}, got ${artifact.kind}`)
  }
  return true
}

function hasOrderedComponents(
  artifact: ManifestArtifactSpec,
  components: readonly string[]
): boolean {
  return artifact.components.length === components.length &&
    components.every((component, index) => artifact.components[index] === component)
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

  it('keeps particle layer ids distinct from source artifact ids', () => {
    for (const layer of PARTICLE_LAYERS) {
      expect(String(layer.id)).not.toBe(String(layer.source.artifactId))
    }
  })

  it('accepts frontend-derived wind speed when vector wind is available', () => {
    const manifest = createSingleTimeManifestFixture({
      scalarArtifactIds: ['gust_surface', 'prmsl_msl'],
      vectorArtifactIds: ['wind10m_uv'],
    })

    const windSpeed = FORECAST_LAYERS_BY_ID.wind_speed!
    const activeRun = createActiveRunFixture(manifest)

    expect(windSpeed.source).toMatchObject({
      kind: 'derived',
      artifactId: 'wind10m_uv',
      recipe: 'wind-speed',
    })
    expect(isLayerAvailableForActiveRun(activeRun, windSpeed)).toBe(true)
  })

  it('hides frontend-derived wind speed when vector wind components are unavailable', () => {
    const manifest = createSingleTimeManifestFixture({
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
    const activeRun = createActiveRunFixture(manifest)

    expect(isLayerAvailableForActiveRun(activeRun, FORECAST_LAYERS_BY_ID.wind_speed!)).toBe(false)
    expect(isLayerAvailableForActiveRun(activeRun, FORECAST_LAYERS_BY_ID.wind_gust!)).toBe(true)
  })

  it('rejects catalog layers backed by non-scalar artifacts', () => {
    const manifest = createSingleTimeManifestFixture({
      artifacts: {
        tmp_surface: {
          ...createVectorArtifactFixture(),
          id: 'tmp_surface',
        },
      },
      scalarArtifactIds: ['tmp_surface'],
      vectorArtifactIds: [],
    })

    expect(() => isLayerAvailableForActiveRun(createActiveRunFixture(manifest), FORECAST_LAYERS_BY_ID.temperature!)).toThrow(
      'Layer temperature requires scalar artifact tmp_surface, got vector'
    )
  })

  it('keeps composite precipitation rate available when optional overlays are missing', () => {
    const manifest = createSingleTimeManifestFixture({
      artifacts: {
        prate_surface: createScalarArtifactFixture({
          id: 'prate_surface',
          units: 'kg m^-2 s^-1',
          parameter: 'prate',
        }),
      },
    })

    const precipLayer = FORECAST_LAYERS_BY_ID.precipitation_rate!
    const activeRun = createActiveRunFixture(manifest)

    expect(precipLayer.source).toMatchObject({
      kind: 'composite',
      base: { kind: 'artifact', artifactId: 'prate_surface' },
    })
    expect(isLayerAvailableForActiveRun(activeRun, precipLayer)).toBe(true)
    expect(getLayerMeta('precipitation_rate', FORECAST_LAYERS_BY_ID, createActiveRunFixture(manifest))).toMatchObject({
      units: 'kg m^-2 s^-1',
      parameter: 'prate',
    })
  })

  it('accepts optional composite overlays when scalar artifacts are present', () => {
    const manifest = createSingleTimeManifestFixture({
      scalarArtifactIds: ['prate_surface', 'precip_type_surface'],
      vectorArtifactIds: [],
    })
    const activeRun = createActiveRunFixture(manifest)

    expect(isLayerAvailableForActiveRun(activeRun, FORECAST_LAYERS_BY_ID.precipitation_rate!)).toBe(true)
  })

  it('rejects optional composite overlays backed by non-scalar artifacts', () => {
    const manifest = createSingleTimeManifestFixture({
      artifacts: {
        prate_surface: createScalarArtifactFixture({
          id: 'prate_surface',
        }),
        precip_type_surface: createVectorArtifactFixture({
          id: 'precip_type_surface',
        }),
      },
    })

    expect(() => isLayerAvailableForActiveRun(createActiveRunFixture(manifest), FORECAST_LAYERS_BY_ID.precipitation_rate!)).toThrow(
      'Layer precipitation_rate overlay precip-type requires scalar artifact precip_type_surface, got vector'
    )
  })
})
