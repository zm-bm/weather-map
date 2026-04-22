import { createContext, useContext } from 'react'

export type MapProbeSample = {
  lat: number
  lon: number
  value: number | null
  variableId: string | null
}

type MapProbeContextValue = {
  lastProbe: MapProbeSample | null
  setLastProbe: (probe: MapProbeSample | null) => void
}

export const MapProbeContext = createContext<MapProbeContextValue | null>(null)

export function useMapProbe(): MapProbeContextValue {
  const value = useContext(MapProbeContext)
  if (!value) {
    throw new Error('useMapProbe must be used within a MapProbeProvider')
  }
  return value
}
