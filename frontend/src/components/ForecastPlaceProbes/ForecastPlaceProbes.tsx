import { useEffect, useRef, type RefObject } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'

import { useForecastProbeValueFormatter } from '../../forecast-probe'
import { useForecastSelectionContext } from '../../forecast-selection'
import {
  createPlaceProbeSession,
  type PlaceProbeSession,
} from './placeProbeSession'

type ForecastPlaceProbesProps = {
  mapRef: RefObject<MapLibreMap | null>
  mapReadyVersion: number
}

function ForecastPlaceProbes({
  mapRef,
  mapReadyVersion,
}: ForecastPlaceProbesProps) {
  const { activeScalar, manifest } = useForecastSelectionContext()

  if (manifest == null || activeScalar == null) return null

  return (
    <ForecastPlaceProbeLayer
      activeScalar={activeScalar}
      mapReadyVersion={mapReadyVersion}
      mapRef={mapRef}
    />
  )
}

function ForecastPlaceProbeLayer({
  activeScalar,
  mapRef,
  mapReadyVersion,
}: ForecastPlaceProbesProps & {
  activeScalar: string
}) {
  const formatProbeDisplay = useForecastProbeValueFormatter()
  const activeScalarRef = useRef(activeScalar)
  const formatProbeDisplayRef = useRef(formatProbeDisplay)
  const sessionRef = useRef<PlaceProbeSession | null>(null)

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const session = createPlaceProbeSession({
      map,
      getActiveScalar: () => activeScalarRef.current,
      getValueFormatter: () => formatProbeDisplayRef.current,
    })
    sessionRef.current = session
    session.start()

    return () => {
      if (sessionRef.current === session) {
        sessionRef.current = null
      }
      session.destroy()
    }
  }, [mapReadyVersion, mapRef])

  useEffect(() => {
    activeScalarRef.current = activeScalar
    formatProbeDisplayRef.current = formatProbeDisplay
    sessionRef.current?.refreshFrame()
  }, [activeScalar, formatProbeDisplay])

  return null
}

export default ForecastPlaceProbes
