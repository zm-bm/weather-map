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
  const { selectedLayerId, manifest } = useForecastSelectionContext()

  if (manifest == null || selectedLayerId == null) return null

  return (
    <ForecastPlaceProbeLayer
      selectedLayerId={selectedLayerId}
      mapReadyVersion={mapReadyVersion}
      mapRef={mapRef}
    />
  )
}

function ForecastPlaceProbeLayer({
  selectedLayerId,
  mapRef,
  mapReadyVersion,
}: ForecastPlaceProbesProps & {
  selectedLayerId: string
}) {
  const formatProbeDisplay = useForecastProbeValueFormatter()
  const selectedLayerIdRef = useRef(selectedLayerId)
  const formatProbeDisplayRef = useRef(formatProbeDisplay)
  const sessionRef = useRef<PlaceProbeSession | null>(null)

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const session = createPlaceProbeSession({
      map,
      getSelectedLayerId: () => selectedLayerIdRef.current,
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
    selectedLayerIdRef.current = selectedLayerId
    formatProbeDisplayRef.current = formatProbeDisplay
    sessionRef.current?.refreshFrame()
  }, [selectedLayerId, formatProbeDisplay])

  return null
}

export default ForecastPlaceProbes
