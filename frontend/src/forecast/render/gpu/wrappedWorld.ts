import type { CustomRenderMethodInput } from 'maplibre-gl'
import * as twgl from 'twgl.js'

import wrappedWorldVertexSource from './glsl/wrapped-world.vert.glsl?raw'
import type { ProgramInfo } from './programs'
import {
  isGlobeProjectionActive,
  projectionUniformValues,
  type ProjectionProgramCache,
} from './projection'

export type WrappedWorldMesh = twgl.BufferInfo
export type WrappedWorldQuad = WrappedWorldMesh
export const WORLD_WRAP_COPY_OFFSETS = [-2, -1, 0, 1, 2] as const
export const WRAPPED_WORLD_MESH_COLUMNS = 96
export const WRAPPED_WORLD_MESH_ROWS = 48
export const WRAPPED_WORLD_MESH_VERTEX_COUNT =
  WRAPPED_WORLD_MESH_COLUMNS * WRAPPED_WORLD_MESH_ROWS * 6
export const WRAPPED_WORLD_VERTEX_SHADER_SOURCE = wrappedWorldVertexSource

export function createWrappedWorldMesh(gl: WebGL2RenderingContext): WrappedWorldMesh | null {
  return twgl.createBufferInfoFromArrays(gl, {
    a_mercator_pos: {
      numComponents: 2,
      data: createWrappedWorldMeshVertices(),
    },
  })
}

export function createWrappedWorldQuad(gl: WebGL2RenderingContext): WrappedWorldQuad | null {
  return createWrappedWorldMesh(gl)
}

export function bindWrappedWorldQuad(
  gl: WebGL2RenderingContext,
  programInfo: ProgramInfo,
  quad: WrappedWorldQuad
): void {
  twgl.setBuffersAndAttributes(gl, programInfo, quad)
}

export function setUniforms(
  programInfo: ProgramInfo,
  values: Record<string, unknown>
): void {
  twgl.setUniforms(programInfo, values)
}

export function drawWrappedWorldQuad(
  gl: WebGL2RenderingContext,
  quad: WrappedWorldQuad
): void {
  twgl.drawBufferInfo(gl, quad, gl.TRIANGLES)
}

export function drawWrappedWorldCopies(args: {
  gl: WebGL2RenderingContext
  programCache: ProjectionProgramCache
  input: CustomRenderMethodInput
  quad: WrappedWorldMesh
  centerWrap: number
  uniforms?: Record<string, unknown>
}): void {
  const { gl, input, programCache, quad } = args
  const programInfo = programCache.get(input)
  if (!programInfo) return

  gl.useProgram(programInfo.program)
  bindWrappedWorldQuad(gl, programInfo, quad)
  setUniforms(programInfo, {
    ...projectionUniformValues(input),
    ...(args.uniforms ?? {}),
  })

  gl.disable(gl.DEPTH_TEST)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

  const worldOffsets = isGlobeProjectionActive(input)
    ? [0]
    : WORLD_WRAP_COPY_OFFSETS.map((relativeOffset) => args.centerWrap + relativeOffset)
  for (const worldOffset of worldOffsets) {
    setUniforms(programInfo, { u_world_offset_x: worldOffset })
    drawWrappedWorldQuad(gl, quad)
  }

  gl.disable(gl.BLEND)
  gl.useProgram(null)
}

function createWrappedWorldMeshVertices(): Float32Array {
  const data = new Float32Array(WRAPPED_WORLD_MESH_VERTEX_COUNT * 2)
  let index = 0

  for (let row = 0; row < WRAPPED_WORLD_MESH_ROWS; row += 1) {
    const y0 = row / WRAPPED_WORLD_MESH_ROWS
    const y1 = (row + 1) / WRAPPED_WORLD_MESH_ROWS
    for (let col = 0; col < WRAPPED_WORLD_MESH_COLUMNS; col += 1) {
      const x0 = col / WRAPPED_WORLD_MESH_COLUMNS
      const x1 = (col + 1) / WRAPPED_WORLD_MESH_COLUMNS

      index = writeVertex(data, index, x0, y0)
      index = writeVertex(data, index, x1, y0)
      index = writeVertex(data, index, x0, y1)
      index = writeVertex(data, index, x0, y1)
      index = writeVertex(data, index, x1, y0)
      index = writeVertex(data, index, x1, y1)
    }
  }

  return data
}

function writeVertex(
  data: Float32Array,
  index: number,
  x: number,
  y: number
): number {
  data[index] = x
  data[index + 1] = y
  return index + 2
}
