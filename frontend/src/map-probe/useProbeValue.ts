import { probeScalarFrameWindow } from '../forecast-layers/scalar/probe'
import { useMapProbe } from './context'
import { useProbeFrame } from './frame'

export function useProbeValue(activeScalar: string) {
  const { lastProbe } = useMapProbe()
  const frame = useProbeFrame()

  if (lastProbe == null) {
    return {
      value: null,
      loading: false,
    }
  }

  if (frame == null || frame.lower.variableId !== activeScalar) {
    return {
      value: null,
      loading: true,
    }
  }

  return {
    value: probeScalarFrameWindow(frame, {
      lon: lastProbe.lon,
      lat: lastProbe.lat,
    })?.value ?? null,
    loading: false,
  }
}
