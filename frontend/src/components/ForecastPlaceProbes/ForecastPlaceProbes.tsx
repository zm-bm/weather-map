import { useEffect, useRef, type RefObject } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  createForecastPlaceProbeSession,
  type ForecastPlaceProbeFrameChannel,
  type ForecastPlaceProbeSession,
} from '../../forecast-place-probes'
import { useForecastProbeValueFormatter } from '../../forecast-probe'
import { useForecastSelectionContext } from '../../forecast-selection'

type ForecastPlaceProbesProps = {
  mapRef: RefObject<MapLibreMap | null>
  mapReadyVersion: number
  probeFrameChannel: ForecastPlaceProbeFrameChannel
}

function ForecastPlaceProbes({
  mapRef,
  mapReadyVersion,
  probeFrameChannel,
}: ForecastPlaceProbesProps) {
  const { selectedLayerId, activeRun } = useForecastSelectionContext()

  if (activeRun == null || selectedLayerId == null) return null

  return (
    <ForecastPlaceProbeLayer
      selectedLayerId={selectedLayerId}
      mapReadyVersion={mapReadyVersion}
      mapRef={mapRef}
      probeFrameChannel={probeFrameChannel}
    />
  )
}

function ForecastPlaceProbeLayer({
  selectedLayerId,
  mapRef,
  mapReadyVersion,
  probeFrameChannel,
}: ForecastPlaceProbesProps & {
  selectedLayerId: string
}) {
  const formatProbeDisplay = useForecastProbeValueFormatter()
  const selectedLayerIdRef = useRef(selectedLayerId)
  const formatProbeDisplayRef = useRef(formatProbeDisplay)
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
    const map = mapRef.current
    if (!map) return

    const session = createForecastPlaceProbeSession({
      map,
      layerId: selectedLayerIdRef.current,
      valueFormatter: formatProbeDisplayRef.current,
      initialFrame: probeFrameChannel.getSnapshot(),
    })
    sessionRef.current = session
    session.start()
    const unsubscribeFrameChannel = probeFrameChannel.subscribe((frame) => {
      session.setFrame(frame)
    })
    session.setFrame(probeFrameChannel.getSnapshot())

    return () => {
      unsubscribeFrameChannel()
      if (sessionRef.current === session) {
        sessionRef.current = null
      }
      session.destroy()
    }
  }, [mapReadyVersion, mapRef, probeFrameChannel])

  return null
}

export default ForecastPlaceProbes
