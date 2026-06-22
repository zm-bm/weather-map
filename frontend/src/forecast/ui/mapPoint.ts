export type MapPoint = {
  lon: number
  lat: number
}

export function formatMapCoordinates(lat: number, lon: number): string {
  return `${formatMapCoordinate(lat, 'lat')} ${formatMapCoordinate(lon, 'lon')}`
}

function formatMapCoordinate(value: number, axis: 'lat' | 'lon'): string {
  const suffix = axis === 'lat'
    ? value < 0 ? 'S' : 'N'
    : value < 0 ? 'W' : 'E'
  return `${Math.abs(value).toFixed(2)}${suffix}`
}
