import { useEffect, useRef, type RefObject } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'

import type { FieldInterpolationWindowData } from '../../forecast-data'
import {
  createForecastPlaceProbeSession,
  type ForecastPlaceProbeSession,
} from '../../forecast-place-probes'
import { useForecastProbeValueFormatter } from '../../forecast-probe'
import { useForecastSelectionContext } from '../../forecast-selection'

type ForecastPlaceProbesProps = {
  mapRef: RefObject<MapLibreMap | null>
  mapReadyVersion: number
  appliedProbeField: FieldInterpolationWindowData | null
}

function ForecastPlaceProbes({
  mapRef,
  mapReadyVersion,
  appliedProbeField,
}: ForecastPlaceProbesProps) {
  const { selectedLayerId, activeRun } = useForecastSelectionContext()

  if (activeRun == null || selectedLayerId == null) return null

  return (
    <ForecastPlaceProbeLayer
      selectedLayerId={selectedLayerId}
      mapReadyVersion={mapReadyVersion}
      mapRef={mapRef}
      appliedProbeField={appliedProbeField}
    />
  )
}

function ForecastPlaceProbeLayer({
  selectedLayerId,
  mapRef,
  mapReadyVersion,
  appliedProbeField,
}: ForecastPlaceProbesProps & {
  selectedLayerId: string
}) {
  const formatProbeDisplay = useForecastProbeValueFormatter()
  const selectedLayerIdRef = useRef(selectedLayerId)
  const formatProbeDisplayRef = useRef(formatProbeDisplay)
  const appliedProbeFieldRef = useRef(appliedProbeField)
  const sessionRef = useRef<ForecastPlaceProbeSession | null>(null)

  useEffect(() => {
    selectedLayerIdRef.current = selectedLayerId
    sessionRef.current?.setLayerId(selectedLayerId)
  }, [selectedLayerId])

  useEffect(() => {
    formatProbeDisplayRef.current = formatProbeDisplay
    sessionRef.current?.setValueFormatter(formatProbeDisplay)
  }, [formatProbeDisplay])

  useEffect(() => {
    appliedProbeFieldRef.current = appliedProbeField
    sessionRef.current?.setFrame(appliedProbeField)
  }, [appliedProbeField])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const session = createForecastPlaceProbeSession({
      map,
      layerId: selectedLayerIdRef.current,
      valueFormatter: formatProbeDisplayRef.current,
      appliedProbeField: appliedProbeFieldRef.current,
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

  return null
}

export default ForecastPlaceProbes
