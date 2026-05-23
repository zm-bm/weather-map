type WebGL2Capability = 'createVertexArray' | 'createTransformFeedback'

export function asWebGL2(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  capability: WebGL2Capability
): WebGL2RenderingContext | null {
  return typeof (gl as WebGL2RenderingContext)[capability] === 'function'
    ? (gl as WebGL2RenderingContext)
    : null
}
