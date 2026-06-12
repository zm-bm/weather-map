import {
  getActiveRunArtifact,
  getActiveRunLayerAvailability,
  type ActiveForecastRun,
  type ArtifactKind,
  type ManifestArtifactSpec,
} from '@/forecast/manifest'
import {
  hasExactBandIds,
  sourceBandIds,
  type ArtifactSource,
} from './source'
import {
  CONTOUR_LAYERS,
  FORECAST_RASTER_LAYERS_BY_ID,
  PARTICLE_LAYERS,
  type ContourLayer,
  type ForecastRasterLayer,
  type ParticleLayer,
} from './entries'

export type RenderableRasterLayer = {
  layer: ForecastRasterLayer
  artifact: ManifestArtifactSpec
}

function getForecastRasterLayerArtifact(
  activeRun: ActiveForecastRun,
  layer: ForecastRasterLayer,
): ManifestArtifactSpec | null {
  const artifact = getActiveRunArtifact(activeRun, layer.source.artifactId)
  if (!artifact) return null
  const expectedKind = expectedStorageKindForSource(layer.source)
  if (artifact.kind !== expectedKind) {
    throw new Error(`Layer ${layer.id} requires ${expectedKind} artifact ${layer.source.artifactId}, got ${artifact.kind}`)
  }
  return artifact
}

export function isForecastRasterLayerAvailable(
  activeRun: ActiveForecastRun,
  layer: ForecastRasterLayer,
): boolean {
  const artifact = getForecastRasterLayerArtifact(activeRun, layer)
  if (!artifact) return false
  return artifact.kind === 'scalar' || hasExactBandIds(artifact.components, sourceBandIds(layer.source))
}

export function resolveRenderableRasterLayer(
  activeRun: ActiveForecastRun | null,
  layerId: string | null,
): RenderableRasterLayer | null {
  if (activeRun == null || layerId == null) return null
  const layer = FORECAST_RASTER_LAYERS_BY_ID[layerId]
  if (layer == null) return null
  const availability = getActiveRunLayerAvailability(activeRun, layerId)
  if (availability?.state !== 'available') return null

  const artifact = getForecastRasterLayerArtifact(activeRun, layer)
  if (!artifact) return null
  if (artifact.kind === 'vector' && !hasExactBandIds(artifact.components, sourceBandIds(layer.source))) {
    return null
  }

  return { layer, artifact }
}

export function getAvailableParticleLayer(
  activeRun: ActiveForecastRun | null,
  layerId: string | null,
): ParticleLayer | null {
  if (activeRun == null || layerId == null) return null
  const layer = PARTICLE_LAYERS.find((entry) => entry.id === layerId)
  return layer != null && isParticleLayerAvailable(activeRun, layer) ? layer : null
}

export function getDefaultAvailableParticleLayerId(activeRun: ActiveForecastRun | null): string | null {
  if (!activeRun) return null
  return PARTICLE_LAYERS.find((entry) => isParticleLayerAvailable(activeRun, entry))?.id ?? null
}

export function getDefaultAvailableContourLayer(activeRun: ActiveForecastRun | null): ContourLayer | null {
  if (!activeRun) return null
  return CONTOUR_LAYERS.find((entry) => isBandIdLayerAvailable(activeRun, entry, 'Contour layer')) ?? null
}

function isParticleLayerAvailable(
  activeRun: ActiveForecastRun,
  layer: ParticleLayer
): boolean {
  return isBandIdLayerAvailable(activeRun, layer, 'Particle layer')
}

function isBandIdLayerAvailable(
  activeRun: ActiveForecastRun,
  layer: Pick<ParticleLayer | ContourLayer, 'id' | 'source'>,
  label: 'Particle layer' | 'Contour layer'
): boolean {
  const bandIds = sourceBandIds(layer.source)
  const artifact = getActiveRunArtifact(activeRun, layer.source.artifactId)
  if (!artifact) return false
  const expectedKind = expectedStorageKindForBandIds(bandIds)
  if (artifact.kind !== expectedKind) {
    throw new Error(`${label} ${layer.id} requires ${expectedKind} artifact ${layer.source.artifactId}, got ${artifact.kind}`)
  }
  return artifact.kind === 'scalar' || hasExactBandIds(artifact.components, bandIds)
}

function expectedStorageKindForSource(source: ArtifactSource): ArtifactKind {
  return expectedStorageKindForBandIds(sourceBandIds(source))
}

function expectedStorageKindForBandIds(bandIds: readonly string[]): ArtifactKind {
  return hasExactBandIds(bandIds, ['value']) ? 'scalar' : 'vector'
}
