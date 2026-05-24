import {
  asVectorArtifactId,
  getActiveRunArtifact,
  type ActiveForecastRun,
  type ManifestArtifactSpec,
  type VectorArtifactId,
} from '@/forecast/manifest'
import type { Brand } from '@/core/types'
import { RAW_FORECAST_CATALOG } from './catalog'

export type ParticleLayerId = Brand<string, 'ParticleLayerId'>

export function asParticleLayerId(value: string): ParticleLayerId {
  return value as ParticleLayerId
}

export type ParticleLayerSource = {
  kind: 'artifact'
  artifactId: VectorArtifactId
}

export type ParticleLayerSpec = {
  id: ParticleLayerId
  label: string
  source: ParticleLayerSource
}

type RawParticleLayerSpec = {
  id: string
  label: string
  source: {
    kind: 'artifact'
    artifactId: string
  }
}

type RawForecastCatalog = {
  particleLayers: readonly RawParticleLayerSpec[]
}

const rawCatalog = RAW_FORECAST_CATALOG as RawForecastCatalog

export const PARTICLE_LAYERS: readonly ParticleLayerSpec[] = rawCatalog.particleLayers.map(particleLayerFromRaw)

export function getAvailableParticleLayers(
  activeRun: ActiveForecastRun
): Record<string, ParticleLayerSpec> {
  const layers: Record<string, ParticleLayerSpec> = {}

  for (const entry of PARTICLE_LAYERS) {
    if (!isParticleLayerAvailable(activeRun, entry)) continue
    layers[entry.id] = entry
  }

  return layers
}

export function getDefaultParticleLayer(layers: Record<string, ParticleLayerSpec>): ParticleLayerId | null {
  return PARTICLE_LAYERS.find((entry) => layers[entry.id])?.id ?? null
}

export function getParticleLayerSpec(
  layerId: ParticleLayerId | string,
  layers: Record<string, ParticleLayerSpec>
): ParticleLayerSpec {
  const layer = layers[layerId]
  if (!layer) {
    throw new Error(`Missing particle layer catalog entry for ${layerId}`)
  }
  return layer
}

export function particleLayerSourceArtifactId(layer: ParticleLayerSpec): VectorArtifactId {
  return layer.source.artifactId
}

function isParticleLayerAvailable(
  activeRun: ActiveForecastRun,
  layer: ParticleLayerSpec
): boolean {
  const artifact = getActiveRunArtifact(activeRun, String(layer.source.artifactId))
  if (!artifact) return false
  if (artifact.kind !== 'vector') {
    throw new Error(`Particle layer ${layer.id} requires vector artifact ${layer.source.artifactId}, got ${artifact.kind}`)
  }
  return hasOrderedComponents(artifact, ['u', 'v'])
}

function particleLayerFromRaw(raw: RawParticleLayerSpec): ParticleLayerSpec {
  const vectorArtifactId = asVectorArtifactId(raw.source.artifactId)

  return {
    id: asParticleLayerId(raw.id),
    label: raw.label,
    source: {
      kind: 'artifact',
      artifactId: vectorArtifactId,
    },
  }
}

function hasOrderedComponents(
  artifact: ManifestArtifactSpec,
  components: readonly string[]
): boolean {
  return artifact.components.length === components.length &&
    components.every((component, index) => artifact.components[index] === component)
}
