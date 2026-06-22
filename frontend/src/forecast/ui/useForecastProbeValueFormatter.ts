import { useCallback } from 'react'

import { getForecastRasterLayer } from '@/forecast/catalog'
import { useForecastSettings } from '@/forecast/settings'
import {
  formatUnitValue,
  fromNative,
  getUnitOptionForSystem,
  type UnitOption,
} from '@/forecast/display/units'
import type { ForecastPlaceProbeValueFormatter } from '@/forecast/place-probes'

export function useForecastProbeValueFormatter(
  selectedLayerId: string | null
): ForecastPlaceProbeValueFormatter {
  const { settings } = useForecastSettings()
  const layer = getForecastRasterLayer(selectedLayerId)
  const unitOption = layer == null ? null : getUnitOptionForSystem(layer.display.units, settings.units.system)

  return useCallback((rawValue, loading = false) => {
    return { text: formatPlainProbeValue(rawValue, loading, unitOption) }
  }, [unitOption])
}

function formatPlainProbeValue(
  rawValue: number | null,
  loading: boolean,
  unitOption: UnitOption | null,
): string {
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

  return `${valueText}${unitText}`
}
