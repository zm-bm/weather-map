import {
  asVectorArtifactId,
  type CycleManifest,
  type ManifestArtifactSpec,
  type VectorArtifactId,
} from '../manifest'

type Brand<T, B extends string> = T & { readonly __brand: B }

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

export const PARTICLE_LAYERS: readonly ParticleLayerSpec[] = [
  particleLayer('wind_particles', 'Wind', 'wind10m_uv'),
]

export function getAvailableParticleLayers(manifest: CycleManifest): Record<string, ParticleLayerSpec> {
  const layers: Record<string, ParticleLayerSpec> = {}

  for (const entry of PARTICLE_LAYERS) {
    if (!isParticleLayerAvailable(manifest, entry)) continue
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
  manifest: CycleManifest,
  layer: ParticleLayerSpec
): boolean {
  const artifact = manifest.artifacts[layer.source.artifactId]
  if (!artifact) return false
  if (artifact.kind !== 'vector') {
    throw new Error(`Particle layer ${layer.id} requires vector artifact ${layer.source.artifactId}, got ${artifact.kind}`)
  }
  return hasOrderedComponents(artifact, ['u', 'v'])
}

function particleLayer(
  id: string,
  label: string,
  artifactId: string
): ParticleLayerSpec {
  const vectorArtifactId = asVectorArtifactId(artifactId)

  return {
    id: asParticleLayerId(id),
    label,
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
