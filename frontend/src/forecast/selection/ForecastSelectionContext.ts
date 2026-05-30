import { createContext, useContext } from 'react'

import type {
  ActiveForecastRun,
  ForecastModelId,
  ForecastModelOption,
} from '@/forecast/manifest'

type ForecastSelectionBaseValue = {
  activeRun: ActiveForecastRun | null
  activeModelId: ForecastModelId | null
  modelOptions: readonly ForecastModelOption[]
  setActiveModel: (value: ForecastModelId) => void
  setSelectedLayer: (value: string) => void
  setSelectedParticleLayer: (value: string) => void
}

type ForecastSelectionContextLoadedValue = ForecastSelectionBaseValue & {
  activeRun: ActiveForecastRun
  activeModelId: ForecastModelId
  selectedLayerId: string | null
  selectedParticleLayerId: string | null
}

type ForecastSelectionContextUnloadedValue = ForecastSelectionBaseValue & {
  activeRun: null
  activeModelId: null
  selectedLayerId: null
  selectedParticleLayerId: null
}

export type ForecastSelectionContextValue =
  | ForecastSelectionContextLoadedValue
  | ForecastSelectionContextUnloadedValue

export const ForecastSelectionContext = createContext<ForecastSelectionContextValue | null>(null)

export function useForecastSelectionContext(): ForecastSelectionContextValue {
  const value = useContext(ForecastSelectionContext)
  if (!value) {
    throw new Error('useForecastSelectionContext must be used within a ForecastSelectionProvider')
  }
  return value
}

export function useLoadedForecastSelectionContext(): ForecastSelectionContextLoadedValue {
  const value = useForecastSelectionContext()
  if (value.activeRun == null) {
    throw new Error('useLoadedForecastSelectionContext requires a loaded forecast run')
  }
  return value
}
