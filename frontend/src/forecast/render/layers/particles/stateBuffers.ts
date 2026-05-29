import * as twgl from 'twgl.js'

import {
  expandViewportBounds,
  type ViewportBounds,
  type ViewportState,
} from './geo'

export const PARTICLE_STATE_COMPONENTS = 4

export type ParticleStateBufferPair = [twgl.BufferInfo | null, twgl.BufferInfo | null]

export function createParticleStateBufferPair(
  gl: WebGL2RenderingContext,
  particleCount: number,
  viewport: ViewportState | null,
  simulationViewportPaddingRatio: number,
  maxAgeSec: number,
): ParticleStateBufferPair {
  const initial = buildInitialParticleState(
    particleCount,
    expandViewportBounds(viewport, simulationViewportPaddingRatio),
    maxAgeSec,
  )
  return [
    createStateBufferInfo(gl, initial),
    createStateBufferInfo(gl, initial),
  ]
}

export function rebuildParticleStateBufferPair(
  gl: WebGL2RenderingContext,
  previous: ParticleStateBufferPair,
  particleCount: number,
  viewport: ViewportState | null,
  simulationViewportPaddingRatio: number,
  maxAgeSec: number,
): ParticleStateBufferPair | null {
  const next = createParticleStateBufferPair(
    gl,
    particleCount,
    viewport,
    simulationViewportPaddingRatio,
    maxAgeSec,
  )
  if (!next[0] || !next[1]) {
    deleteParticleStateBufferPair(gl, next)
    console.warn('[particles] failed to resize particle state buffers; keeping previous buffers')
    return null
  }

  deleteParticleStateBufferPair(gl, previous)
  return next
}

export function reseedParticleStateBuffers(args: {
  gl: WebGL2RenderingContext
  stateBufferInfos: ParticleStateBufferPair
  particleCount: number
  viewport: ViewportState | null
  simulationViewportPaddingRatio: number
  maxAgeSec: number
}): void {
  const { gl, stateBufferInfos, particleCount, viewport, simulationViewportPaddingRatio, maxAgeSec } = args
  if (!viewport || !stateBufferInfos[0] || !stateBufferInfos[1]) return

  const stateBuffer0 = getStateBufferFromInfo(stateBufferInfos[0])
  const stateBuffer1 = getStateBufferFromInfo(stateBufferInfos[1])
  if (!stateBuffer0 || !stateBuffer1) return

  const seeded = buildInitialParticleState(
    particleCount,
    expandViewportBounds(viewport, simulationViewportPaddingRatio),
    maxAgeSec,
  )
  gl.bindBuffer(gl.ARRAY_BUFFER, stateBuffer0)
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, seeded)
  gl.bindBuffer(gl.ARRAY_BUFFER, stateBuffer1)
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, seeded)
  gl.bindBuffer(gl.ARRAY_BUFFER, null)
}

export function deleteParticleStateBufferPair(
  gl: WebGL2RenderingContext,
  bufferInfos: ParticleStateBufferPair,
): void {
  const buffer0 = bufferInfos[0] ? getStateBufferFromInfo(bufferInfos[0]) : null
  const buffer1 = bufferInfos[1] ? getStateBufferFromInfo(bufferInfos[1]) : null
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

export function getStateBufferFromInfo(bufferInfo: twgl.BufferInfo) {
  const attrib = bufferInfo.attribs?.a_state
  return attrib?.buffer ?? null
}
