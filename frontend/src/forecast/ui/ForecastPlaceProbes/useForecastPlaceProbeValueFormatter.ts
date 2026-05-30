import { useCallback } from 'react'

import { getForecastRasterLayer } from '@/forecast/catalog'
import { useLoadedForecastSelectionContext } from '@/forecast/selection'
import { useForecastSettings } from '@/forecast/settings'
import {
  formatUnitValue,
  fromNative,
  getUnitOptionForSystem,
} from '@/forecast/display/units'
import type { ForecastPlaceProbeValueFormatter } from '@/forecast/place-probes'

export function useForecastPlaceProbeValueFormatter(): ForecastPlaceProbeValueFormatter {
  const { selectedLayerId } = useLoadedForecastSelectionContext()
  const { settings } = useForecastSettings()
  const layer = getForecastRasterLayer(selectedLayerId)
  const unitOption = layer == null ? null : getUnitOptionForSystem(layer.display.units, settings.units.system)

  return useCallback((rawValue, loading = false) => {
    const convertedValue = rawValue == null || unitOption == null
      ? rawValue
      : fromNative(rawValue, unitOption)
    const valueText = loading
      ? 'Loading'
      : convertedValue == null
        ? 'No data'
        : formatUnitValue(convertedValue, unitOption)
    const unitText = convertedValue != null && unitOption?.label
      ? ` ${unitOption.label}`
      : ''

    return { text: `${valueText}${unitText}` }
  }, [unitOption])
}
