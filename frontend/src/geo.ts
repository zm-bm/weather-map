import { clamp } from './math'

export const WEB_MERCATOR_MAX_LAT = 85.05112878
export const MAP_TILE_SIZE_PX = 512

export function clampWebMercatorLat(lat: number): number {
  return clamp(lat, -WEB_MERCATOR_MAX_LAT, WEB_MERCATOR_MAX_LAT)
}

export function lonToMercatorX(lon: number): number {
  // Accept unwrapped longitudes for viewports that cross the antimeridian.
  return (lon + 180) / 360
}

export function latToMercatorY(lat: number): number {
  const clampedLat = clampWebMercatorLat(lat)
  const sinLat = Math.sin((clampedLat * Math.PI) / 180)
  return 0.5 - (0.25 * Math.log((1 + sinLat) / (1 - sinLat))) / Math.PI
}

export function worldWrapForLng(lng: number): number {
  if (!Number.isFinite(lng)) return 0
  return Math.floor((lng + 180) / 360)
}

export function worldSizeAtZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MAP_TILE_SIZE_PX
  return MAP_TILE_SIZE_PX * (2 ** zoom)
}
