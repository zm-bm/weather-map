import * as twgl from 'twgl.js'

type WebGL2Capability = 'createVertexArray'

export type ProgramInfo = twgl.ProgramInfo

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
