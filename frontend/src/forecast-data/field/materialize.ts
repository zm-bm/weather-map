import {
  getLayerStyleByPaletteId,
  type LayerSpec,
} from '../../forecast-catalog'
import type { FieldTimeSliceData } from '../types'
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
  }
}
