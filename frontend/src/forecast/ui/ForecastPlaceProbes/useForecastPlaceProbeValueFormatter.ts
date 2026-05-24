import { useCallback } from 'react'

import { getLayerDisplay } from '@/forecast/catalog'
import { useLoadedForecastSelectionContext } from '@/forecast/selection'
import { useForecastSettings } from '@/forecast/settings'
import {
  formatUnitValue,
  getUnitDisplay,
  getUnitOptionForSystem,
} from '@/forecast/units'
import type { ForecastPlaceProbeValueFormatter } from '@/forecast/place-probes'

export function useForecastPlaceProbeValueFormatter(): ForecastPlaceProbeValueFormatter {
  const { activeRun, selectedLayerId, layers } = useLoadedForecastSelectionContext()
  const { settings } = useForecastSettings()
  const display = selectedLayerId == null ? null : getLayerDisplay(selectedLayerId, layers, activeRun)
  const unitDisplay = display == null ? null : getUnitDisplay(display.unitBehavior)
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
