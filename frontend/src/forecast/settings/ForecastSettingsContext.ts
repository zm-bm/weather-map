import { createContext, useContext } from 'react'

import type { ForecastSettingsValue } from './settings'

export const ForecastSettingsContext =
  createContext<ForecastSettingsValue | null>(null)

export function useForecastSettings(): ForecastSettingsValue {
  const value = useContext(ForecastSettingsContext)
  if (!value) {
    throw new Error('useForecastSettings must be used within a ForecastSettingsProvider')
  }
  return value
}
