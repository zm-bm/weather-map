import type { FillLayerSpecification, GeoJSONSourceSpecification, Map as MapLibreMap } from 'maplibre-gl'
import type { FeatureCollection, Polygon } from 'geojson'

export const NOISE_PATTERN_ID = 'noise-pattern'
export const NOISE_SOURCE_ID = 'noise-source'
export const NOISE_LAYER_ID = 'noise-layer'

const WORLD_NOISE_BOUNDS: FeatureCollection<Polygon> = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-180, -85],
          [180, -85],
          [180, 85],
          [-180, 85],
          [-180, -85],
        ]],
      },
    },
  ],
} as const

export function buildNoiseSource(): GeoJSONSourceSpecification {
  return {
    type: 'geojson',
    data: WORLD_NOISE_BOUNDS,
  }
}

export function buildNoiseLayer(): FillLayerSpecification {
  return {
    id: NOISE_LAYER_ID,
    type: 'fill',
    source: NOISE_SOURCE_ID,
    paint: {
      'fill-pattern': NOISE_PATTERN_ID,
      'fill-opacity': 0.24,
      'fill-antialias': false,
    },
  }
}

export function ensureNoisePattern(map: MapLibreMap) {
  if (map.hasImage(NOISE_PATTERN_ID)) return

  map.addImage(NOISE_PATTERN_ID, createNoiseImage())
}

function createNoiseImage(): ImageData {
  const size = 256
  const pixels = new Uint8ClampedArray(size * size * 4)

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4
      const nx = x / size
      const ny = y / size

      // Keep the pattern tileable, but bias heavily toward higher-frequency noise so it
      // reads as analog video static instead of cloudy blotches.
      const warpX = tileableValueNoise(nx, ny, 11, 17) * 2 - 1
      const warpY = tileableValueNoise(nx, ny, 13, 29) * 2 - 1
      const u = wrap01(nx + warpX * 0.008)
      const v = wrap01(ny + warpY * 0.008)

      const coarse = tileableValueNoise(u, v, 24, 101) * 2 - 1
      const medium = tileableValueNoise(u, v, 56, 211) * 2 - 1
      const fineA = tileableValueNoise(u, v, 112, 307) * 2 - 1
      const fineB = tileableValueNoise(u, v, 192, 401) * 2 - 1
      const staticSalt = hash2D(x, y, 503) * 2 - 1

      const centered = Math.max(
        -1,
        Math.min(1, (coarse * 0.08) + (medium * 0.18) + (fineA * 0.34) + (fineB * 0.24) + (staticSalt * 0.16))
      )

      const magnitude = Math.pow(Math.abs(centered), 0.9)
      const alpha = Math.round(6 + magnitude * 34)
      const tone = centered >= 0 ? 255 : 0

      pixels[offset] = tone
      pixels[offset + 1] = tone
      pixels[offset + 2] = tone
      pixels[offset + 3] = alpha
    }
  }

  return new ImageData(pixels, size, size)
}

function wrap01(value: number): number {
  return value - Math.floor(value)
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function hash2D(x: number, y: number, seed: number): number {
  const sample = Math.sin((x * 127.1) + (y * 311.7) + (seed * 74.7)) * 43758.5453123
  return sample - Math.floor(sample)
}

function tileableValueNoise(nx: number, ny: number, cells: number, seed: number): number {
  const x = nx * cells
  const y = ny * cells
  const x0 = Math.floor(x) % cells
  const y0 = Math.floor(y) % cells
  const x1 = (x0 + 1) % cells
  const y1 = (y0 + 1) % cells
  const tx = smoothstep(x - Math.floor(x))
  const ty = smoothstep(y - Math.floor(y))

  const v00 = hash2D(x0, y0, seed)
  const v10 = hash2D(x1, y0, seed)
  const v01 = hash2D(x0, y1, seed)
  const v11 = hash2D(x1, y1, seed)

  const top = lerp(v00, v10, tx)
  const bottom = lerp(v01, v11, tx)
  return lerp(top, bottom, ty)
}
