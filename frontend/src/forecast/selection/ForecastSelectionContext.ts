import { createContext, useContext } from 'react'

import type {
  ActiveForecastRun,
  ForecastDatasetId,
  ForecastDatasetOption,
} from '@/forecast/manifest'

type ForecastSelectionBaseValue = {
  activeRun: ActiveForecastRun | null
  activeDatasetId: ForecastDatasetId | null
  datasetOptions: readonly ForecastDatasetOption[]
  setActiveDataset: (value: ForecastDatasetId) => void
  setSelectedLayer: (value: string) => void
}

type ForecastSelectionContextLoadedValue = ForecastSelectionBaseValue & {
  activeRun: ActiveForecastRun
  activeDatasetId: ForecastDatasetId
  selectedLayerId: string | null
}

type ForecastSelectionContextUnloadedValue = ForecastSelectionBaseValue & {
  activeRun: null
  activeDatasetId: null
  selectedLayerId: null
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
