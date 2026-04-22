import { useMemo, useState, type ReactNode } from 'react'

import { MapProbeContext, type MapProbeSample } from './MapProbeContext'

export default function MapProbeProvider({ children }: { children: ReactNode }) {
  const [lastProbe, setLastProbe] = useState<MapProbeSample | null>(null)

  const value = useMemo(() => ({
    lastProbe,
    setLastProbe,
  }), [lastProbe])

  return (
    <MapProbeContext.Provider value={value}>
      {children}
    </MapProbeContext.Provider>
  )
}
