import { useCallback } from 'react'

import { getLayerDisplay } from '../forecast-catalog'
import { useLoadedForecastSelectionContext } from '../forecast-selection'
import {
  formatUnitValue,
  getUnitDisplay,
  getUnitOptionForSystem,
  type UnitOption,
} from '../units'

export function formatForecastProbeValue(
  value: number | null,
  unitOption?: UnitOption | null,
) {
  if (value == null) return 'No data'
  return formatUnitValue(value, unitOption)
}

export type ForecastProbeValueDisplay = {
  text: string
  loading: boolean
  value: number | null
}

export function useForecastProbeValueFormatter() {
  const { activeRun, selectedLayerId, layers, unitSystem } = useLoadedForecastSelectionContext()
  const probeDisplay = selectedLayerId == null ? null : getLayerDisplay(selectedLayerId, layers, activeRun)
  const probeUnitDisplay = probeDisplay == null ? null : getUnitDisplay(probeDisplay.unitBehavior)

  const probeUnitOption = probeDisplay == null || probeUnitDisplay == null
    ? null
    : getUnitOptionForSystem(
      probeUnitDisplay,
      unitSystem
    )

  return useCallback((rawProbeValue: number | null, loading = false): ForecastProbeValueDisplay => {
    const convertedProbeValue = rawProbeValue == null || probeUnitOption == null
      ? rawProbeValue
      : probeUnitOption.convert(rawProbeValue)

    const displayText = loading ? 'Loading' : formatForecastProbeValue(convertedProbeValue, probeUnitOption)
    const unitText = convertedProbeValue != null && probeUnitOption?.buttonLabel
      ? ` ${probeUnitOption.buttonLabel}`
      : ''

    return {
      text: `${displayText}${unitText}`,
      loading,
      value: convertedProbeValue,
    }
  }, [probeUnitOption])
}
