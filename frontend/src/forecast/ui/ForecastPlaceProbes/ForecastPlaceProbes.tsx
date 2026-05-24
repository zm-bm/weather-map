import { useEffect, useRef, type RefObject } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  createForecastPlaceProbeSession,
  type ForecastPlaceProbeFrameChannel,
  type ForecastPlaceProbeSession,
} from '@/forecast/place-probes'
import { useForecastSelectionContext } from '@/forecast/selection'
import { useForecastPlaceProbeValueFormatter } from './useForecastPlaceProbeValueFormatter'

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
    <PlaceProbeSessionBridge
      selectedLayerId={selectedLayerId}
      mapReadyVersion={mapReadyVersion}
      mapRef={mapRef}
      probeFrameChannel={probeFrameChannel}
    />
  )
}

function PlaceProbeSessionBridge({
  selectedLayerId,
  mapRef,
  mapReadyVersion,
  probeFrameChannel,
}: ForecastPlaceProbesProps & {
  selectedLayerId: string
}) {
  const formatProbeValue = useForecastPlaceProbeValueFormatter()
  const selectedLayerIdRef = useRef(selectedLayerId)
  const formatProbeValueRef = useRef(formatProbeValue)
  const sessionRef = useRef<ForecastPlaceProbeSession | null>(null)

  useEffect(() => {
    selectedLayerIdRef.current = selectedLayerId
    sessionRef.current?.setLayerId(selectedLayerId)
  }, [selectedLayerId])

  useEffect(() => {
    formatProbeValueRef.current = formatProbeValue
    sessionRef.current?.setValueFormatter(formatProbeValue)
  }, [formatProbeValue])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const session = createForecastPlaceProbeSession({
      map,
      layerId: selectedLayerIdRef.current,
      valueFormatter: formatProbeValueRef.current,
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
