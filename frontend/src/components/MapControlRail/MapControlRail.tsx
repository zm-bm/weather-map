import type { Map as MapLibreMap } from 'maplibre-gl'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from 'react'

import config from '../../config'
import {
  fieldRuntimeOptions,
  particleRuntimeOptions,
  type FieldColorSamplingMode,
  type FieldRuntimeOptions,
  type ParticleRuntimeOptions,
} from '../../forecast-render/options'
import type { RadioPlaylistFetch } from '../../radio/playlist'
import type { AudioFactory } from '../../radio/useRadioPlayer'
import { joinUrl } from '../../url/joinUrl'
import MapOptionsButton from './MapOptionsButton'
import RadioButton from './RadioButton'

type ZoomButtonState = {
  canZoomIn: boolean
  canZoomOut: boolean
}

export type MapControlRailProps = {
  mapRef: RefObject<MapLibreMap | null>
  mapReadyVersion: number
  playlistUrl?: string
  createAudio?: AudioFactory
  fetchPlaylist?: RadioPlaylistFetch
  random?: () => number
  layerColorOptions?: FieldRuntimeOptions
  particleOptions?: ParticleRuntimeOptions
  particlesEnabled?: boolean
  onLayerColorSamplingModeChange?: (nextValue: FieldColorSamplingMode) => void
  onClearTrailsOnViewChange?: (nextValue: boolean) => void
  onParticlesEnabledChange?: (nextValue: boolean) => void
}

const ZOOM_EDGE_EPSILON = 0.0001
const DISABLED_ZOOM_BUTTON_STATE: ZoomButtonState = {
  canZoomIn: false,
  canZoomOut: false,
}

function setLayerColorSamplingMode(nextValue: FieldColorSamplingMode) {
  fieldRuntimeOptions.colorSamplingMode = nextValue
}

function setParticleClearTrailsOnViewChange(nextValue: boolean) {
  particleRuntimeOptions.clearTrailsOnViewChange = nextValue
}

const ignoreParticlesEnabledChange: (nextValue: boolean) => void = () => undefined

function readMapNumber(readValue: () => number): number | null {
  try {
    const value = readValue()
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function readZoomButtonState(map: MapLibreMap | null): ZoomButtonState {
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
  mapRef,
  mapReadyVersion,
  playlistUrl,
  createAudio,
  fetchPlaylist,
  random,
  layerColorOptions = fieldRuntimeOptions,
  particleOptions = particleRuntimeOptions,
  particlesEnabled = true,
  onLayerColorSamplingModeChange = setLayerColorSamplingMode,
  onClearTrailsOnViewChange = setParticleClearTrailsOnViewChange,
  onParticlesEnabledChange = ignoreParticlesEnabledChange,
}: MapControlRailProps) {
  const resolvedPlaylistUrl = useMemo(
    () => playlistUrl ?? joinUrl(config.artifactBaseUrl, 'radio/playlist.json'),
    [playlistUrl],
  )
  const [zoomButtonState, setZoomButtonState] = useState<ZoomButtonState>(DISABLED_ZOOM_BUTTON_STATE)

  const refreshZoomButtonState = useCallback(() => {
    setZoomButtonState(readZoomButtonState(mapRef.current))
  }, [mapRef])

  useEffect(() => {
    const map = mapRef.current
    refreshZoomButtonState()
    if (!map) return

    const handleZoomChange = () => {
      setZoomButtonState(readZoomButtonState(map))
    }

    map.on('zoom', handleZoomChange)
    map.on('zoomend', handleZoomChange)

    return () => {
      map.off('zoom', handleZoomChange)
      map.off('zoomend', handleZoomChange)
    }
  }, [mapReadyVersion, mapRef, refreshZoomButtonState])

  const handleZoomIn = () => {
    const map = mapRef.current
    if (!map) return
    map.zoomIn()
    setZoomButtonState(readZoomButtonState(map))
  }

  const handleZoomOut = () => {
    const map = mapRef.current
    if (!map) return
    map.zoomOut()
    setZoomButtonState(readZoomButtonState(map))
  }

  return (
    <div className="map-control-rail" aria-label="Map controls">
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

      <RadioButton
        playlistUrl={resolvedPlaylistUrl}
        createAudio={createAudio}
        fetchPlaylist={fetchPlaylist}
        random={random}
      />

      <MapOptionsButton
        layerColorOptions={layerColorOptions}
        particleOptions={particleOptions}
        particlesEnabled={particlesEnabled}
        onLayerColorSamplingModeChange={onLayerColorSamplingModeChange}
        onClearTrailsOnViewChange={onClearTrailsOnViewChange}
        onParticlesEnabledChange={onParticlesEnabledChange}
      />
    </div>
  )
}
