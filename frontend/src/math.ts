export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

export function lerp(a: number, b: number, t: number): number {
  return a + ((b - a) * t)
}

export function wrap(value: number, span: number): number {
  if (span <= 0) return value
  const wrapped = value % span
  return wrapped < 0 ? wrapped + span : wrapped
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0))
  return t * t * (3 - (2 * t))
}

export function roughlyEqual(a: number, b: number, epsilon = 1e-6): boolean {
  return Math.abs(a - b) <= epsilon
}
