import { useEffect, useSyncExternalStore } from 'react'
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'

import {
  probeRasterWindow,
  type ForecastPlaceProbeFrameChannel,
} from '@/forecast/place-probes'
import { useForecastSelectionContext } from '@/forecast/selection'
import {
  formatMapCoordinates,
  type MapPoint,
} from '../mapPoint'
import { useForecastProbeValueFormatter } from '../useForecastProbeValueFormatter'

type ForecastMapReadoutProps = {
  map: MapLibreMap | null
  probeFrameChannel: ForecastPlaceProbeFrameChannel
  point: MapPoint | null
  onPoint: (point: MapPoint) => void
  onClose: () => void
  suppressed: boolean
}

export default function ForecastMapReadout({
  map,
  probeFrameChannel,
  point,
  onPoint,
  onClose,
  suppressed,
}: ForecastMapReadoutProps) {
  const { activeRun, selectedLayerId } = useForecastSelectionContext()
  const frame = useSyncExternalStore(
    probeFrameChannel.subscribe,
    probeFrameChannel.getSnapshot,
    probeFrameChannel.getSnapshot,
  )
  const formatProbeValue = useForecastProbeValueFormatter(selectedLayerId)
  const hasSelection = activeRun != null && selectedLayerId != null

  useEffect(() => {
    if (!map || suppressed || !hasSelection) return undefined

    const handleClick = (event: MapMouseEvent) => {
      const lngLat = event.lngLat
      const lon = normalizeLongitude(lngLat.lng)
      const lat = lngLat.lat
      onPoint({ lon, lat })
    }

    map.on('click', handleClick)
    return () => {
      map.off('click', handleClick)
    }
  }, [hasSelection, map, onPoint, suppressed])

  useEffect(() => {
    if (suppressed || point == null || !hasSelection) return undefined

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [hasSelection, onClose, point, suppressed])

  if (suppressed || point == null || !hasSelection) return null

  const selectedPoint = {
    lon: normalizeLongitude(point.lon),
    lat: point.lat,
  }
  const frameMatchesLayer = frame?.lower.source.layerId === selectedLayerId
  const sample = frameMatchesLayer && frame != null
    ? probeRasterWindow(frame, selectedPoint)
    : null
  const valueText = formatProbeValue(sample?.value ?? null, !frameMatchesLayer).text
  const coordinateLabel = formatMapCoordinates(selectedPoint.lat, selectedPoint.lon)

  return (
    <section
      className="map-readout"
      aria-label="Point forecast readout"
    >
      <div className="map-readout__header">
        <span className="map-readout__eyebrow">Point Forecast</span>
        <button
          type="button"
          className="map-readout__close"
          aria-label="Close map readout"
          onClick={onClose}
        >
          <span className="map-readout__close-icon" aria-hidden="true" />
        </button>
      </div>
      <div className="map-readout__value">{valueText}</div>
      <div className="map-readout__coordinates">{coordinateLabel}</div>
    </section>
  )
}

function normalizeLongitude(lon: number): number {
  if (!Number.isFinite(lon)) return lon
  return ((((lon + 180) % 360) + 360) % 360) - 180
}
