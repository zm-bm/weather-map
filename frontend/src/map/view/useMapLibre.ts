import { useCallback, useEffect, useState } from 'react'
import maplibregl, {
  Map as MapLibreMap,
} from 'maplibre-gl'
import { Protocol } from 'pmtiles'

import { normalizeError } from '@/core/abort'
import config from '@/core/config'
import { buildMapStyle } from './basemapStyle'
import { loadStoredViewport, saveStoredViewport } from './viewportPersistence'

const PMTILES_PROTOCOL = 'pmtiles'
const VIEWPORT_SAVE_DEBOUNCE_MS = 250
let pmtilesProtocolInstalled = false

export type UseMapLibreResult = {
  map: MapLibreMap | null
  mapError: Error | null
  retryMap: () => void
}

export type UseMapLibreOptions = {
  containerId?: string
  center: [number, number]
  zoom: number
  minZoom: number
  maxZoom: number
}

function ensurePmtilesProtocol(url: string | undefined): void {
  if (!url) return
  if (!url.startsWith(`${PMTILES_PROTOCOL}://`)) return
  if (pmtilesProtocolInstalled) return

  const protocol = new Protocol()
  maplibregl.addProtocol(PMTILES_PROTOCOL, protocol.tile)
  pmtilesProtocolInstalled = true
}

export function useMapLibre({
  containerId = 'map',
  center,
  zoom,
  minZoom,
  maxZoom,
}: UseMapLibreOptions): UseMapLibreResult {
  const [map, setMap] = useState<MapLibreMap | null>(null)
  const [mapError, setMapError] = useState<Error | null>(null)
  const [retryToken, setRetryToken] = useState(0)
  const retryMap = useCallback(() => {
    setMap(null)
    setMapError(null)
    setRetryToken((value) => value + 1)
  }, [])

  useEffect(() => {
    const stored = loadStoredViewport()
    ensurePmtilesProtocol(config.basemapUrl)
    const style = buildMapStyle(config)

    let m: MapLibreMap
    try {
      m = new maplibregl.Map({
        container: containerId,
        center: stored?.center ?? center,
        zoom: stored?.zoom ?? zoom,
        minZoom,
        maxZoom,
        dragRotate: false,
        attributionControl: false,
        fadeDuration: 0,
        style,
      })
    } catch (error) {
      setMap(null)
      setMapError(normalizeMapLibreError(error))
      return
    }

    const attributionControl = new maplibregl.AttributionControl({ compact: false })
    m.addControl(attributionControl, 'bottom-left')
    setMapError(null)
    let hasLoadedStyle = false

    const handleStyleLoad = () => {
      hasLoadedStyle = true
      setMapError(null)
      setMap(m)
    }

    const handleMapError = (event: { error?: unknown }) => {
      const error = normalizeMapLibreError(event.error ?? event)
      console.warn('[map] MapLibre error', error)
      if (!hasLoadedStyle && isRendererStartupError(error)) {
        setMap(null)
        setMapError(error)
      }
    }

    let saveTimer: number | undefined
    const scheduleSave = () => {
      if (saveTimer) window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(() => saveStoredViewport(m), VIEWPORT_SAVE_DEBOUNCE_MS)
    }

    m.on('moveend', scheduleSave)
    m.on('style.load', handleStyleLoad)
    m.on('error', handleMapError)
    if (m.isStyleLoaded()) {
      handleStyleLoad()
    }

    return () => {
      m.off('moveend', scheduleSave)
      m.off('style.load', handleStyleLoad)
      m.off('error', handleMapError)
      if (saveTimer) window.clearTimeout(saveTimer)
      if (m.hasControl(attributionControl)) {
        m.removeControl(attributionControl)
      }
      m.remove()
      setMap(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryToken]) // intentionally mount/unmount only, plus explicit retry

  return { map, mapError, retryMap }
}

function isRendererStartupError(error: Error): boolean {
  return /\b(webgl|webgl2|gl context|webgl context|context lost)\b/i.test(error.message)
}

function normalizeMapLibreError(value: unknown): Error {
  if (typeof value === 'string') {
    return new Error(mapLibreErrorMessageFromString(value) ?? value)
  }
  if (isRecord(value) && typeof value.message === 'string') {
    return new Error(mapLibreErrorMessageFromString(value.message) ?? value.message)
  }
  const error = normalizeError(value)
  return new Error(mapLibreErrorMessageFromString(error.message) ?? error.message)
}

function mapLibreErrorMessageFromString(value: string): string | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) && typeof parsed.message === 'string' ? parsed.message : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value)
}
