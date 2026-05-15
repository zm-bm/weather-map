import {
  getLayerStyleByPaletteId,
  type LayerSpec,
} from '../../forecast-catalog'
import type { FieldClassifiedColoring, FieldTimeSliceData } from '../types'
import type { FieldSourceData } from './source'

export function materializeFieldTimeSlice(
  layer: LayerSpec,
  sourceData: FieldSourceData
): FieldTimeSliceData {
  const style = getLayerStyleByPaletteId(layer.paletteId)

  return {
    hourToken: sourceData.hourToken,
    layerId: String(layer.id),
    paletteId: layer.paletteId,
    grid: sourceData.grid,
    encoding: sourceData.encoding,
    values: sourceData.values,
    displayRange: [layer.displayRange.min, layer.displayRange.max],
    colortable: style.colortable,
    overlays: sourceData.overlays ?? [],
    classifiedColoring: resolveClassifiedColoring(layer),
  }
}

function resolveClassifiedColoring(layer: LayerSpec): FieldClassifiedColoring | undefined {
  const { classifiedColoring } = layer
  if (!classifiedColoring) return undefined

  return {
    classifierOverlayId: classifiedColoring.classifierOverlayId,
    classes: classifiedColoring.classes.map((entry) => ({
      values: entry.values,
      colortable: getLayerStyleByPaletteId(entry.paletteId).colortable,
    })),
  }
}
