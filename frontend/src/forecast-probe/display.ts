import { useCallback } from 'react'

import { getScalarMeta } from '../forecast-metadata/scalar'
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
  const { activeScalar, scalarLayers, products, unitSystem } = useLoadedForecastSelectionContext()
  const probeMeta = activeScalar == null ? null : getScalarMeta(activeScalar, scalarLayers, products)
  const probeUnitDisplay = probeMeta == null ? null : getUnitDisplay(probeMeta)

  const probeUnitOption = probeMeta == null || probeUnitDisplay == null
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
