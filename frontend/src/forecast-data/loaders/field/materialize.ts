import type { FieldLayerSource } from '../../target'
import type { FieldTimeSliceData } from '../../slices'
import type { FieldSourceData } from './source'

export function materializeFieldTimeSlice(
  source: FieldLayerSource,
  sourceData: FieldSourceData
): FieldTimeSliceData {
  return {
    hourToken: sourceData.hourToken,
    layerId: source.layerId,
    paletteId: source.paletteId,
    grid: sourceData.grid,
    encoding: sourceData.encoding,
    values: sourceData.values,
    displayRange: source.displayRange,
  }
}
