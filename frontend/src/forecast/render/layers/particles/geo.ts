import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  clampWebMercatorLat,
} from '@/core/geo'
import { clamp, roughlyEqual } from '@/core/math'

export type ViewportState = {
  west: number
  east: number
  south: number
  north: number
}

export type ViewportBounds = Pick<ViewportState, 'west' | 'east' | 'south' | 'north'>

export type CameraState = {
  centerLng: number
  centerLat: number
  zoom: number
  bearing: number
  pitch: number
  width: number
  height: number
}

export function computeViewportState(map: MapLibreMap): ViewportState {
  const bounds = map.getBounds()
  // Clamp latitude to the WebMercator domain.
  const south = clampWebMercatorLat(bounds.getSouth())
  const north = clampWebMercatorLat(bounds.getNorth())
  const west = bounds.getWest()
  let east = bounds.getEast()
  // Unwrap antimeridian crossings into a continuous east-west span.
  if (east < west) east += 360

  return {
    west,
    east,
    south,
    north,
  }
}

export function captureCameraState(
  map: MapLibreMap | undefined,
  gl: WebGL2RenderingContext | undefined,
): CameraState | null {
  if (!map || !gl) return null
  const center = map.getCenter()
  return {
    centerLng: center.lng,
    centerLat: center.lat,
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
    width: gl.drawingBufferWidth,
    height: gl.drawingBufferHeight,
  }
}

export function hasCameraChanged(previous: CameraState, next: CameraState) {
  return (
    !roughlyEqual(previous.centerLng, next.centerLng, 1e-7) ||
    !roughlyEqual(previous.centerLat, next.centerLat, 1e-7) ||
    !roughlyEqual(previous.zoom, next.zoom, 1e-7) ||
    !roughlyEqual(previous.bearing, next.bearing, 1e-7) ||
    !roughlyEqual(previous.pitch, next.pitch, 1e-7) ||
    previous.width !== next.width ||
    previous.height !== next.height
  )
}

export function expandViewportBounds(
  viewport: ViewportBounds | null,
  paddingRatio: number,
): ViewportBounds | null {
  if (!viewport) return null
  const ratio = Number.isFinite(paddingRatio) ? clamp(paddingRatio, 0, 1) : 0
  const lonPadding = Math.max(0, viewport.east - viewport.west) * ratio
  const latPadding = Math.max(0, viewport.north - viewport.south) * ratio

  return {
    west: viewport.west - lonPadding,
    east: viewport.east + lonPadding,
    south: clampWebMercatorLat(viewport.south - latPadding),
    north: clampWebMercatorLat(viewport.north + latPadding),
  }
}

export function toCellCenterOrigin(lon0: number, lat0: number, dx: number, dy: number) {
  // Detect cell-edge origins and shift to cell centers when needed.
  return {
    lon0: needsHalfCellShift(lon0, dx) ? lon0 + 0.5 * dx : lon0,
    lat0: needsHalfCellShift(lat0, dy) ? lat0 + 0.5 * dy : lat0,
  }
}

function needsHalfCellShift(origin: number, step: number) {
  if (!Number.isFinite(origin) || !Number.isFinite(step) || step === 0) return false
  const normalized = origin / step
  const fractional = Math.abs(normalized - Math.round(normalized))
  return Math.abs(fractional - 0.5) < 1e-6
}
