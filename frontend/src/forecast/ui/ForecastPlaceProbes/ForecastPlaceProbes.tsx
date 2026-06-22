import { useEffect } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  createForecastPlaceProbeSession,
  type ForecastPlaceProbeFrameChannel,
} from '@/forecast/place-probes'
import { useForecastSelectionContext } from '@/forecast/selection'
import { useForecastProbeValueFormatter } from '../useForecastProbeValueFormatter'

type ForecastPlaceProbesProps = {
  map: MapLibreMap | null
  probeFrameChannel: ForecastPlaceProbeFrameChannel
}

function ForecastPlaceProbes({
  map,
  probeFrameChannel,
}: ForecastPlaceProbesProps) {
  const { selectedLayerId, activeRun } = useForecastSelectionContext()
  const formatProbeValue = useForecastProbeValueFormatter(selectedLayerId)

  useEffect(() => {
    if (activeRun == null || selectedLayerId == null || !map) return

    const session = createForecastPlaceProbeSession({
      map,
      layerId: selectedLayerId,
      valueFormatter: formatProbeValue,
    })
    const unsubscribeFrameChannel = probeFrameChannel.subscribe((frame) => {
      session.setFrame(frame)
    })
    session.setFrame(probeFrameChannel.getSnapshot())
    session.start()

    return () => {
      unsubscribeFrameChannel()
      session.destroy()
    }
  }, [activeRun, formatProbeValue, map, probeFrameChannel, selectedLayerId])

  return null
}

export default ForecastPlaceProbes
