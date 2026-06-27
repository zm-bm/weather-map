import type { Map as MapLibreMap } from 'maplibre-gl'
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import type { MapPoint } from '../mapPoint'
import MapInfoButton from './MapInfoButton'
import MapOptionsButton from './MapOptionsButton'
import PlaceSearchButton from './PlaceSearchButton'

type LocationStatus = 'idle' | 'locating' | 'error'
export type MapControlRailPanel = 'search' | 'options' | 'info'
type GeolocationProvider = Pick<Geolocation, 'getCurrentPosition'>

export type MapControlRailProps = {
  map: MapLibreMap | null
  geolocation?: GeolocationProvider | null
  onMapPointSelect?: (point: MapPoint) => void
  activePanel: MapControlRailPanel | null
  onActivePanelChange: (panel: MapControlRailPanel | null) => void
}

const ZOOM_EDGE_EPSILON = 0.0001
const COMPASS_CLICK_TOLERANCE_PX = 3
const COMPASS_PITCH_DEGREES_PER_PIXEL = -0.5
const LOCATION_ZOOM = 7

type ScreenPoint = {
  x: number
  y: number
}

type CompassDragState = {
  pointerId: number
  startClientX: number
  startClientY: number
  lastPoint: ScreenPoint
  hasDragged: boolean
}

function readMapNumber(readValue: () => number): number | null {
  try {
    const value = readValue()
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function readZoomButtonState(map: MapLibreMap | null) {
  if (!map) {
    return {
      canZoomIn: false,
      canZoomOut: false,
      canRotate: false,
      bearing: 0,
      pitch: 0,
    }
  }

  const zoom = readMapNumber(() => map.getZoom())
  const minZoom = readMapNumber(() => map.getMinZoom())
  const maxZoom = readMapNumber(() => map.getMaxZoom())
  const bearing = readMapNumber(() => map.getBearing())
  const pitch = readMapNumber(() => map.getPitch())

  return {
    canZoomIn: zoom == null || maxZoom == null || zoom < maxZoom - ZOOM_EDGE_EPSILON,
    canZoomOut: zoom == null || minZoom == null || zoom > minZoom + ZOOM_EDGE_EPSILON,
    canRotate: true,
    bearing: bearing ?? 0,
    pitch: pitch ?? 0,
  }
}

function pointFromPointerEvent(
  event: ReactPointerEvent<HTMLElement>,
  element: HTMLElement
): ScreenPoint {
  const rect = element.getBoundingClientRect()
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  }
}

function angleDeltaDegrees(
  lastPoint: ScreenPoint,
  currentPoint: ScreenPoint,
  center: ScreenPoint
): number {
  const pointX = currentPoint.x - center.x
  const pointY = currentPoint.y - center.y
  const lastX = lastPoint.x - center.x
  const lastY = lastPoint.y - center.y
  const crossProduct = pointX * lastY - pointY * lastX
  const dotProduct = pointX * lastX + pointY * lastY

  return Math.atan2(crossProduct, dotProduct) * (180 / Math.PI)
}

export default function MapControlRail({
  map,
  geolocation = typeof navigator === 'undefined' ? null : navigator.geolocation,
  onMapPointSelect,
  activePanel,
  onActivePanelChange,
}: MapControlRailProps) {
  const compassDragRef = useRef<CompassDragState | null>(null)
  const suppressNextCompassClickRef = useRef(false)
  const [, setMapViewRevision] = useState(0)
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('idle')
  const searchOpen = activePanel === 'search'
  const optionsOpen = activePanel === 'options'
  const infoOpen = activePanel === 'info'
  const zoomButtonState = readZoomButtonState(map)

  const setPanelOpen = (panel: MapControlRailPanel, isOpen: boolean) => {
    if (isOpen) {
      onActivePanelChange(panel)
    } else if (activePanel === panel) {
      onActivePanelChange(null)
    }
  }

  useEffect(() => {
    if (!map) return

    const handleViewChange = () => setMapViewRevision((revision) => revision + 1)

    map.on('zoom', handleViewChange)
    map.on('zoomend', handleViewChange)
    map.on('rotate', handleViewChange)
    map.on('rotateend', handleViewChange)
    map.on('pitch', handleViewChange)
    map.on('pitchend', handleViewChange)

    return () => {
      map.off('zoom', handleViewChange)
      map.off('zoomend', handleViewChange)
      map.off('rotate', handleViewChange)
      map.off('rotateend', handleViewChange)
      map.off('pitch', handleViewChange)
      map.off('pitchend', handleViewChange)
    }
  }, [map])

  const bumpMapViewRevision = () => setMapViewRevision((revision) => revision + 1)

  const handleZoomIn = () => {
    if (!map) return
    map.zoomIn()
    bumpMapViewRevision()
  }

  const handleZoomOut = () => {
    if (!map) return
    map.zoomOut()
    bumpMapViewRevision()
  }

  const handleCompassClick = () => {
    if (!map) return
    if (suppressNextCompassClickRef.current) {
      suppressNextCompassClickRef.current = false
      return
    }
    map.resetNorthPitch({ essential: true })
    bumpMapViewRevision()
  }

  const handleCompassPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!map) return
    if (event.pointerType === 'mouse' && event.button !== 0) return

    event.preventDefault()
    const target = event.currentTarget
    target.setPointerCapture?.(event.pointerId)
    suppressNextCompassClickRef.current = false
    compassDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      lastPoint: pointFromPointerEvent(event, target),
      hasDragged: false,
    }
  }

  const handleCompassPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const dragState = compassDragRef.current
    if (!map || !dragState || dragState.pointerId !== event.pointerId) return
    if (event.pointerType === 'mouse' && event.buttons === 0) {
      compassDragRef.current = null
      return
    }

    event.preventDefault()
    const target = event.currentTarget
    const rect = target.getBoundingClientRect()
    const currentPoint = pointFromPointerEvent(event, target)
    const center = {
      x: rect.width / 2,
      y: rect.height / 2,
    }
    const dragDistance = Math.hypot(
      event.clientX - dragState.startClientX,
      event.clientY - dragState.startClientY
    )
    const lastPoint = {
      x: dragState.lastPoint.x,
      y: currentPoint.y,
    }
    const bearingDelta = angleDeltaDegrees(lastPoint, currentPoint, center)
    const pitchDelta = (currentPoint.y - dragState.lastPoint.y) * COMPASS_PITCH_DEGREES_PER_PIXEL

    dragState.hasDragged = dragState.hasDragged || dragDistance > COMPASS_CLICK_TOLERANCE_PX
    dragState.lastPoint = currentPoint
    if (Number.isFinite(bearingDelta) && Math.abs(bearingDelta) > 0) {
      map.setBearing(map.getBearing() + bearingDelta)
      bumpMapViewRevision()
    }
    if (Number.isFinite(pitchDelta) && Math.abs(pitchDelta) > 0) {
      map.setPitch(map.getPitch() + pitchDelta)
      bumpMapViewRevision()
    }
  }

  const handleCompassPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const dragState = compassDragRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    event.currentTarget.releasePointerCapture?.(event.pointerId)
    suppressNextCompassClickRef.current = dragState.hasDragged
    if (dragState.hasDragged) {
      window.setTimeout(() => {
        suppressNextCompassClickRef.current = false
      }, 0)
    }
    compassDragRef.current = null
    bumpMapViewRevision()
  }

  const handleCompassPointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const dragState = compassDragRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    event.currentTarget.releasePointerCapture?.(event.pointerId)
    suppressNextCompassClickRef.current = false
    compassDragRef.current = null
  }

  const handleShowLocation = () => {
    if (!map || !geolocation || locationStatus === 'locating') return

    setLocationStatus('locating')
    geolocation.getCurrentPosition(
      (position) => {
        const longitude = position.coords.longitude
        const latitude = position.coords.latitude
        const zoom = Math.max(readMapNumber(() => map.getZoom()) ?? LOCATION_ZOOM, LOCATION_ZOOM)
        onMapPointSelect?.({ lon: longitude, lat: latitude })
        map.flyTo({
          center: [longitude, latitude],
          zoom,
          essential: true,
        })
        setLocationStatus('idle')
      },
      () => {
        setLocationStatus('error')
      },
      {
        enableHighAccuracy: false,
        maximumAge: 60_000,
        timeout: 8_000,
      }
    )
  }

  const locationButtonLabel = locationStatus === 'locating'
    ? 'Locating'
    : locationStatus === 'error' || !geolocation
      ? 'Location unavailable'
      : 'Show your location'
  const locationDisabled = map == null || !geolocation || locationStatus === 'locating'

  return (
    <div className="map-control-rail" aria-label="Map controls: tools and navigation">
      <div className="map-control-rail__tools" aria-label="Map tools">
        <PlaceSearchButton
          map={map}
          isOpen={searchOpen}
          onPlaceSelect={onMapPointSelect}
          onOpenChange={(isOpen) => setPanelOpen('search', isOpen)}
        />

        <MapOptionsButton
          isOpen={optionsOpen}
          onOpenChange={(isOpen) => setPanelOpen('options', isOpen)}
        />

        <div className="map-control-group" aria-label="Map location controls">
          <button
            type="button"
            className="map-control-button map-control-button--location"
            title={locationButtonLabel}
            aria-label={locationButtonLabel}
            aria-busy={locationStatus === 'locating'}
            disabled={locationDisabled}
            onClick={handleShowLocation}
          >
            <span className="map-control-icon map-control-icon--location" />
          </button>
        </div>

        <MapInfoButton
          isOpen={infoOpen}
          onOpenChange={(isOpen) => setPanelOpen('info', isOpen)}
        />
      </div>

      <div className="map-control-rail__navigation" aria-label="Map navigation">
        <div className="map-control-group" aria-label="Map zoom controls">
          <button
            type="button"
            className="map-control-button map-control-button--zoom-in"
            title="Zoom in"
            aria-label="Zoom in"
            disabled={!zoomButtonState.canZoomIn}
            onClick={handleZoomIn}
          >
            <span className="map-control-icon map-control-icon--zoom-in" />
          </button>
          <button
            type="button"
            className="map-control-button map-control-button--zoom-out"
            title="Zoom out"
            aria-label="Zoom out"
            disabled={!zoomButtonState.canZoomOut}
            onClick={handleZoomOut}
          >
            <span className="map-control-icon map-control-icon--zoom-out" />
          </button>
          <button
            type="button"
            className="map-control-button map-control-button--compass"
            title="Rotate or tilt map"
            aria-label="Rotate or tilt map"
            disabled={!zoomButtonState.canRotate}
            onClick={handleCompassClick}
            onPointerDown={handleCompassPointerDown}
            onPointerMove={handleCompassPointerMove}
            onPointerUp={handleCompassPointerUp}
            onPointerCancel={handleCompassPointerCancel}
          >
            <span
              className="map-control-icon map-control-icon--compass"
              style={{
                transform: (
                  `rotateX(${zoomButtonState.pitch}deg) ` +
                  `rotateZ(${-zoomButtonState.bearing}deg)`
                ),
              }}
            />
          </button>
        </div>
      </div>
    </div>
  )
}
