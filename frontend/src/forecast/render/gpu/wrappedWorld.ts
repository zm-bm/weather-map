import * as twgl from 'twgl.js'

import wrappedWorldVertexSource from './glsl/wrapped-world.vert.glsl?raw'
import type { ProgramInfo } from './programs'

export type WrappedWorldQuad = twgl.BufferInfo
export const WORLD_WRAP_COPY_OFFSETS = [-2, -1, 0, 1, 2] as const
export const WRAPPED_WORLD_VERTEX_SHADER_SOURCE = wrappedWorldVertexSource

export function createWrappedWorldQuad(gl: WebGL2RenderingContext): WrappedWorldQuad | null {
  return twgl.createBufferInfoFromArrays(gl, {
    a_mercator_pos: {
      numComponents: 2,
      data: new Float32Array([
        0, 0,
        1, 0,
        0, 1,
        0, 1,
        1, 0,
        1, 1,
      ]),
    },
  })
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
  programInfo: ProgramInfo
  quad: WrappedWorldQuad
  centerWrap: number
  uniforms?: Record<string, unknown>
}): void {
  const { gl, programInfo, quad } = args
  gl.useProgram(programInfo.program)
  bindWrappedWorldQuad(gl, programInfo, quad)
  if (args.uniforms) setUniforms(programInfo, args.uniforms)

  gl.disable(gl.DEPTH_TEST)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

  for (const relativeOffset of WORLD_WRAP_COPY_OFFSETS) {
    setUniforms(programInfo, { u_world_offset_x: args.centerWrap + relativeOffset })
    drawWrappedWorldQuad(gl, quad)
  }

  gl.disable(gl.BLEND)
  gl.useProgram(null)
}
