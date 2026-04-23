import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { MapProbeContext, type MapProbeSample } from './context'
import { clearProbeFrame } from './frame'

export default function MapProbeProvider({ children }: { children: ReactNode }) {
  const [lastProbe, setLastProbe] = useState<MapProbeSample | null>(null)

  useEffect(() => {
    clearProbeFrame()

    return () => {
      clearProbeFrame()
    }
  }, [])

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
