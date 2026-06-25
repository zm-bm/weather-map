import { clamp } from '@/core/math'
import { effectiveGridBoundaryModes } from '@/forecast/frames'
import type { ParticleRenderSettings } from '@/forecast/settings/settings'
import { expandViewportBounds, toCellCenterOrigin, type ViewportBounds } from '../geo'
import {
  PARTICLE_STATE_COMPONENTS,
  uploadParticleStateArray,
} from '../stateBuffers'
import type { VectorFramePair } from '../vectorFramePair'
import type { ParticlePassState } from './index'

const EARTH_DEG_PER_METER = 360 / (2 * Math.PI * 6378137)

type VectorRasterEncoding = {
  scale?: number
  offset?: number
}

type SampledVector = {
  valid: boolean
  u: number
  v: number
}

export function runUpdatePass(
  state: ParticlePassState,
  dtSec: number,
  nowMs: number,
  options: ParticleRenderSettings,
): void {
  const {
    gl,
    vectorFramePair,
    particleState,
    activeSourceIndex,
    viewport,
    map,
  } = state
  if (!gl || !vectorFramePair || !particleState || !viewport) return

  const dstIndex: 0 | 1 = activeSourceIndex === 0 ? 1 : 0
  const source = particleState.arrays[activeSourceIndex]
  const target = particleState.arrays[dstIndex]
  const targetBufferInfo = particleState.bufferInfos[dstIndex]
  if (source.length !== target.length) return

  const zoom = map?.getZoom() ?? options.flowRefZoom
  const forcedRespawnFrac = clamp(state.pendingForcedRespawnFrac, 0, 1)
  const simulationBounds = expandViewportBounds(viewport, options.simulationViewportPaddingRatio)

  updateParticleStatesCpu({
    source,
    target,
    framePair: vectorFramePair,
    dtSec,
    seed: nowMs * 0.001,
    zoomScale: Math.pow(2, options.flowRefZoom - zoom),
    forcedRespawnFrac,
    bounds: simulationBounds ?? viewport,
    options,
  })

  uploadParticleStateArray(gl, targetBufferInfo, target)
  gl.bindBuffer(gl.ARRAY_BUFFER, null)

  state.pendingForcedRespawnFrac = 0
  state.activeSourceIndex = dstIndex
}

function updateParticleStatesCpu(args: {
  source: Float32Array
  target: Float32Array
  framePair: VectorFramePair
  dtSec: number
  seed: number
  zoomScale: number
  forcedRespawnFrac: number
  bounds: ViewportBounds
  options: ParticleRenderSettings
}): void {
  const {
    source,
    target,
    framePair,
    dtSec,
    seed,
    zoomScale,
    forcedRespawnFrac,
    bounds,
    options,
  } = args
  const timeMix = clamp(framePair.timeMix, 0, 1)
  const speedScale = options.flowSpeedScale * zoomScale
  const stagnationStart = Math.min(options.stagnationRespawnStartMps, options.stagnationRespawnEndMps)
  const stagnationEnd = Math.max(options.stagnationRespawnStartMps, options.stagnationRespawnEndMps)

  for (let base = 0, id = 0; base < source.length; base += PARTICLE_STATE_COMPONENTS, id += 1) {
    const lon = source[base] ?? 0
    const lat = source[base + 1] ?? 0
    const age = (source[base + 2] ?? 0) + dtSec

    const lower = sampleVectorBilinear(framePair.lowerFrame, lon, lat)
    const upper = sampleVectorBilinear(framePair.upperFrame, lon, lat)
    if (!lower.valid || !upper.valid) {
      writeRespawn(target, base, id, seed, bounds)
      continue
    }

    const vectorX = mix(lower.u, upper.u, timeMix)
    const vectorY = mix(lower.v, upper.v, timeMix)
    const speedMps = Math.hypot(vectorX, vectorY)
    if (age >= options.maxAgeSec) {
      writeRespawn(target, base, id, seed, bounds)
      continue
    }

    if (rand01(id, seed, 0x9e08f4a9) < forcedRespawnFrac) {
      writeRespawn(target, base, id, seed, bounds)
      continue
    }

    const respawnPerSec = options.respawnBasePerSec + speedMps * options.respawnSpeedPerMps
    const respawnProb = clamp(1 - Math.exp(-Math.max(0, respawnPerSec) * Math.max(0, dtSec)), 0, 1)
    if (rand01(id, seed, 0x3c6ef35f) < respawnProb) {
      writeRespawn(target, base, id, seed, bounds)
      continue
    }

    const stagnationT = 1 - smoothstep(
      stagnationStart,
      Math.max(stagnationEnd, stagnationStart + 1e-4),
      speedMps,
    )
    const stagnationRate = Math.max(0, options.stagnationRespawnPerSec) * clamp(stagnationT, 0, 1)
    const stagnationProb = clamp(1 - Math.exp(-stagnationRate * Math.max(0, dtSec)), 0, 1)
    if (rand01(id, seed, 0x7f4a7c15) < stagnationProb) {
      writeRespawn(target, base, id, seed, bounds)
      continue
    }

    const cosLat = Math.max(0.15, Math.abs(Math.cos(toRadians(lat))))
    const flowDirX = speedMps > 1e-5 ? vectorX / speedMps : 1
    const flowDirY = speedMps > 1e-5 ? vectorY / speedMps : 0
    const flowNormalX = -flowDirY
    const flowNormalY = flowDirX
    const jitterSign = rand01(id, seed, 0xa54ff53a) * 2 - 1
    const motionSpeedMps = speedMps > 0.25
      ? Math.max(speedMps, Math.max(0, options.motionSpeedFloorMps))
      : 0
    const motionX = (flowDirX * motionSpeedMps) +
      (flowNormalX * motionSpeedMps * options.jitterRatio * jitterSign)
    const motionY = (flowDirY * motionSpeedMps) +
      (flowNormalY * motionSpeedMps * options.jitterRatio * jitterSign)

    const nextLon = wrapLon(lon + motionX * dtSec * (EARTH_DEG_PER_METER / cosLat) * speedScale)
    const nextLat = lat + motionY * dtSec * EARTH_DEG_PER_METER * speedScale

    if (
      !Number.isFinite(nextLon) ||
      !Number.isFinite(nextLat) ||
      Math.abs(nextLat) > 89.5 ||
      !inBounds(nextLon, nextLat, bounds)
    ) {
      writeRespawn(target, base, id, seed, bounds)
      continue
    }

    target[base] = nextLon
    target[base + 1] = nextLat
    target[base + 2] = age
    target[base + 3] = speedMps
  }
}

function sampleVectorBilinear(frame: VectorFramePair['lowerFrame'], lon: number, lat: number): SampledVector {
  const { raster } = frame
  const [uBand, vBand] = raster.bands
  if (!uBand || !vBand) return { valid: false, u: 0, v: 0 }

  const origin = toCellCenterOrigin(raster.grid.lon0, raster.grid.lat0, raster.grid.dx, raster.grid.dy)
  const gridX = (lon - origin.lon0) / raster.grid.dx
  const gridY = (lat - origin.lat0) / raster.grid.dy
  const modes = effectiveGridBoundaryModes(raster.grid)
  const xValid = modes.xWrap === 'repeat' || (gridX >= -0.5 && gridX <= raster.grid.nx - 0.5)
  const yValid = modes.yMode === 'clamp' || (gridY >= -0.5 && gridY <= raster.grid.ny - 0.5)
  if (!xValid || !yValid) return { valid: false, u: 0, v: 0 }

  const sampleX = modes.xWrap === 'repeat'
    ? wrapRepeat(gridX, raster.grid.nx)
    : clamp(gridX, 0, raster.grid.nx - 1)
  const sampleY = clamp(gridY, 0, raster.grid.ny - 1)
  const x0 = Math.floor(sampleX)
  const y0 = Math.floor(sampleY)
  const x1 = modes.xWrap === 'repeat'
    ? wrapRepeat(x0 + 1, raster.grid.nx)
    : Math.min(x0 + 1, raster.grid.nx - 1)
  const y1 = Math.min(y0 + 1, raster.grid.ny - 1)
  const tx = sampleX - x0
  const ty = sampleY - y0
  const encoding = raster.encoding as VectorRasterEncoding
  const scale = encoding.scale ?? 1
  const offset = encoding.offset ?? 0
  const w00 = (1 - tx) * (1 - ty)
  const w10 = tx * (1 - ty)
  const w01 = (1 - tx) * ty
  const w11 = tx * ty
  const s00 = decodeVectorAt(uBand, vBand, raster.grid.nx, x0, y0, scale, offset)
  const s10 = decodeVectorAt(uBand, vBand, raster.grid.nx, x1, y0, scale, offset)
  const s01 = decodeVectorAt(uBand, vBand, raster.grid.nx, x0, y1, scale, offset)
  const s11 = decodeVectorAt(uBand, vBand, raster.grid.nx, x1, y1, scale, offset)

  return {
    valid: true,
    u: (s00.u * w00) + (s10.u * w10) + (s01.u * w01) + (s11.u * w11),
    v: (s00.v * w00) + (s10.v * w10) + (s01.v * w01) + (s11.v * w11),
  }
}

function decodeVectorAt(
  uBand: Int8Array,
  vBand: Int8Array,
  nx: number,
  x: number,
  y: number,
  scale: number,
  offset: number,
) {
  const index = y * nx + x
  return {
    u: ((uBand[index] ?? 0) * scale) + offset,
    v: ((vBand[index] ?? 0) * scale) + offset,
  }
}

function writeRespawn(
  target: Float32Array,
  base: number,
  id: number,
  seed: number,
  bounds: ViewportBounds,
): void {
  let lon = mix(bounds.west, bounds.east, rand01(id, seed, 0x68bc21eb))
  if (lon > 180) lon -= 360
  target[base] = lon
  target[base + 1] = mix(bounds.south, bounds.north, rand01(id, seed, 0x02e5be93))
  target[base + 2] = 0
  target[base + 3] = 0
}

function inBounds(lon: number, lat: number, bounds: ViewportBounds): boolean {
  const span = bounds.east - bounds.west
  if (span >= 359.5) return lat >= bounds.south && lat <= bounds.north
  const lonView = lonToViewInterval(lon, bounds.west)
  return lonView >= bounds.west && lonView <= bounds.east &&
    lat >= bounds.south && lat <= bounds.north
}

function lonToViewInterval(lon: number, west: number): number {
  return west + wrapRepeat(lon - west, 360)
}

function wrapLon(lon: number): number {
  return wrapRepeat(lon + 180, 360) - 180
}

function wrapRepeat(value: number, span: number): number {
  if (span <= 0) return value
  const wrapped = value % span
  return wrapped < 0 ? wrapped + span : wrapped
}

function mix(a: number, b: number, t: number): number {
  return a + ((b - a) * t)
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - (2 * t))
}

function rand01(id: number, seed: number, salt: number): number {
  let value = (id ^ ((Math.floor(Math.max(seed, 0) * 1000) * 0x9e3779b9) >>> 0) ^ salt) >>> 0
  value = hashU32(value)
  return (value & 0x00ffffff) / 16777216
}

function hashU32(value: number): number {
  value = (value ^ (value >>> 16)) >>> 0
  value = Math.imul(value, 0x7feb352d) >>> 0
  value = (value ^ (value >>> 15)) >>> 0
  value = Math.imul(value, 0x846ca68b) >>> 0
  return (value ^ (value >>> 16)) >>> 0
}

function toRadians(value: number): number {
  return value * Math.PI / 180
}
