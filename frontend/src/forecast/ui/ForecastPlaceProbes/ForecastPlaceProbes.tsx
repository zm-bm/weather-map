import { useEffect } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  createForecastPlaceProbeSession,
  type ForecastPlaceProbeFrameChannel,
} from '@/forecast/place-probes'
import { useForecastSelectionContext } from '@/forecast/selection'
import { useForecastSettings } from '@/forecast/settings'
import { useForecastProbeValueFormatter } from '../useForecastProbeValueFormatter'

type ForecastPlaceProbesProps = {
  map: MapLibreMap | null
  probeFrameChannel: ForecastPlaceProbeFrameChannel
}

function ForecastPlaceProbes({
  map,
  probeFrameChannel,
}: ForecastPlaceProbesProps) {
  const { settings } = useForecastSettings()
  const { selectedLayerId, activeRun } = useForecastSelectionContext()
  const formatProbeValue = useForecastProbeValueFormatter(selectedLayerId)

  useEffect(() => {
    if (!settings.map.placeValueLabelsEnabled) return
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
  }, [
    activeRun,
    formatProbeValue,
    map,
    probeFrameChannel,
    selectedLayerId,
    settings.map.placeValueLabelsEnabled,
  ])

  return null
}

export default ForecastPlaceProbes
