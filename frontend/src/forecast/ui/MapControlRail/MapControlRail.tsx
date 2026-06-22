import type { Map as MapLibreMap } from 'maplibre-gl'
import {
  useEffect,
  useState,
} from 'react'

import config from '@/core/config'
import type { RadioPlaylistFetch } from '@/radio/playlist'
import type { AudioFactory } from '@/radio/useRadioPlayer'
import { joinUrl } from '@/core/url/joinUrl'
import type { MapPoint } from '../mapPoint'
import MapOptionsButton from './MapOptionsButton'
import PlaceSearchButton from './PlaceSearchButton'
import RadioButton from './RadioButton'

type LocationStatus = 'idle' | 'locating' | 'error'
export type MapControlRailPanel = 'search' | 'options'
type GeolocationProvider = Pick<Geolocation, 'getCurrentPosition'>

export type MapControlRailProps = {
  map: MapLibreMap | null
  playlistUrl?: string
  createAudio?: AudioFactory
  fetchPlaylist?: RadioPlaylistFetch
  geolocation?: GeolocationProvider | null
  random?: () => number
  onMapPointSelect?: (point: MapPoint) => void
  activePanel: MapControlRailPanel | null
  onActivePanelChange: (panel: MapControlRailPanel | null) => void
}

const ZOOM_EDGE_EPSILON = 0.0001
const LOCATION_ZOOM = 7

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
    }
  }

  const zoom = readMapNumber(() => map.getZoom())
  const minZoom = readMapNumber(() => map.getMinZoom())
  const maxZoom = readMapNumber(() => map.getMaxZoom())

  return {
    canZoomIn: zoom == null || maxZoom == null || zoom < maxZoom - ZOOM_EDGE_EPSILON,
    canZoomOut: zoom == null || minZoom == null || zoom > minZoom + ZOOM_EDGE_EPSILON,
  }
}

export default function MapControlRail({
  map,
  playlistUrl,
  createAudio,
  fetchPlaylist,
  geolocation = typeof navigator === 'undefined' ? null : navigator.geolocation,
  random,
  onMapPointSelect,
  activePanel,
  onActivePanelChange,
}: MapControlRailProps) {
  const resolvedPlaylistUrl = playlistUrl ?? joinUrl(config.artifactBaseUrl, 'radio/playlist.json')
  const [, setZoomRevision] = useState(0)
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('idle')
  const searchOpen = activePanel === 'search'
  const optionsOpen = activePanel === 'options'
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

    const handleZoomChange = () => setZoomRevision((revision) => revision + 1)

    map.on('zoom', handleZoomChange)
    map.on('zoomend', handleZoomChange)

    return () => {
      map.off('zoom', handleZoomChange)
      map.off('zoomend', handleZoomChange)
    }
  }, [map])

  const bumpZoomRevision = () => setZoomRevision((revision) => revision + 1)

  const handleZoomIn = () => {
    if (!map) return
    map.zoomIn()
    bumpZoomRevision()
  }

  const handleZoomOut = () => {
    if (!map) return
    map.zoomOut()
    bumpZoomRevision()
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

        <div className="map-control-group" aria-label="Map information controls">
          <button
            type="button"
            className="map-control-button map-control-button--info"
            title="Map information"
            aria-label="Map information"
          >
            <span className="map-control-icon map-control-icon--info" />
          </button>
        </div>

        <RadioButton
          playlistUrl={resolvedPlaylistUrl}
          createAudio={createAudio}
          fetchPlaylist={fetchPlaylist}
          random={random}
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
        </div>
      </div>
    </div>
  )
}
