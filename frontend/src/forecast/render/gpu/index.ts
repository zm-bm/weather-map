import * as twgl from 'twgl.js'

type WebGL2Capability = 'createVertexArray' | 'createTransformFeedback'

export type ProgramInfo = twgl.ProgramInfo
export type WrappedWorldQuad = twgl.BufferInfo
export const WORLD_WRAP_COPY_OFFSETS = [-2, -1, 0, 1, 2] as const

export const WRAPPED_WORLD_VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec2 a_mercator_pos; // unit quad in [0, 1] mercator coordinates
uniform mat4 u_matrix;
uniform float u_world_offset_x;
uniform float u_world_size;
out vec2 v_mercator;

void main() {
  // Shift this quad into one wrapped-world copy and pass mercator coords through.
  vec2 worldPos = vec2(a_mercator_pos.x + u_world_offset_x, a_mercator_pos.y);
  v_mercator = worldPos;
  gl_Position = u_matrix * vec4(worldPos * u_world_size, 0.0, 1.0);
}
`

export function asWebGL2(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  capability: WebGL2Capability
): WebGL2RenderingContext | null {
  return typeof (gl as WebGL2RenderingContext)[capability] === 'function'
    ? (gl as WebGL2RenderingContext)
    : null
}

export function createProgramInfo(args: {
  gl: WebGL2RenderingContext
  label: string
  vertexSource: string
  fragmentSource: string
  options?: twgl.ProgramOptions
}): ProgramInfo | null {
  const { gl, label, vertexSource, fragmentSource, options } = args
  const attribLocations = options?.attribLocations ?? { a_mercator_pos: 0 }
  try {
    return twgl.createProgramInfo(
      gl,
      [vertexSource, fragmentSource],
      {
        ...(options ?? {}),
        attribLocations,
        errorCallback: (message: string) => {
          console.warn(`[${label}] shader program failed:`, message)
        },
      },
    ) ?? null
  } catch (error) {
    console.warn(`[${label}] failed to create shader program:`, error)
    return null
  }
}

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

export function deleteBufferInfo(
  gl: WebGL2RenderingContext,
  bufferInfo: twgl.BufferInfo
): void {
  const buffers = new Set<WebGLBuffer>()
  for (const attrib of Object.values(bufferInfo.attribs ?? {})) {
    if (attrib.buffer) buffers.add(attrib.buffer)
  }
  if (bufferInfo.indices) buffers.add(bufferInfo.indices)

  for (const buffer of buffers) {
    gl.deleteBuffer(buffer)
  }
}
