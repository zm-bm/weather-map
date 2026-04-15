export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

type WebGL2Capability = 'createVertexArray' | 'createTransformFeedback'

export function asWebGL2(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  capability: WebGL2Capability
): WebGL2RenderingContext | null {
  return typeof (gl as WebGL2RenderingContext)[capability] === 'function'
    ? (gl as WebGL2RenderingContext)
    : null
}
