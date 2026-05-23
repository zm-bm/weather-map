import type { LayerSpec } from '../../forecast-catalog'
import { getLayerPalette } from '../../forecast-palette'
import type { FieldTimeSliceData } from '../types'
import type { FieldSourceData } from './source'

export function materializeFieldTimeSlice(
  layer: LayerSpec,
  sourceData: FieldSourceData
): FieldTimeSliceData {
  const palette = getLayerPalette(layer.paletteId)

  return {
    hourToken: sourceData.hourToken,
    layerId: String(layer.id),
    paletteId: layer.paletteId,
    grid: sourceData.grid,
    encoding: sourceData.encoding,
    values: sourceData.values,
    displayRange: [layer.displayRange.min, layer.displayRange.max],
    colorStops: palette.colorStops,
  }
}
