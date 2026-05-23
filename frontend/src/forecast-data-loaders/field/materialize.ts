import { getLayerPalette } from '../../forecast-palette'
import type { ForecastFieldLayerSource } from '../../forecast-data-targets'
import type { FieldTimeSliceData } from '../types'
import type { FieldSourceData } from './source'

export function materializeFieldTimeSlice(
  source: ForecastFieldLayerSource,
  sourceData: FieldSourceData
): FieldTimeSliceData {
  const palette = getLayerPalette(source.paletteId)

  return {
    hourToken: sourceData.hourToken,
    layerId: source.layerId,
    paletteId: source.paletteId,
    grid: sourceData.grid,
    encoding: sourceData.encoding,
    values: sourceData.values,
    displayRange: source.displayRange,
    colorStops: palette.colorStops,
  }
}
