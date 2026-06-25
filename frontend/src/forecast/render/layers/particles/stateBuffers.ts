import * as twgl from 'twgl.js'

import {
  expandViewportBounds,
  type ViewportBounds,
  type ViewportState,
} from './geo'

export const PARTICLE_STATE_COMPONENTS = 4

export type ParticleStateBufferPair = [twgl.BufferInfo, twgl.BufferInfo]
export type ParticleStateArrayPair = [Float32Array, Float32Array]
export type ParticleStateStorage = {
  arrays: ParticleStateArrayPair
  bufferInfos: ParticleStateBufferPair
}

export function createParticleStateStorage(
  gl: WebGL2RenderingContext,
  particleCount: number,
  viewport: ViewportState | null,
  simulationViewportPaddingRatio: number,
  maxAgeSec: number,
): ParticleStateStorage {
  const initial = buildInitialParticleState(
    particleCount,
    expandViewportBounds(viewport, simulationViewportPaddingRatio),
    maxAgeSec,
  )
  const arrays: ParticleStateArrayPair = [
    initial,
    new Float32Array(initial),
  ]

  return {
    arrays,
    bufferInfos: [
      createStateBufferInfo(gl, arrays[0]),
      createStateBufferInfo(gl, arrays[1]),
    ],
  }
}

export function rebuildParticleStateStorage(
  gl: WebGL2RenderingContext,
  previous: ParticleStateStorage,
  particleCount: number,
  viewport: ViewportState | null,
  simulationViewportPaddingRatio: number,
  maxAgeSec: number,
): ParticleStateStorage {
  const next = createParticleStateStorage(
    gl,
    particleCount,
    viewport,
    simulationViewportPaddingRatio,
    maxAgeSec,
  )

  deleteParticleStateStorage(gl, previous)
  return next
}

export function reseedParticleStateStorage(args: {
  gl: WebGL2RenderingContext
  particleState: ParticleStateStorage
  particleCount: number
  viewport: ViewportState | null
  simulationViewportPaddingRatio: number
  maxAgeSec: number
}): void {
  const { gl, particleState, particleCount, viewport, simulationViewportPaddingRatio, maxAgeSec } = args
  if (!viewport) return

  const seeded = buildInitialParticleState(
    particleCount,
    expandViewportBounds(viewport, simulationViewportPaddingRatio),
    maxAgeSec,
  )

  particleState.arrays[0].set(seeded)
  particleState.arrays[1].set(seeded)
  uploadParticleStateArray(gl, particleState.bufferInfos[0], particleState.arrays[0])
  uploadParticleStateArray(gl, particleState.bufferInfos[1], particleState.arrays[1])
  gl.bindBuffer(gl.ARRAY_BUFFER, null)
}

export function deleteParticleStateStorage(
  gl: WebGL2RenderingContext,
  particleState: ParticleStateStorage | null,
): void {
  if (!particleState) return

  const [bufferInfo0, bufferInfo1] = particleState.bufferInfos
  const buffer0 = getStateBufferFromInfo(bufferInfo0)
  const buffer1 = getStateBufferFromInfo(bufferInfo1)
  if (buffer0) gl.deleteBuffer(buffer0)
  if (buffer1) gl.deleteBuffer(buffer1)
}

export function buildInitialParticleState(
  count: number,
  viewport: ViewportBounds | null,
  maxAgeSec: number,
): Float32Array {
  const out = new Float32Array(count * PARTICLE_STATE_COMPONENTS)
  if (!viewport) return out

  // a_state layout: [lon, lat, ageSec, speedMps].
  for (let i = 0; i < count; i += 1) {
    const base = i * PARTICLE_STATE_COMPONENTS
    const lon = viewport.west + Math.random() * (viewport.east - viewport.west)
    const lat = viewport.south + Math.random() * (viewport.north - viewport.south)
    out[base] = lon > 180 ? lon - 360 : lon
    out[base + 1] = lat
    out[base + 2] = Math.random() * maxAgeSec
  }
  return out
}

export function createStateBufferInfo(gl: WebGL2RenderingContext, data: Float32Array) {
  return twgl.createBufferInfoFromArrays(gl, {
    a_state: {
      numComponents: PARTICLE_STATE_COMPONENTS,
      data,
      drawType: gl.DYNAMIC_DRAW,
    },
  })
}

export function uploadParticleStateArray(
  gl: WebGL2RenderingContext,
  bufferInfo: twgl.BufferInfo,
  data: Float32Array,
): void {
  const buffer = getStateBufferFromInfo(bufferInfo)
  if (!buffer) return

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, data)
}

export function getStateBufferFromInfo(bufferInfo: twgl.BufferInfo) {
  const attrib = bufferInfo.attribs?.a_state
  return attrib?.buffer ?? null
}
