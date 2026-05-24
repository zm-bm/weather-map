import {
  forecastRunScopeKey,
  type ActiveForecastRun,
} from '@/forecast/manifest'

export function scopeDataKey(
  activeRun: ActiveForecastRun,
  value: string
): string {
  return `${forecastRunScopeKey(activeRun)}:${value}`
}
