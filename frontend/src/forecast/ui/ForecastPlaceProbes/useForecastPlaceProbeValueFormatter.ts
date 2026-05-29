import { useCallback } from 'react'

import { getForecastRasterLayer } from '@/forecast/catalog'
import { useLoadedForecastSelectionContext } from '@/forecast/selection'
import { useForecastSettings } from '@/forecast/settings'
import {
  formatUnitValue,
  getUnitDisplay,
  getUnitOptionForSystem,
} from '@/forecast/units'
import type { ForecastPlaceProbeValueFormatter } from '@/forecast/place-probes'

export function useForecastPlaceProbeValueFormatter(): ForecastPlaceProbeValueFormatter {
  const { selectedLayerId } = useLoadedForecastSelectionContext()
  const { settings } = useForecastSettings()
  const layer = getForecastRasterLayer(selectedLayerId)
  const unitDisplay = layer == null ? null : getUnitDisplay(layer.display.unitBehavior)
  const unitOption = unitDisplay == null ? null : getUnitOptionForSystem(unitDisplay, settings.units.system)

  return useCallback((rawValue, loading = false) => {
    const convertedValue = rawValue == null || unitOption == null
      ? rawValue
      : unitOption.convert(rawValue)
    const valueText = loading
      ? 'Loading'
      : convertedValue == null
        ? 'No data'
        : formatUnitValue(convertedValue, unitOption)
    const unitText = convertedValue != null && unitOption?.buttonLabel
      ? ` ${unitOption.buttonLabel}`
      : ''

    return { text: `${valueText}${unitText}` }
  }, [unitOption])
}
