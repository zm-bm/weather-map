import type {
  ActiveForecastRun,
} from '../forecast-manifest'
import { getActiveRunArtifact } from '../forecast-manifest'
import type { LegendScale } from '../forecast-legend'
import {
  getLayerPalette,
  type PaletteStop,
} from '../forecast-palette'
import type { UnitBehavior } from '../units'
import {
  getLayerSpec,
  layerSourceArtifactId,
  layerSourceExpectedArtifactKind,
  type LayerId,
  type LayerSpec,
} from './layer'

export type LayerDisplay = {
  id: string
  label: string
  units: string
  parameter: string
  min: number
  max: number
  paletteId: string
  unitBehavior: UnitBehavior
  legendScale: LegendScale
  colorStops: PaletteStop[]
}

export function getLayerDisplay(
  layerId: LayerId | string,
  layersById: Record<string, LayerSpec>,
  activeRun: ActiveForecastRun,
): LayerDisplay {
  const layer = getLayerSpec(layerId, layersById)
  const sourceArtifactId = layerSourceArtifactId(layer.source)
  const sourceMeta = getActiveRunArtifact(activeRun, String(sourceArtifactId))
  const palette = getLayerPalette(layer.paletteId)

  if (sourceMeta) {
    const expectedKind = layerSourceExpectedArtifactKind(layer.source)
    if (sourceMeta.kind !== expectedKind) {
      throw new Error(`Artifact metadata for layer ${layerId} is not ${expectedKind} (got ${sourceMeta.kind})`)
    }
  }

  return {
    id: String(layerId),
    label: layer.label,
    units: sourceMeta?.units ?? '',
    parameter: layer.parameter ?? sourceMeta?.parameter ?? '',
    min: layer.displayRange.min,
    max: layer.displayRange.max,
    paletteId: layer.paletteId,
    unitBehavior: layer.unitBehavior,
    legendScale: layer.legendScale,
    colorStops: palette.colorStops,
  }
}
