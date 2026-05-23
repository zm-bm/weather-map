import {
  particleLayerSourceArtifactId,
  type LayerOverlaySpec,
  type LayerSpec,
  type ParticleLayerSpec,
} from '../forecast-catalog'
import type {
  ForecastLayerDataSource,
  ForecastPrecipTypeDataSource,
  ForecastWindVectorDataSource,
} from './types'

export function createLayerDataSource(layer: LayerSpec): ForecastLayerDataSource {
  const display = {
    layerId: String(layer.id),
    paletteId: layer.paletteId,
    displayRange: [layer.displayRange.min, layer.displayRange.max] as [number, number],
    precipType: precipTypeDataSourceFor(layer.overlays),
  }

  if (layer.source.kind === 'cloud-layers') {
    return {
      ...display,
      kind: 'cloudLayers',
      artifactId: String(layer.source.artifactId),
    }
  }

  return {
    ...display,
    kind: 'field',
    dataSource: layer.source.kind === 'artifact'
      ? {
        kind: 'scalar',
        artifactId: String(layer.source.artifactId),
      }
      : {
        kind: 'derived',
        artifactId: String(layer.source.artifactId),
        recipe: layer.source.recipe,
      },
  }
}

export function createWindVectorDataSource(
  layer: ParticleLayerSpec
): ForecastWindVectorDataSource {
  return {
    id: String(layer.id),
    artifactId: String(particleLayerSourceArtifactId(layer)),
  }
}

function precipTypeDataSourceFor(
  overlays: readonly LayerOverlaySpec[]
): ForecastPrecipTypeDataSource | null {
  const overlay = overlays.find((entry) => entry.kind === 'precipitation-type')
  if (overlay == null) return null
  return {
    id: overlay.id,
    artifactId: String(overlay.artifactId),
    optional: overlay.optional,
  }
}
