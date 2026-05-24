import {
  particleLayerSourceArtifactId,
  type LayerId,
  type LayerOverlaySpec,
  type LayerSpec,
  type ParticleLayerId,
  type ParticleLayerSpec,
} from '@/forecast/catalog'
import type { ForecastDataTarget } from '@/forecast/data'
import type { ActiveForecastRun } from '@/forecast/manifest'
import { normalizeForecastHourToken } from '@/forecast/manifest'
import {
  interpolationWindowMinuteOffset,
  resolveForecastInterpolationWindow,
  type ForecastInterpolationWindow,
} from '@/forecast/time'

type LayerSource = ForecastDataTarget['layerSource']
type PrecipTypeSource = LayerSource['precipType']
type WindVectorSource = NonNullable<ForecastDataTarget['windVectorSource']>

export type ResolveDataTargetArgs = {
  activeRun: ActiveForecastRun | null
  layers: Record<string, LayerSpec> | null
  selectedLayerId: LayerId | string | null
  selectedLayerIsRenderable: boolean
  particleLayers: Record<string, ParticleLayerSpec> | null
  selectedParticleLayerId: ParticleLayerId | string | null
  targetTimeMs: number
}

export function resolveDataTarget(args: ResolveDataTargetArgs): ForecastDataTarget | null {
  if (
    args.activeRun == null ||
    args.layers == null ||
    args.selectedLayerId == null ||
    !args.selectedLayerIsRenderable
  ) {
    return null
  }

  const selectedLayer = args.layers[args.selectedLayerId]
  if (selectedLayer == null) return null

  const selectedParticleLayer = args.selectedParticleLayerId == null
    ? null
    : args.particleLayers?.[args.selectedParticleLayerId] ?? null

  return createDataTarget({
    activeRun: args.activeRun,
    layerSource: layerSourceFor(selectedLayer),
    windVectorSource: selectedParticleLayer == null
      ? null
      : windVectorSourceFor(selectedParticleLayer),
    interpolationWindow: resolveForecastInterpolationWindow(
      args.activeRun.latest.times,
      args.targetTimeMs
    ),
  })
}

function createDataTarget(args: {
  activeRun: ActiveForecastRun
  layerSource: LayerSource
  windVectorSource: WindVectorSource | null
  interpolationWindow: ForecastInterpolationWindow
}): ForecastDataTarget {
  const { activeRun, interpolationWindow } = args

  return {
    activeRun,
    layerSource: args.layerSource,
    windVectorSource: args.windVectorSource,
    selectedValidTimeMs: interpolationWindow.selectedValidTimeMs,
    lowerHourToken: normalizeForecastHourToken(interpolationWindow.lowerHourToken),
    upperHourToken: normalizeForecastHourToken(interpolationWindow.upperHourToken),
    mix: interpolationWindow.mix,
    minuteOffset: interpolationWindowMinuteOffset(interpolationWindow),
  }
}

function layerSourceFor(layer: LayerSpec): LayerSource {
  const display = {
    layerId: String(layer.id),
    paletteId: layer.paletteId,
    displayRange: [layer.displayRange.min, layer.displayRange.max] as [number, number],
    precipType: precipTypeSourceFor(layer.overlays),
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
    fieldSource: layer.source.kind === 'artifact'
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

function windVectorSourceFor(layer: ParticleLayerSpec): WindVectorSource {
  return {
    id: String(layer.id),
    artifactId: String(particleLayerSourceArtifactId(layer)),
  }
}

function precipTypeSourceFor(
  overlays: readonly LayerOverlaySpec[]
): PrecipTypeSource {
  const overlay = overlays.find((entry) => entry.kind === 'precipitation-type')
  if (overlay == null) return null
  return {
    id: overlay.id,
    artifactId: String(overlay.artifactId),
    optional: overlay.optional,
  }
}
